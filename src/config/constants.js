export const IST_TIMEZONE = 'Asia/Kolkata'

export const SLOT_CUTOFF_HOUR = 15 // 15:00 IST

export const ORDER_STATUS = /** @type {const} */ ({
  PENDING: 'PENDING',
  PUSHED: 'PUSHED',
  FULFILLED: 'FULFILLED',
  FAILED: 'FAILED',
  FALLBACK: 'FALLBACK',
})

export const DELIVERY_SLOT = /** @type {const} */ ({
  SAME_DAY: 'SAME_DAY',
  NEXT_DAY: 'NEXT_DAY',
})

export const TRACKING_STATUS = /** @type {const} */ ({
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
})

export const AVAILABILITY_REASON = /** @type {const} */ ({
  NOT_ELIGIBLE: 'VARIANT_NOT_ZAPPR_ELIGIBLE',
  PINCODE_NOT_SERVICEABLE: 'PINCODE_NOT_SERVICEABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  ZAPPR_UNAVAILABLE: 'ZAPPR_SERVICE_UNAVAILABLE',
  HOLIDAY: 'ZAPPR_HOLIDAY',
})

export const QUEUE_NAMES = /** @type {const} */ ({
  ORDER_PUSH: 'order-push',
  TRACKING_POLL: 'tracking-poll',
  SHOPIFY_SYNC: 'shopify-sync',
  MAINTENANCE: 'maintenance',
})

export const CACHE_KEYS = /** @type {const} */ ({
  STOCK: (sku) => `zappr:stock:${sku}`,
  PINCODE_SET: 'zappr:pincodes',
  IDEMPOTENCY: (orderId) => `idem:${orderId}`,
})

export const SHOPIFY_CARRIER_NAME = 'Zappr Express'
export const SHOPIFY_API_VERSION = '2025-01'

// EasyEcom (Zappr's fulfillment provider) has no pincode-serviceability API —
// this static allowlist was supplied directly by the Zappr team.
export const SERVICEABLE_PINCODES = [
  '560102', // HSR Layout / Haralur
  '560034', // Koramangala I - V Block
  '560095', // Koramangala VI - VIII Block
  '560076', // BTM / Arekere / JP Nagar / Bannerghatta Road
  '560068', // Bommanahalli / Akshayanagar / Kudlu
  '560103', // Bellandur / Kadubeesanahalli
  '560029', // Tavarekere / SG Palya
  '560041', // Jayanagar
  '560011', // Jayanagar 3rd Block
  '560069', // Jayanagar East
  '560007', // Agram
  '560071', // Domlur / Indiranagar South
  '560025', // Richmond Town / Langford Town
  '560030', // Shantinagar / Wilson Garden
  '560047', // Austin Town
  '560027', // Sampangiramnagar
  '560114', // Begur
  '560500', // CPC
]
