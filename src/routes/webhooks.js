import express, { Router } from 'express'
import { eq } from 'drizzle-orm'
import { shopifyHmacMiddleware } from '../middleware/shopifyHmac.js'
import { orderMappings, webhookEvents } from '../db/postgres/schema.js'
import { getDb } from '../db/postgres/connection.js'
import { orderPushQueue } from '../queue/queues.js'
import { getAdapter } from '../zappr/adapter.js'
import { getOrderByFulfillmentOrder } from '../shopify/fulfillment.js'
import { acquireLock } from '../utils/lock.js'
import { env } from '../config/env.js'
import { ORDER_STATUS } from '../config/constants.js'
import { createLogger } from '../utils/logger.js'

// Order-level lock namespace shared with the orders-paid handler below —
// keeps a manual location-move and the orders/paid webhook from racing each
// other into a double-push for the same Shopify order.
const orderMappingLockKey = (shopifyOrderId) => `lock:order-mapping:${shopifyOrderId}`

const router = Router()
const log = createLogger('webhooks')

router.post(
  '/orders-paid',
  express.raw({ type: 'application/json', limit: '2mb' }),
  shopifyHmacMiddleware,
  async (req, res) => {
    const order = req.body
    const shopifyOrderId = String(order.id)
    const shopifyOrderName = order.name
    const hmac = String(req.headers['x-shopify-hmac-sha256'])
    const db = getDb()

    // Idempotency: insert with unique constraint on shopify_order_id.
    // ON CONFLICT DO NOTHING returns empty array → already processed.
    const inserted = await db
      .insert(webhookEvents)
      .values({ shopifyOrderId, eventType: 'orders/paid', hmac, status: 'processing' })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id })

    if (inserted.length === 0) {
      log.info({ shopifyOrderId }, 'Duplicate webhook — skipping')
      return res.status(200).json({ ok: true, skipped: true })
    }

    try {
      // Placeholder — the order-push worker fetches the real FulfillmentOrder
      // gid from Shopify and overwrites this before it is ever used.
      const fulfillmentOrderId = `gid://shopify/Order/${shopifyOrderId}`

      const release = await acquireLock(orderMappingLockKey(shopifyOrderId), { ttlMs: 10_000, waitMs: 5_000 })
      try {
        await db
          .insert(orderMappings)
          .values({ shopifyOrderId, shopifyOrderName, fulfillmentOrderId })
          .onConflictDoNothing()

        await orderPushQueue.add('push-order', { shopifyOrderId, shopifyOrderName })
      } finally {
        await release()
      }

      // Mark done (non-blocking)
      db.update(webhookEvents)
        .set({ status: 'done', processedAt: new Date() })
        .where(eq(webhookEvents.shopifyOrderId, shopifyOrderId))
        .catch((err) => log.error({ err, shopifyOrderId }, 'Failed to update webhook status'))

      log.info({ shopifyOrderId, shopifyOrderName }, 'Order queued for Zappr push')
      return res.status(200).json({ ok: true })
    } catch (err) {
      await db
        .update(webhookEvents)
        .set({ status: 'failed', error: err.message, retryCount: 1 })
        .where(eq(webhookEvents.shopifyOrderId, shopifyOrderId))
        .catch(() => {})

      throw err
    }
  },
)

router.post(
  '/orders-cancelled',
  express.raw({ type: 'application/json', limit: '2mb' }),
  shopifyHmacMiddleware,
  async (req, res) => {
    const shopifyOrderId = String(req.body.id)
    const db = getDb()

    const [mapping] = await db.select()
      .from(orderMappings)
      .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
      .limit(1)

    // Only orders actually sitting at Zappr need a remote cancel; the status
    // guard also makes Shopify's webhook retries idempotent.
    if (!mapping || !mapping.zapprOrderId || mapping.status !== ORDER_STATUS.PUSHED) {
      log.info({ shopifyOrderId, status: mapping?.status }, 'Cancel webhook — nothing to cancel at Zappr')
      return res.status(200).json({ ok: true, skipped: true })
    }

    const adapter = await getAdapter()
    await adapter.cancelOrder({ zapprOrderId: mapping.zapprOrderId })

    await db.update(orderMappings)
      .set({ status: ORDER_STATUS.CANCELLED })
      .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))

    log.info({ shopifyOrderId, zapprOrderId: mapping.zapprOrderId }, 'Order cancelled at Zappr')
    return res.status(200).json({ ok: true })
  },
)

// Fires whenever a fulfillment order's assigned location changes — either
// Shopify auto-routes it, or a merchant manually reassigns it in admin. This
// is the manual-override path: if a merchant drags an order onto the Zappr
// location (whether it never qualified automatically, or fell back/failed
// earlier), push it to Zappr now.
router.post(
  '/fulfillment-order-moved',
  express.raw({ type: 'application/json', limit: '2mb' }),
  shopifyHmacMiddleware,
  async (req, res) => {
    const payload = req.body
    const movedFO = payload.moved_fulfillment_order
    const destinationLocationId = payload.destination_location_id

    if (!env.ZAPPR_SHOPIFY_LOCATION_ID) {
      return res.status(200).json({ ok: true, skipped: true })
    }

    if (!movedFO?.id || destinationLocationId == null) {
      log.warn({ payload }, 'fulfillment-order-moved webhook missing expected fields')
      return res.status(200).json({ ok: true, skipped: true })
    }

    // Payload carries plain numeric REST ids; our config/DB use GraphQL GIDs.
    const destinationGid = `gid://shopify/Location/${destinationLocationId}`
    if (destinationGid !== env.ZAPPR_SHOPIFY_LOCATION_ID) {
      // Moved somewhere other than the Zappr location — not our concern.
      return res.status(200).json({ ok: true, skipped: true })
    }

    // A "moved" event can also represent the tail end of a split where the
    // moved portion is immediately closed, or a move onto a location that
    // isn't fulfillable yet — only 'open' fulfillment orders are pushable.
    if (movedFO.status !== 'open') {
      log.info({ movedFulfillmentOrderId: movedFO.id, status: movedFO.status }, 'Moved fulfillment order not open — skipping')
      return res.status(200).json({ ok: true, skipped: true })
    }

    const movedFulfillmentOrderGid = `gid://shopify/FulfillmentOrder/${movedFO.id}`

    // Dedup rapid re-deliveries/retries of this exact move event. Short TTL —
    // this must never permanently block a legitimate future move of the same
    // fulfillment order.
    let dedupRelease
    try {
      dedupRelease = await acquireLock(`lock:fulfillment-moved:${movedFulfillmentOrderGid}`, { ttlMs: 30_000, waitMs: 0 })
    } catch {
      log.info({ movedFulfillmentOrderGid }, 'Duplicate fulfillment-order-moved delivery — skipping')
      return res.status(200).json({ ok: true, skipped: true })
    }

    try {
      const resolved = await getOrderByFulfillmentOrder(movedFulfillmentOrderGid)

      if (!resolved) {
        log.warn({ movedFulfillmentOrderGid }, 'Could not resolve order for moved fulfillment order — skipping')
        return res.status(200).json({ ok: true, skipped: true })
      }

      const { shopifyOrderId, shopifyOrderName, cancelledAt } = resolved

      if (cancelledAt) {
        log.info({ shopifyOrderId }, 'Order is cancelled — not pushing to Zappr despite manual move')
        return res.status(200).json({ ok: true, skipped: true })
      }

      const db = getDb()
      const release = await acquireLock(orderMappingLockKey(shopifyOrderId), { ttlMs: 10_000, waitMs: 5_000 })

      try {
        const [mapping] = await db.select()
          .from(orderMappings)
          .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
          .limit(1)

        // Already sitting at Zappr (most likely our own moveFulfillmentOrder
        // call from a successful push, which fires this same webhook) or
        // already cancelled at Zappr — never re-push.
        if (mapping && (mapping.status === ORDER_STATUS.PUSHED || mapping.status === ORDER_STATUS.CANCELLED)) {
          log.info({ shopifyOrderId, status: mapping.status }, 'Order already settled — ignoring move webhook')
          return res.status(200).json({ ok: true, skipped: true })
        }

        // Already queued/in-flight from another trigger — avoid a second
        // concurrent push job for the same order (would double-create at Zappr).
        if (mapping && mapping.status === ORDER_STATUS.PENDING) {
          log.info({ shopifyOrderId }, 'Order already queued for push — ignoring move webhook')
          return res.status(200).json({ ok: true, skipped: true })
        }

        if (mapping) {
          // Merchant is forcing a (re)push after FAILED/FALLBACK by manually
          // moving the order onto the Zappr location.
          await db.update(orderMappings)
            .set({ status: ORDER_STATUS.PENDING, fulfillmentOrderId: movedFulfillmentOrderGid })
            .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
        } else {
          await db.insert(orderMappings)
            .values({ shopifyOrderId, shopifyOrderName, fulfillmentOrderId: movedFulfillmentOrderGid })
            .onConflictDoNothing()
        }

        await orderPushQueue.add('push-order', { shopifyOrderId, shopifyOrderName })
        log.info({ shopifyOrderId, shopifyOrderName }, 'Order queued for Zappr push via manual location move')
        return res.status(200).json({ ok: true })
      } finally {
        await release()
      }
    } finally {
      await dedupRelease()
    }
  },
)

export default router
