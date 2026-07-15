import { eq } from 'drizzle-orm'
import { getDb } from '../db/postgres/connection.js'
import { orderMappings } from '../db/postgres/schema.js'
import { getFulfillmentOrders } from '../shopify/fulfillment.js'
import { checkAvailability } from './availabilityService.js'
import { computeSurcharge } from './surchargeService.js'
import { invalidateStock } from '../cache/stockCache.js'
import { trackingPollQueue } from '../queue/queues.js'
import { ORDER_STATUS } from '../config/constants.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('order-service')

const TRACKING_POLL_INITIAL_DELAY_MS = 5 * 60 * 1000

/**
 * Full Zappr order push flow. Called from BullMQ worker.
 *
 * @param {{ shopifyOrderId: string }} opts
 * @param {import('../zappr/adapter.js').ZapprAdapter} adapter
 * @returns {Promise<void>}
 */
export async function pushOrderToZappr({ shopifyOrderId }, adapter) {
  const db = getDb()
  const shopifyGid = `gid://shopify/Order/${shopifyOrderId}`

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

  const { zapprOrderId, estimatedDelivery, easyEcomOrderId, invoiceId } = await adapter.createOrder({
    items: zapprItems,
    pincode,
    slot,
    address,
    shopifyReference: shopifyOrderId,
  })

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
}
