import { env } from '../config/env.js'
import { determineSlot, deliveryPromiseText } from '../utils/time.js'

/**
 * @typedef {{ slot: 'SAME_DAY' | 'NEXT_DAY', surcharge: number, deliveryPromise: string }} SurchargeResult
 */

/**
 * Compute slot and surcharge for current time.
 * @param {Date} [at] - override for testing
 * @returns {SurchargeResult}
 */
export function computeSurcharge(at) {
  const { slot } = determineSlot(at)
  return {
    slot,
    surcharge: env.ZAPPR_SURCHARGE_AMOUNT,
    deliveryPromise: deliveryPromiseText(slot),
  }
}

/**
 * Build Shopify carrier rate response for Zappr Express.
 * @param {SurchargeResult} surchargeResult
 * @param {number} baseShippingPrice - in paise/cents (Shopify sends smallest unit)
 * @returns {object} Shopify carrier rate object
 */
export function buildCarrierRate(surchargeResult, baseShippingPrice = 0) {
  const totalPrice = baseShippingPrice + surchargeResult.surcharge * 100

  return {
    service_name: 'Zappr Express',
    service_code: `ZAPPR_${surchargeResult.slot}`,
    total_price: String(totalPrice),
    currency: 'INR',
    min_delivery_date: null,
    max_delivery_date: null,
    description: surchargeResult.deliveryPromise,
    phone_required: false,
  }
}
