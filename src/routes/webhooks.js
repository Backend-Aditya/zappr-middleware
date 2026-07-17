import express, { Router } from 'express'
import { eq } from 'drizzle-orm'
import { shopifyHmacMiddleware } from '../middleware/shopifyHmac.js'
import { orderMappings, webhookEvents } from '../db/postgres/schema.js'
import { getDb } from '../db/postgres/connection.js'
import { orderPushQueue } from '../queue/queues.js'
import { getAdapter } from '../zappr/adapter.js'
import { ORDER_STATUS } from '../config/constants.js'
import { createLogger } from '../utils/logger.js'

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

      await db
        .insert(orderMappings)
        .values({ shopifyOrderId, shopifyOrderName, fulfillmentOrderId })
        .onConflictDoNothing()

      await orderPushQueue.add('push-order', { shopifyOrderId, shopifyOrderName })

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

export default router
