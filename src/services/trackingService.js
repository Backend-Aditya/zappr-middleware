import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db/postgres/connection.js'
import { trackingUpdates, orderMappings } from '../db/postgres/schema.js'
import { createFulfillment, updateFulfillmentTracking } from '../shopify/fulfillment.js'
import { ORDER_STATUS } from '../config/constants.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('tracking-service')

/**
 * Save a Zappr tracking update and sync to Shopify.
 * Creates the Shopify fulfillment on the first tracking number,
 * updates tracking info on subsequent changes.
 *
 * @param {{ zapprOrderId: string, status: string, trackingNumber: string | null, trackingUrl: string | null, rawPayload?: object }} update
 * @returns {Promise<void>}
 */
export async function processTrackingUpdate(update) {
  const { zapprOrderId, status, trackingNumber, trackingUrl, rawPayload } = update
  const db = getDb()

  // Polling runs every 5 minutes regardless of whether Zappr's status moved —
  // without this guard, an unchanged status re-syncs to Shopify and re-sends
  // the customer a "shipping update" email on every single poll.
  const [previous] = await db.select()
    .from(trackingUpdates)
    .where(eq(trackingUpdates.zapprOrderId, zapprOrderId))
    .orderBy(desc(trackingUpdates.createdAt))
    .limit(1)

  if (previous && previous.status === status && previous.trackingNumber === trackingNumber) {
    log.info({ zapprOrderId, status }, 'No change since last update — skipping')
    return
  }

  const [inserted] = await db.insert(trackingUpdates).values({
    zapprOrderId,
    status,
    trackingNumber,
    trackingUrl,
    rawPayload: rawPayload ?? {},
    syncedToShopify: false,
  }).returning()

  if (!trackingNumber) {
    log.info({ zapprOrderId, status }, 'Tracking update saved, no tracking number yet')
    return
  }

  const [mapping] = await db.select()
    .from(orderMappings)
    .where(eq(orderMappings.zapprOrderId, zapprOrderId))
    .limit(1)

  if (!mapping) {
    log.warn({ zapprOrderId }, 'No order mapping found for this Zappr order')
    return
  }

  try {
    let fulfillmentId = mapping.shopifyFulfillmentId

    if (!fulfillmentId) {
      const created = await createFulfillment({
        fulfillmentOrderId: mapping.fulfillmentOrderId,
        trackingNumber,
        trackingUrl,
      })
      fulfillmentId = created.fulfillmentId

      await db.update(orderMappings)
        .set({ shopifyFulfillmentId: fulfillmentId })
        .where(eq(orderMappings.id, mapping.id))

      log.info({ zapprOrderId, fulfillmentId }, 'Shopify fulfillment created')
    } else {
      await updateFulfillmentTracking({
        fulfillmentId,
        trackingNumber,
        trackingUrl,
      })
    }

    await db.update(trackingUpdates)
      .set({ syncedToShopify: true })
      .where(eq(trackingUpdates.id, inserted.id))

    if (status?.toUpperCase() === 'DELIVERED') {
      await db.update(orderMappings)
        .set({ status: ORDER_STATUS.FULFILLED })
        .where(eq(orderMappings.zapprOrderId, zapprOrderId))
    }

    log.info({ zapprOrderId, status, trackingNumber }, 'Tracking synced to Shopify')
  } catch (err) {
    log.error({ err, zapprOrderId }, 'Failed to sync tracking to Shopify')
    throw err
  }
}
