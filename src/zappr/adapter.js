import { env } from '../config/env.js'

/**
 * @typedef {{ available: boolean, quantity: number }} StockResult
 * @typedef {{ serviceable: boolean }} PincodeResult
 * @typedef {{ zapprOrderId: string, estimatedDelivery: string | null }} CreateOrderResult
 * @typedef {{ status: string, trackingNumber: string | null, trackingUrl: string | null }} TrackingResult
 */

/**
 * @typedef {object} ZapprAdapter
 * @property {(opts: { zapprSku: string, quantity: number }) => Promise<StockResult>} checkStock
 * @property {(opts: { pincode: string }) => Promise<PincodeResult>} checkPincode
 * @property {(opts: { items: Array<{zapprSku:string,quantity:number}>, pincode: string, slot: string, address: object, shopifyReference: string }) => Promise<CreateOrderResult>} createOrder
 * @property {(opts: { zapprOrderId: string }) => Promise<TrackingResult>} getTracking
 * @property {(opts: { zapprOrderId: string, reason?: string }) => Promise<object>} cancelOrder
 * @property {(opts: { invoiceId: string }) => Promise<object>} getOrderDetails
 */

let _adapter = null

/**
 * Lazily load and return the active adapter based on ZAPPR_MODE env var.
 * @returns {Promise<ZapprAdapter>}
 */
export async function getAdapter() {
  if (_adapter) return _adapter

  if (env.ZAPPR_MODE === 'mock') {
    const { mockAdapter } = await import('./mockAdapter.js')
    _adapter = mockAdapter
  } else {
    const { realAdapter } = await import('./realAdapter.js')
    _adapter = realAdapter
  }

  return _adapter
}

/**
 * Reset adapter (for testing).
 * @param {ZapprAdapter | null} adapter
 */
export function _setAdapter(adapter) {
  _adapter = adapter
}
