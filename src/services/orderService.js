import { eq } from 'drizzle-orm'
import { getDb } from '../db/postgres/connection.js'
import { orderMappings } from '../db/postgres/schema.js'
import { getFulfillmentOrders, moveFulfillmentOrder } from '../shopify/fulfillment.js'
import { checkAvailability } from './availabilityService.js'
import { computeSurcharge } from './surchargeService.js'
import { invalidateStock } from '../cache/stockCache.js'
import { trackingPollQueue } from '../queue/queues.js'
import { ORDER_STATUS, AVAILABILITY_REASON } from '../config/constants.js'
import { acquireLock } from '../utils/lock.js'
import { ZapprApiError } from '../errors.js'
import { addOrderTags } from '../shopify/orders.js'
import { setInventoryQuantity } from '../shopify/inventory.js'
import { trackEligibleSku, recordSyncedQuantity } from './zapprInventorySyncService.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('order-service')

const TRACKING_POLL_INITIAL_DELAY_MS = 5 * 60 * 1000

// EasyEcom has no atomic stock-reservation API, so two concurrent pushes for
// the same SKU could both pass a plain check-then-act read. Serializing
// pushes per SKU (lock held across the fresh stock check AND the createOrder
// call) closes that window — only one push at a time can decide "this SKU
// has enough stock" for a given SKU.
const SKU_LOCK_TTL_MS = 20_000
const SKU_LOCK_WAIT_MS = 15_000

// EasyEcom's failure text for a genuine stock shortfall isn't documented/
// stable, so this is a best-effort heuristic — anything matching gets routed
// to FALLBACK (safe: order ships normally) instead of endless FAILED retries.
const STOCK_REJECTION_PATTERN = /stock|quantity|insufficient|unavailable/i

function isStockRejection(err) {
  return err instanceof ZapprApiError && STOCK_REJECTION_PATTERN.test(err.message)
}

/**
 * Route a successfully-pushed order's fulfillment to the Zappr-managed
 * Shopify location, tag it, and sync Shopify's inventory display for each
 * SKU sold. Every step is independently wrapped — a failure here must never
 * roll back or fail the already-successful Zappr push, only degrade Shopify
 * admin visibility.
 * @param {{ shopifyOrderId: string, fulfillmentOrderId: string, orderGid: string, items: Array<{ zapprSku: string, quantity: number, variantId: string, shopifyInventoryItemId: string | null }>, adapter: import('../zappr/adapter.js').ZapprAdapter }} opts
 * @returns {Promise<void>}
 */
async function syncShopifyZapprSideEffects({ shopifyOrderId, fulfillmentOrderId, orderGid, items, adapter }) {
  // Read directly from process.env (not the parsed `env` config object) —
  // env-core snapshots process.env at first import, which would make this
  // check permanently blind to the value in long-lived processes/tests that
  // set it after startup.
  const zapprLocationId = process.env.ZAPPR_SHOPIFY_LOCATION_ID
  if (!zapprLocationId) return

  try {
    await moveFulfillmentOrder({ fulfillmentOrderId, locationId: zapprLocationId })
  } catch (err) {
    log.error({ err, shopifyOrderId }, 'Failed to move fulfillment order to Zappr location')
  }

  try {
    await addOrderTags({ orderId: orderGid, tags: ['zappr-fulfillment'] })
  } catch (err) {
    log.error({ err, shopifyOrderId }, 'Failed to tag order as zappr-fulfillment')
  }

  for (const item of items) {
    if (!item.shopifyInventoryItemId) continue

    try {
      await trackEligibleSku({
        sku: item.zapprSku,
        shopifyVariantId: item.variantId,
        shopifyInventoryItemId: item.shopifyInventoryItemId,
      })

      const stock = await adapter.checkStock({ zapprSku: item.zapprSku, quantity: item.quantity })

      await setInventoryQuantity({
        inventoryItemId: item.shopifyInventoryItemId,
        locationId: zapprLocationId,
        quantity: stock.quantity,
      })

      await recordSyncedQuantity(item.zapprSku, stock.quantity)
    } catch (err) {
      log.error({ err, shopifyOrderId, sku: item.zapprSku }, 'Failed to sync Shopify inventory for SKU')
    }
  }
}

/**
 * Full Zappr order push flow. Called from BullMQ worker.
 *
 * @param {{ shopifyOrderId: string, shopifyOrderName?: string }} opts
 * @param {import('../zappr/adapter.js').ZapprAdapter} adapter
 * @returns {Promise<void>}
 */
export async function pushOrderToZappr({ shopifyOrderId, shopifyOrderName }, adapter) {
  const db = getDb()
  const shopifyGid = `gid://shopify/Order/${shopifyOrderId}`

  // Use Shopify's human-readable order name (e.g. "DON119947") as the
  // reference sent to Zappr, so both systems show the same order reference —
  // falls back to the numeric ID only if the name is ever missing.
  const zapprReference = (shopifyOrderName || shopifyOrderId).replace(/^#/, '')

  const orderData = await getFulfillmentOrders(shopifyGid)
  const fulfillmentOrders = orderData.order?.fulfillmentOrders?.nodes ?? []

  if (!fulfillmentOrders.length) {
    log.warn({ shopifyOrderId }, 'No fulfillment orders found')
    return
  }

  const fo = fulfillmentOrders[0]
  const destination = fo.destination
  const pincode = destination?.zip ?? ''

  const items = fo.lineItems.nodes.map((li) => ({
    zapprSku: li.sku,
    quantity: li.remainingQuantity,
    variantId: li.variant?.id,
    price: li.variant?.price,
    shopifyInventoryItemId: li.variant?.inventoryItem?.id ?? null,
    // Variant metafield wins; falls back to the product-level flag
    zapprEligible: (li.variant?.metafield?.value ?? li.variant?.product?.metafield?.value) === 'true',
  }))

  const { slot, surcharge } = computeSurcharge()

  // Re-validate availability before pushing
  for (const item of items) {
    const avail = await checkAvailability(
      { pincode, quantity: item.quantity, zapprSku: item.zapprSku, variantId: item.variantId, zapprEligible: item.zapprEligible },
      adapter,
    )
    if (!avail.available) {
      log.warn({ shopifyOrderId, reason: avail.reason }, 'Order not Zappr-eligible at push time — setting FALLBACK')
      await db.update(orderMappings)
        .set({ status: ORDER_STATUS.FALLBACK })
        .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
      return
    }
  }

  const zapprItems = items.map((i) => ({ zapprSku: i.zapprSku, quantity: i.quantity, price: i.price }))

  // FulfillmentOrderDestination has firstName/lastName/countryCode;
  // the adapter's address contract expects name/country
  const address = {
    ...destination,
    name: [destination?.firstName, destination?.lastName].filter(Boolean).join(' '),
    country: destination?.countryCode === 'IN' ? 'India' : destination?.countryCode ?? 'India',
  }

  // Shopify orders rarely have a distinct billing address on file for this
  // flow (no separate email field on OrderAddress either) — fall back to the
  // shipping address field-by-field so Zappr always gets a populated billing
  // block instead of blanks.
  const shopifyBilling = orderData.order?.billingAddress
  const billingAddress = {
    name: [shopifyBilling?.firstName, shopifyBilling?.lastName].filter(Boolean).join(' ') || address.name,
    address1: shopifyBilling?.address1 ?? address.address1,
    address2: shopifyBilling?.address2 ?? address.address2,
    city: shopifyBilling?.city ?? address.city,
    province: shopifyBilling?.province ?? address.province,
    country: shopifyBilling?.countryCode === 'IN' ? 'India' : (shopifyBilling?.countryCode ?? address.country),
    phone: shopifyBilling?.phone ?? address.phone,
    email: address.email,
    zip: shopifyBilling?.zip ?? pincode,
  }

  // Sort SKUs before locking so two orders sharing SKUs always acquire locks
  // in the same order (avoids A-waits-for-B-waits-for-A deadlocks).
  const uniqueSkus = [...new Set(zapprItems.map((i) => i.zapprSku))].sort()
  const releases = []

  try {
    for (const sku of uniqueSkus) {
      releases.push(await acquireLock(`lock:sku:${sku}`, { ttlMs: SKU_LOCK_TTL_MS, waitMs: SKU_LOCK_WAIT_MS }))
    }

    // Bypass the availability cache here — the whole point of the lock is to
    // make a decision on live numbers, not on a read that another concurrent
    // push already invalidated.
    for (const item of zapprItems) {
      const stock = await adapter.checkStock({ zapprSku: item.zapprSku, quantity: item.quantity })
      if (!stock.available || stock.quantity < item.quantity) {
        log.warn(
          { shopifyOrderId, zapprSku: item.zapprSku, requested: item.quantity, inStock: stock.quantity },
          'Stock claimed by a concurrent order — setting FALLBACK',
        )
        await db.update(orderMappings)
          .set({ status: ORDER_STATUS.FALLBACK, metadata: { reason: AVAILABILITY_REASON.OUT_OF_STOCK } })
          .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
        return
      }
    }

    let created
    try {
      created = await adapter.createOrder({
        items: zapprItems,
        pincode,
        slot,
        address,
        billingAddress,
        shopifyReference: zapprReference,
      })
    } catch (err) {
      if (isStockRejection(err)) {
        log.warn({ err, shopifyOrderId }, 'Zappr rejected order for stock — setting FALLBACK')
        await db.update(orderMappings)
          .set({ status: ORDER_STATUS.FALLBACK, metadata: { reason: AVAILABILITY_REASON.OUT_OF_STOCK } })
          .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
        return
      }
      throw err
    }

    const { zapprOrderId, estimatedDelivery, easyEcomOrderId, invoiceId } = created

    await db.update(orderMappings)
      .set({
        zapprOrderId,
        fulfillmentOrderId: fo.id,
        status: ORDER_STATUS.PUSHED,
        slot,
        pincode,
        surchargeAmount: String(surcharge),
        metadata: { estimatedDelivery, easyEcomOrderId, invoiceId },
      })
      .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))

    // Invalidate stock cache for all pushed SKUs
    await Promise.all(items.map((i) => invalidateStock(i.zapprSku)))

    // Kick off tracking polls — Zappr also pushes webhooks, but polling is the
    // fallback so tracking still syncs if their webhook is never configured/fails.
    await trackingPollQueue.add(
      'poll',
      { zapprOrderId },
      { delay: TRACKING_POLL_INITIAL_DELAY_MS, jobId: `poll-${zapprOrderId}` },
    )

    log.info({ shopifyOrderId, zapprOrderId, slot }, 'Order pushed to Zappr')

    await syncShopifyZapprSideEffects({
      shopifyOrderId,
      fulfillmentOrderId: fo.id,
      orderGid: shopifyGid,
      items,
      adapter,
    })
  } finally {
    await Promise.all(releases.map((release) => release()))
  }
}
