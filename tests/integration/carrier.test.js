import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { hmacSha256Base64 } from '../../src/utils/crypto.js'

vi.mock('../../src/zappr/adapter.js', () => ({
  getAdapter: vi.fn(),
}))

vi.mock('../../src/cache/stockCache.js', () => ({
  getCachedStock: vi.fn().mockResolvedValue({ available: true, quantity: 50 }),
  setCachedStock: vi.fn(),
}))

vi.mock('../../src/cache/pincodeCache.js', () => ({
  isPincodeServiceable: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  proxyRateLimiter: (_req, _res, next) => next(),
  carrierRateLimiter: (_req, _res, next) => next(),
}))

vi.mock('../../src/config/env.js', () => ({
  env: {
    ZAPPR_SURCHARGE_ENABLED: true,
    ZAPPR_SURCHARGE_AMOUNT: 49,
    ZAPPR_HOLIDAYS: [],
    SHOPIFY_WEBHOOK_SECRET: 'test-webhook-secret',
    LOG_LEVEL: 'silent',
  },
}))

const { getAdapter } = await import('../../src/zappr/adapter.js')
getAdapter.mockResolvedValue({ checkStock: vi.fn().mockResolvedValue({ available: true, quantity: 50 }) })

const CARRIER_BODY = {
  rate: {
    origin: { postal_code: '560001' },
    destination: { postal_code: '560001' },
    items: [{
      name: 'Whey Protein',
      sku: 'UNV-WHEY-1KG',
      quantity: 1,
      requires_shipping: true,
      properties: { zappr_sku: 'UNV-WHEY-1KG', zappr_eligible: 'true' },
    }],
  },
}

function signedCarrierHeaders(body) {
  const raw = Buffer.from(JSON.stringify(body))
  const hmac = hmacSha256Base64(process.env.SHOPIFY_WEBHOOK_SECRET, raw)
  return { 'x-shopify-hmac-sha256': hmac, 'content-type': 'application/json' }
}

let app

beforeAll(() => {
  app = createApp()
})

describe('POST /carrier', () => {
  it('returns Zappr rate when eligible', async () => {
    const headers = signedCarrierHeaders(CARRIER_BODY)
    const res = await request(app)
      .post('/carrier')
      .set(headers)
      .send(JSON.stringify(CARRIER_BODY))

    expect(res.status).toBe(200)
    expect(res.body.rates).toHaveLength(1)
    expect(res.body.rates[0].service_name).toBe('Zappr Express')
    expect(res.body.rates[0].currency).toBe('INR')
    expect(Number(res.body.rates[0].total_price)).toBeGreaterThan(0)
  })

  it('returns empty rates on invalid HMAC', async () => {
    const res = await request(app)
      .post('/carrier')
      .set({ 'x-shopify-hmac-sha256': 'invalid', 'content-type': 'application/json' })
      .send(JSON.stringify(CARRIER_BODY))

    expect(res.status).toBe(401)
  })
})
