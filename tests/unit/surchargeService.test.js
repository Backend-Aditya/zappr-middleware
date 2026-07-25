import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/config/env.js', () => ({
  env: {
    ZAPPR_SURCHARGE_ENABLED: true,
    ZAPPR_SURCHARGE_AMOUNT: 49,
    ZAPPR_HOLIDAYS: [],
  },
}))

// Import after mocks
const { computeSurcharge } = await import('../../src/services/surchargeService.js')
const { DELIVERY_SLOT } = await import('../../src/config/constants.js')

describe('computeSurcharge', () => {
  it('returns SAME_DAY slot before 21:00 IST', () => {
    // 09:00 IST = 03:30 UTC
    const at = new Date('2026-06-27T03:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.SAME_DAY)
    expect(result.surcharge).toBe(49)
    expect(result.deliveryPromise).toMatch(/within 1 hour/)
  })

  it('returns NEXT_DAY slot at exactly 21:00 IST', () => {
    // 21:00 IST = 15:30 UTC
    const at = new Date('2026-06-27T15:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.NEXT_DAY)
  })

  it('returns NEXT_DAY slot after 21:00 IST', () => {
    // 23:00 IST = 17:30 UTC
    const at = new Date('2026-06-27T17:30:00Z')
    const result = computeSurcharge(at)
    expect(result.slot).toBe(DELIVERY_SLOT.NEXT_DAY)
  })
})

describe('computeSurcharge with holidays', () => {
  it('returns NEXT_DAY on a configured holiday even before 21:00 IST', async () => {
    vi.resetModules()
    vi.doMock('../../src/config/env.js', () => ({
      env: {
        ZAPPR_SURCHARGE_ENABLED: true,
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
