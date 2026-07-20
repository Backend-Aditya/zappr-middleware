import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ORDER_STATUS } from '../../src/config/constants.js'
import { ZapprApiError } from '../../src/errors.js'

// Minimal in-memory stand-in for ioredis, just enough for acquireLock's
// SET key val PX ttl NX + Lua-conditional-DEL release to behave like the
// real thing — this is what lets the concurrency test below be a genuine
// race instead of an assertion on mock call order.
function makeFakeRedis() {
  const store = new Map()
  return {
    async set(key, value, mode, _ttl, flag) {
      if (mode !== 'PX' || flag !== 'NX') throw new Error('unexpected redis.set args')
      if (store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    async eval(_script, _numKeys, key, token) {
      if (store.get(key) === token) {
        store.delete(key)
        return 1
      }
      return 0
    },
  }
}

const fakeRedis = makeFakeRedis()

vi.mock('../../src/cache/redis.js', () => ({
  getRedis: () => fakeRedis,
}))

vi.mock('../../src/shopify/fulfillment.js', () => ({
  getFulfillmentOrders: vi.fn(),
}))

vi.mock('../../src/services/availabilityService.js', () => ({
  // Pre-push availability re-check (pincode/eligibility) always passes here —
  // this suite is only exercising the fresh-stock race-guard, not check 1/2.
  checkAvailability: vi.fn(() => ({ available: true, reason: null })),
}))

vi.mock('../../src/services/surchargeService.js', () => ({
  computeSurcharge: vi.fn(() => ({ slot: 'SAME_DAY', surcharge: 49, deliveryPromise: 'today' })),
}))

vi.mock('../../src/cache/stockCache.js', () => ({
  invalidateStock: vi.fn(),
}))

vi.mock('../../src/queue/queues.js', () => ({
  trackingPollQueue: { add: vi.fn() },
}))

const dbState = { updates: [] }
vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: () => ({
    update: () => ({
      set: (values) => ({
        where: () => {
          dbState.updates.push(values)
          return Promise.resolve()
        },
      }),
    }),
  }),
}))

const { getFulfillmentOrders } = await import('../../src/shopify/fulfillment.js')
const { pushOrderToZappr } = await import('../../src/services/orderService.js')

function fulfillmentOrderFixture(shopifyOrderId, sku, quantity) {
  return {
    order: {
      fulfillmentOrders: {
        nodes: [{
          id: `gid://shopify/FulfillmentOrder/${shopifyOrderId}`,
          destination: { zip: '560102', firstName: 'A', lastName: 'B', countryCode: 'IN' },
          lineItems: {
            nodes: [{
              sku,
              remainingQuantity: quantity,
              variant: { id: 'gid://shopify/ProductVariant/1', price: '1.00', metafield: { value: 'true' } },
            }],
          },
        }],
      },
    },
  }
}

function makeAdapter({ stockBySku, createOrderImpl }) {
  return {
    checkStock: vi.fn(async ({ zapprSku }) => ({ ...stockBySku[zapprSku] })),
    createOrder: vi.fn(createOrderImpl),
  }
}

beforeEach(() => {
  dbState.updates.length = 0
  vi.clearAllMocks()
})

describe('pushOrderToZappr — concurrent pushes for the same SKU', () => {
  it('only one of two simultaneous pushes for the last unit gets PUSHED; the other gets FALLBACK', async () => {
    // Two different Shopify orders, same SKU, only 1 unit in stock, each wants 1.
    getFulfillmentOrders.mockImplementation((gid) => {
      const id = gid.split('/').pop()
      return Promise.resolve(fulfillmentOrderFixture(id, 'SKU-1', 1))
    })

    let remaining = 1
    let concurrentCallsDuringLock = 0
    let maxConcurrent = 0

    const adapter = makeAdapter({
      stockBySku: {},
      createOrderImpl: async () => {
        concurrentCallsDuringLock++
        maxConcurrent = Math.max(maxConcurrent, concurrentCallsDuringLock)
        await new Promise((r) => setTimeout(r, 20)) // hold the lock long enough to overlap
        concurrentCallsDuringLock--
        if (remaining <= 0) throw new ZapprApiError('EasyEcom rejected: insufficient stock')
        remaining -= 1
        return { zapprOrderId: 'ref', estimatedDelivery: null, easyEcomOrderId: '1', invoiceId: '1' }
      },
    })
    // checkStock reflects live `remaining` at call time, same object both orders share
    adapter.checkStock = vi.fn(async () => ({ available: remaining > 0, quantity: remaining }))

    const [r1, r2] = await Promise.allSettled([
      pushOrderToZappr({ shopifyOrderId: '1001' }, adapter),
      pushOrderToZappr({ shopifyOrderId: '1002' }, adapter),
    ])

    expect(r1.status).toBe('fulfilled')
    expect(r2.status).toBe('fulfilled')

    // The lock must have prevented both createOrder calls from ever running concurrently.
    expect(maxConcurrent).toBe(1)

    const statuses = dbState.updates.map((u) => u.status)
    expect(statuses).toContain(ORDER_STATUS.PUSHED)
    expect(statuses).toContain(ORDER_STATUS.FALLBACK)
    expect(statuses.filter((s) => s === ORDER_STATUS.PUSHED)).toHaveLength(1)
  })
})

describe('pushOrderToZappr — EasyEcom stock rejection at createOrder time', () => {
  it('routes to FALLBACK instead of throwing (no endless retry loop)', async () => {
    getFulfillmentOrders.mockResolvedValue(fulfillmentOrderFixture('2001', 'SKU-2', 1))

    const adapter = makeAdapter({
      stockBySku: { 'SKU-2': { available: true, quantity: 5 } },
      createOrderImpl: async () => {
        throw new ZapprApiError('Create order failed: insufficient stock for SKU-2')
      },
    })

    await expect(pushOrderToZappr({ shopifyOrderId: '2001' }, adapter)).resolves.toBeUndefined()

    expect(dbState.updates).toHaveLength(1)
    expect(dbState.updates[0].status).toBe(ORDER_STATUS.FALLBACK)
  })

  it('still throws (for retry) on a non-stock-related createOrder error', async () => {
    getFulfillmentOrders.mockResolvedValue(fulfillmentOrderFixture('2002', 'SKU-3', 1))

    const adapter = makeAdapter({
      stockBySku: { 'SKU-3': { available: true, quantity: 5 } },
      createOrderImpl: async () => {
        throw new ZapprApiError('Create order failed: 503 upstream timeout')
      },
    })

    await expect(pushOrderToZappr({ shopifyOrderId: '2002' }, adapter)).rejects.toThrow(/timeout/)
    expect(dbState.updates).toHaveLength(0)
  })
})
