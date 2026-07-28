import { eq } from 'drizzle-orm'
import { getDb } from '../db/postgres/connection.js'
import { zapprSyncedSkus } from '../db/postgres/schema.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('zappr-inventory-sync-service')

/**
 * Track a SKU for periodic Shopify inventory sync. Upsert — safe to call
 * repeatedly (e.g. on every order push for the same SKU).
 * @param {{ sku: string, shopifyVariantId: string, shopifyInventoryItemId: string }} opts
 * @returns {Promise<void>}
 */
export async function trackEligibleSku({ sku, shopifyVariantId, shopifyInventoryItemId }) {
  if (!sku || !shopifyInventoryItemId) return

  await getDb().insert(zapprSyncedSkus)
    .values({ sku, shopifyVariantId, shopifyInventoryItemId })
    .onConflictDoUpdate({
      target: zapprSyncedSkus.sku,
      set: { shopifyVariantId, shopifyInventoryItemId },
    })

  log.info({ sku }, 'SKU tracked for Zappr inventory sync')
}

/**
 * @returns {Promise<Array<{ sku: string, shopifyInventoryItemId: string }>>}
 */
export async function getTrackedSkus() {
  return getDb().select({
    sku: zapprSyncedSkus.sku,
    shopifyInventoryItemId: zapprSyncedSkus.shopifyInventoryItemId,
  }).from(zapprSyncedSkus)
}

/**
 * Record the quantity last pushed to Shopify for a SKU.
 * @param {string} sku
 * @param {number} quantity
 * @returns {Promise<void>}
 */
export async function recordSyncedQuantity(sku, quantity) {
  await getDb().update(zapprSyncedSkus)
    .set({ lastQuantity: quantity, lastSyncedAt: new Date() })
    .where(eq(zapprSyncedSkus.sku, sku))
}
