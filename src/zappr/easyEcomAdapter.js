import { env } from '../config/env.js'
import { ZapprApiError } from '../errors.js'
import { SERVICEABLE_PINCODES } from '../config/constants.js'

/**
 * Build a ZapprAdapter speaking EasyEcom's API against any client factory.
 * Used by both realAdapter (api.easyecom.io) and mockAdapter (mock-zappr-server) —
 * the request/response contract is identical, only base URL and credentials differ.
 *
 * @param {() => import('ky').KyInstance} client
 * @returns {import('./adapter.js').ZapprAdapter}
 */
export function buildEasyEcomAdapter(client) {
  return {
    /**
     * @param {{ zapprSku: string, quantity: number }} opts
     * @returns {Promise<{ available: boolean, quantity: number }>}
     */
    async checkStock({ zapprSku }) {
      try {
        const res = await client().get('getInventoryDetailsV3', {
          searchParams: {
            includeLocations: 1,
            inlcudeCustomers: 0,
            limit: 50,
            sku: zapprSku,
            get_back_orders: false,
          },
        }).json()

        // Real API nests rows under data.inventoryData; tolerate a bare
        // data[] array too (older shape used by fixtures/mock).
        const rows = Array.isArray(res?.data?.inventoryData)
          ? res.data.inventoryData
          : Array.isArray(res?.data) ? res.data : []
        const quantity = rows.reduce(
          (sum, row) => sum + Number(row.availableInventory ?? row.availableQuantity ?? row.available_quantity ?? row.quantity ?? 0),
          0,
        )

        // available = any stock at hand; callers compare quantity against
        // their requested amount (the result is cached per-SKU, not per-request)
        return { available: quantity > 0, quantity }
      } catch (err) {
        throw new ZapprApiError(`Stock check failed: ${err.message}`)
      }
    },

    /**
     * EasyEcom has no serviceability API — static allowlist from the Zappr team.
     * @param {{ pincode: string }} opts
     * @returns {Promise<{ serviceable: boolean }>}
     */
    async checkPincode({ pincode }) {
      return { serviceable: SERVICEABLE_PINCODES.includes(pincode) }
    },

    /**
     * @param {{ items: Array<{zapprSku:string,quantity:number}>, pincode: string, slot: string, address: object, shopifyReference: string }} opts
     * @returns {Promise<{ zapprOrderId: string, estimatedDelivery: string | null }>}
     */
    async createOrder({ items, pincode, address, shopifyReference }) {
      try {
        const body = {
          orderType: 'retailorder',
          marketplaceId: env.ZAPPR_MARKETPLACE_ID,
          orderNumber: shopifyReference,
          orderDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
          shippingMethod: 1,
          ...(env.ZAPPR_CARRIER_ID ? { company_carrier_id: env.ZAPPR_CARRIER_ID } : {}),
          items: items.map((item, idx) => ({
            OrderItemId: `${shopifyReference}-${idx}`,
            Sku: item.zapprSku,
            productName: item.zapprSku,
            Quantity: String(item.quantity),
            // Price is mandatory — EasyEcom rejects the order without it
            Price: String(item.price ?? '1'),
          })),
          customer: [{
            shipping: {
              name: address?.name ?? '',
              addressLine1: address?.address1 ?? '',
              addressLine2: address?.address2 ?? '',
              postalCode: pincode,
              city: address?.city ?? '',
              state: address?.province ?? '',
              country: address?.country ?? 'India',
              contact: address?.phone ?? '',
              email: address?.email ?? '',
            },
          }],
        }

        const res = await client().post('webhook/v2/createOrder', { json: body }).json()

        // EasyEcom can return HTTP 200 with a failure body: either
        // { status: false } or { code: 400, data: [{ Message }] }
        if (res?.status === false || Number(res?.code) >= 400) {
          const itemErrors = Array.isArray(res?.data)
            ? res.data.map((d) => d?.Message).filter(Boolean).join('; ')
            : ''
          throw new Error([res?.message ?? 'EasyEcom rejected the order', itemErrors].filter(Boolean).join(' — '))
        }

        // EasyEcom keys tracking/cancel/detail lookups off the reference_code we
        // supply (orderNumber), not a value it returns — so that's our zapprOrderId.
        // Its own IDs are kept as metadata for support lookups.
        return {
          zapprOrderId: shopifyReference,
          estimatedDelivery: null,
          easyEcomOrderId: res?.data?.OrderID ?? null,
          invoiceId: res?.data?.InvoiceID ?? null,
        }
      } catch (err) {
        throw new ZapprApiError(`Create order failed: ${err.message}`)
      }
    },

    /**
     * @param {{ zapprOrderId: string }} opts
     * @returns {Promise<{ status: string, trackingNumber: string | null, trackingUrl: string | null }>}
     */
    async getTracking({ zapprOrderId }) {
      try {
        const res = await client().get('Carriers/getTrackingDetails', {
          searchParams: { reference_code: zapprOrderId },
        }).json()

        // Real response is { code, message, data: [ {...} ] } — data is an
        // array even for a single order. Tolerate a bare array/object too.
        const row = Array.isArray(res?.data)
          ? res.data[0]
          : Array.isArray(res)
            ? res[0]
            : (res?.data ?? res)

        return {
          status: row?.orderStatus ?? row?.currentShippingStatus ?? 'PENDING',
          trackingNumber: row?.awbNumber != null ? String(row.awbNumber) : null,
          trackingUrl: row?.trackingUrl ?? null,
        }
      } catch (err) {
        throw new ZapprApiError(`Get tracking failed: ${err.message}`)
      }
    },

    /**
     * @param {{ zapprOrderId: string }} opts
     * @returns {Promise<object>}
     */
    async cancelOrder({ zapprOrderId }) {
      try {
        return await client().post('orders/cancelOrder', {
          json: { reference_code: zapprOrderId },
        }).json()
      } catch (err) {
        throw new ZapprApiError(`Cancel order failed: ${err.message}`)
      }
    },

    /**
     * @param {{ invoiceId: string }} opts
     * @returns {Promise<object>}
     */
    async getOrderDetails({ invoiceId }) {
      try {
        return await client().get('orders/V2/getOrderDetails', {
          searchParams: { invoice_id: invoiceId },
        }).json()
      } catch (err) {
        throw new ZapprApiError(`Get order details failed: ${err.message}`)
      }
    },
  }
}
