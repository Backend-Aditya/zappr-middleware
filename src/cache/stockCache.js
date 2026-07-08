import { env } from '../config/env.js'
import { CACHE_KEYS } from '../config/constants.js'
import { getRedis } from './redis.js'

/**
 * @typedef {{ available: boolean, quantity: number }} StockResult
 */

/**
 * Get cached stock result for a SKU.
 * @param {string} sku
 * @returns {Promise<StockResult | null>}
 */
export async function getCachedStock(sku) {
  const raw = await getRedis().get(CACHE_KEYS.STOCK(sku))
  return raw ? JSON.parse(raw) : null
}

/**
 * Cache stock result for a SKU.
 * @param {string} sku
 * @param {StockResult} result
 * @returns {Promise<void>}
 */
export async function setCachedStock(sku, result) {
  await getRedis().setex(
    CACHE_KEYS.STOCK(sku),
    env.ZAPPR_STOCK_TTL_SECONDS,
    JSON.stringify(result),
  )
}

/**
 * Invalidate cached stock for a SKU (call after order is pushed).
 * @param {string} sku
 * @returns {Promise<void>}
 */
export async function invalidateStock(sku) {
  await getRedis().del(CACHE_KEYS.STOCK(sku))
}
