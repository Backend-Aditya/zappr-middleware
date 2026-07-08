import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AVAILABILITY_REASON } from '../../src/config/constants.js'

vi.mock('../../src/cache/stockCache.js', () => ({
  getCachedStock: vi.fn(),
  setCachedStock: vi.fn(),
}))

vi.mock('../../src/cache/pincodeCache.js', () => ({
  isPincodeServiceable: vi.fn(),
}))

vi.mock('../../src/services/surchargeService.js', () => ({
  computeSurcharge: vi.fn(() => ({
    slot: 'SAME_DAY',
    surcharge: 49,
    deliveryPromise: 'Delivered today by 9 PM',
  })),
}))

const { getCachedStock, setCachedStock } = await import('../../src/cache/stockCache.js')
const { isPincodeServiceable } = await import('../../src/cache/pincodeCache.js')
const { checkAvailability } = await import('../../src/services/availabilityService.js')

const mockAdapter = {
  checkStock: vi.fn(),
  checkPincode: vi.fn(),
  createOrder: vi.fn(),
  getTracking: vi.fn(),
}

const baseInput = {
  pincode: '560001',
  variantId: 'gid://shopify/ProductVariant/123',
  quantity: 2,
  zapprSku: 'UNV-WHEY-1KG',
  zapprEligible: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  isPincodeServiceable.mockResolvedValue(true)
  getCachedStock.mockResolvedValue(null)
  mockAdapter.checkStock.mockResolvedValue({ available: true, quantity: 50 })
  setCachedStock.mockResolvedValue(undefined)
})

describe('checkAvailability — check 1: zappr_eligible', () => {
  it('returns NOT_ELIGIBLE when variant not eligible', async () => {
    const result = await checkAvailability({ ...baseInput, zapprEligible: false }, mockAdapter)
    expect(result.available).toBe(false)
    expect(result.reason).toBe(AVAILABILITY_REASON.NOT_ELIGIBLE)
    expect(isPincodeServiceable).not.toHaveBeenCalled()
  })
})

describe('checkAvailability — check 2: pincode', () => {
  it('returns PINCODE_NOT_SERVICEABLE when pincode not in cache', async () => {
    isPincodeServiceable.mockResolvedValue(false)
    const result = await checkAvailability(baseInput, mockAdapter)
    expect(result.available).toBe(false)
    expect(result.reason).toBe(AVAILABILITY_REASON.PINCODE_NOT_SERVICEABLE)
    expect(mockAdapter.checkStock).not.toHaveBeenCalled()
  })
})

describe('checkAvailability — check 3: stock', () => {
  it('returns OUT_OF_STOCK when quantity exceeds stock', async () => {
    mockAdapter.checkStock.mockResolvedValue({ available: true, quantity: 1 })
    const result = await checkAvailability({ ...baseInput, quantity: 5 }, mockAdapter)
    expect(result.available).toBe(false)
    expect(result.reason).toBe(AVAILABILITY_REASON.OUT_OF_STOCK)
  })

  it('uses cached stock and skips adapter call', async () => {
    getCachedStock.mockResolvedValue({ available: true, quantity: 100 })
    const result = await checkAvailability(baseInput, mockAdapter)
    expect(result.available).toBe(true)
    expect(mockAdapter.checkStock).not.toHaveBeenCalled()
  })

  it('degrades gracefully when adapter throws', async () => {
    mockAdapter.checkStock.mockRejectedValue(new Error('Network error'))
    const result = await checkAvailability(baseInput, mockAdapter)
    expect(result.available).toBe(false)
    expect(result.reason).toBe(AVAILABILITY_REASON.ZAPPR_UNAVAILABLE)
  })

  it('returns available:true with slot and surcharge when all checks pass', async () => {
    const result = await checkAvailability(baseInput, mockAdapter)
    expect(result.available).toBe(true)
    expect(result.slot).toBe('SAME_DAY')
    expect(result.surcharge).toBe(49)
    expect(result.reason).toBeNull()
  })
})
