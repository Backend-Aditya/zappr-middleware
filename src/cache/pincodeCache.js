import { CACHE_KEYS, SERVICEABLE_PINCODES } from '../config/constants.js'
import { getRedis } from './redis.js'

/**
 * Check if a pincode is in the cached serviceable set.
 * @param {string} pincode
 * @returns {Promise<boolean>}
 */
export async function isPincodeServiceable(pincode) {
  return (await getRedis().sismember(CACHE_KEYS.PINCODE_SET, pincode)) === 1
}

/**
 * Replace the entire pincode set (atomic swap).
 * @param {string[]} pincodes
 * @returns {Promise<void>}
 */
export async function setPincodes(pincodes) {
  if (pincodes.length === 0) return

  const redis = getRedis()
  const pipeline = redis.pipeline()
  const tmpKey = `${CACHE_KEYS.PINCODE_SET}:tmp`

  pipeline.del(tmpKey)
  pipeline.sadd(tmpKey, ...pincodes)
  pipeline.rename(tmpKey, CACHE_KEYS.PINCODE_SET)
  await pipeline.exec()
}

/**
 * Seed the serviceable-pincode set from the static Zappr/EasyEcom allowlist.
 * EasyEcom has no pincode API, so this replaces the old API-driven refresh.
 * @returns {Promise<void>}
 */
export async function seedServiceablePincodes() {
  await setPincodes(SERVICEABLE_PINCODES)
}

/**
 * Get all cached pincodes (for debugging).
 * @returns {Promise<string[]>}
 */
export async function getAllPincodes() {
  return getRedis().smembers(CACHE_KEYS.PINCODE_SET)
}

/**
 * Number of cached pincodes.
 * @returns {Promise<number>}
 */
export async function getPincodeCount() {
  return getRedis().scard(CACHE_KEYS.PINCODE_SET)
}
