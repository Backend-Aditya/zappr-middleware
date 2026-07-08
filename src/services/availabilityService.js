import { AVAILABILITY_REASON } from '../config/constants.js'
import { getCachedStock, setCachedStock } from '../cache/stockCache.js'
import { isPincodeServiceable } from '../cache/pincodeCache.js'
import { computeSurcharge } from './surchargeService.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('availability-service')

/**
 * @typedef {object} AvailabilityInput
 * @property {string} pincode
 * @property {string} variantId
 * @property {number} quantity
 * @property {string} zapprSku
 * @property {boolean} zapprEligible - from cart attributes / variant metafield
 *
 * @typedef {object} AvailabilityResult
 * @property {boolean} available
 * @property {'SAME_DAY' | 'NEXT_DAY' | null} slot
 * @property {string | null} deliveryPromise
 * @property {number} surcharge
 * @property {string | null} reason
 */

/**
 * Run the three-check Zappr availability logic.
 * Short-circuits on first failure. Never throws — returns available:false with reason.
 *
 * @param {AvailabilityInput} input
 * @param {import('../zappr/adapter.js').ZapprAdapter} adapter
 * @returns {Promise<AvailabilityResult>}
 */
export async function checkAvailability(input, adapter) {
  const { pincode, quantity, zapprSku, zapprEligible } = input

  const unavailable = (reason) => ({ available: false, slot: null, deliveryPromise: null, surcharge: 0, reason })

  // Check 1: variant must be Zappr-eligible (from metafield, no API call)
  if (!zapprEligible) {
    return unavailable(AVAILABILITY_REASON.NOT_ELIGIBLE)
  }

  // Check 2: pincode must be in cached serviceable set
  const serviceable = await isPincodeServiceable(pincode)
  if (!serviceable) {
    return unavailable(AVAILABILITY_REASON.PINCODE_NOT_SERVICEABLE)
  }

  // Check 3: stock check (Redis cache → Zappr API)
  try {
    let stock = await getCachedStock(zapprSku)

    if (!stock) {
      stock = await adapter.checkStock({ zapprSku, quantity })
      await setCachedStock(zapprSku, stock)
    }

    if (!stock.available || stock.quantity < quantity) {
      return unavailable(AVAILABILITY_REASON.OUT_OF_STOCK)
    }
  } catch (err) {
    log.error({ err, zapprSku }, 'Stock check failed — degrading gracefully')
    return unavailable(AVAILABILITY_REASON.ZAPPR_UNAVAILABLE)
  }

  const { slot, surcharge, deliveryPromise } = computeSurcharge()
  return { available: true, slot, deliveryPromise, surcharge, reason: null }
}
