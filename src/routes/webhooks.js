import express, { Router } from 'express'
import { eq } from 'drizzle-orm'
import { shopifyHmacMiddleware } from '../middleware/shopifyHmac.js'
import { orderMappings, webhookEvents } from '../db/postgres/schema.js'
import { getDb } from '../db/postgres/connection.js'
import { orderPushQueue } from '../queue/queues.js'
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

export default router
