export const TRACKING_STATES = ['Pending', 'Shipped', 'Out For Pickup', 'Delivered']

/** @type {Map<string, object>} keyed by reference_code (our orderNumber) */
export const orderStore = new Map()

/** @type {Map<number, string>} invoiceId -> reference_code */
export const invoiceIndex = new Map()

let nextInvoiceId = 176305783

export function nextInvoiceIdValue() {
  nextInvoiceId += 1
  return nextInvoiceId
}

const STATE_ADVANCE_INTERVAL_MS = 30_000

/**
 * Advance tracking state machine every 30s (dev only).
 */
export function startStateMachine() {
  setInterval(() => {
    for (const [referenceCode, order] of orderStore.entries()) {
      if (order.stateIndex < TRACKING_STATES.length - 1) {
        order.stateIndex += 1
        order.orderStatus = TRACKING_STATES[order.stateIndex]

        if (order.stateIndex === 1) {
          order.awbNumber = `AWB${referenceCode}`.slice(0, 20)
        }

        orderStore.set(referenceCode, order)
      }
    }
  }, STATE_ADVANCE_INTERVAL_MS)
}
