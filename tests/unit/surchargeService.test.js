import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/config/env.js', () => ({
  env: {
    ZAPPR_SURCHARGE_AMOUNT: 49,
    ZAPPR_HOLIDAYS: [],
  },
}))

// Import after mocks
const { computeSurcharge } = await import('../../src/services/surchargeService.js')
const { DELIVERY_SLOT } = await import('../../src/config/constants.js')

describe('computeSurcharge', () => {
  it('returns SAME_DAY slot before 15:00 IST', () => {
    // 09:00 IST = 03:30 UTC
    const at = new Date('2026-06-27T03:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.SAME_DAY)
    expect(result.surcharge).toBe(49)
    expect(result.deliveryPromise).toMatch(/today/)
  })

  it('returns NEXT_DAY slot at exactly 15:00 IST', () => {
    // 15:00 IST = 09:30 UTC
    const at = new Date('2026-06-27T09:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.NEXT_DAY)
  })

  it('returns NEXT_DAY slot after 15:00 IST', () => {
    // 18:00 IST = 12:30 UTC
    const at = new Date('2026-06-27T12:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.NEXT_DAY)
  })
})

describe('computeSurcharge with holidays', () => {
  it('returns NEXT_DAY on a configured holiday even before 15:00 IST', async () => {
    vi.resetModules()
    vi.doMock('../../src/config/env.js', () => ({
      env: {
        ZAPPR_SURCHARGE_AMOUNT: 49,
        ZAPPR_HOLIDAYS: ['2026-06-27'],
      },
    }))
    const { computeSurcharge: cs } = await import('../../src/services/surchargeService.js')
    const at = new Date('2026-06-27T03:30:00Z') // 09:00 IST
    const result = cs(at)
    expect(result.slot).toBe(DELIVERY_SLOT.NEXT_DAY)
  })
})
