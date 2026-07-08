import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { hmacSha256Hex } from '../../src/utils/crypto.js'

vi.mock('../../src/zappr/adapter.js', () => ({
  getAdapter: vi.fn(),
  _setAdapter: vi.fn(),
}))

vi.mock('../../src/cache/stockCache.js', () => ({
  getCachedStock: vi.fn().mockResolvedValue(null),
  setCachedStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/cache/pincodeCache.js', () => ({
  isPincodeServiceable: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/cache/redis.js', () => ({
  getRedis: vi.fn(() => ({
    call: vi.fn(),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn(),
  })),
}))

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  proxyRateLimiter: (_req, _res, next) => next(),
  carrierRateLimiter: (_req, _res, next) => next(),
}))

const mockAdapter = {
  checkStock: vi.fn().mockResolvedValue({ available: true, quantity: 50 }),
  checkPincode: vi.fn(),
  createOrder: vi.fn(),
  getTracking: vi.fn(),
}

const { getAdapter } = await import('../../src/zappr/adapter.js')
getAdapter.mockResolvedValue(mockAdapter)

function buildProxyQuery(overrides = {}) {
  const params = {
    pincode: '560001',
    variantId: 'gid://shopify/ProductVariant/123',
    quantity: '1',
    zapprSku: 'UNV-WHEY-1KG',
    zappr_eligible: 'true',
    path_prefix: '/apps/zappr',
    shop: 'test.myshopify.com',
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  }

  const { signature: _sig, ...rest } = params
  const message = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('')
  const signature = hmacSha256Hex(process.env.SHOPIFY_APP_PROXY_SECRET, message)

  return { ...params, signature }
}

let app

beforeAll(() => {
  // Pin clock before the 15:00 IST same-day cutoff so slot assertions are deterministic
  vi.useFakeTimers({ now: new Date('2026-07-01T04:30:00.000Z'), toFake: ['Date'] }) // 10:00 IST
  app = createApp()
})

afterAll(() => {
  vi.useRealTimers()
})

describe('GET /apps/zappr/check', () => {
  it('returns available:true when all checks pass', async () => {
    const query = buildProxyQuery()
    const res = await request(app).get('/apps/zappr/check').query(query)
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
    expect(res.body.slot).toBe('SAME_DAY')
    expect(res.body.surcharge).toBe(49)
  })

  it('returns 401 with invalid HMAC', async () => {
    const res = await request(app).get('/apps/zappr/check').query({
      pincode: '560001',
      zapprSku: 'UNV-WHEY-1KG',
      signature: 'invalid',
    })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid pincode format', async () => {
    const query = buildProxyQuery({ pincode: 'not-a-pincode' })
    const res = await request(app).get('/apps/zappr/check').query(query)
    expect(res.status).toBe(400)
  })
})
