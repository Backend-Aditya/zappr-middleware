import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { hmacSha256Base64 } from '../../src/utils/crypto.js'
import { env } from '../../src/config/env.js'
import { ORDER_STATUS } from '../../src/config/constants.js'

const mockSelectResult = { value: [] }
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn().mockImplementation(() => Promise.resolve(mockSelectResult.value)),
    })),
  })),
}))

vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  })),
  connectPostgres: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/queue/queues.js', () => ({
  orderPushQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  },
}))

vi.mock('../../src/utils/lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
}))

const mockGetOrderByFulfillmentOrder = vi.fn()
vi.mock('../../src/shopify/fulfillment.js', () => ({
  getOrderByFulfillmentOrder: (...args) => mockGetOrderByFulfillmentOrder(...args),
}))

const { orderPushQueue } = await import('../../src/queue/queues.js')

function makeInsertChain() {
  return vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    })),
  }))
}

function makeUpdateChain() {
  return vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
  }))
}

const ZAPPR_LOCATION_GID = 'gid://shopify/Location/999'

function movePayload(overrides = {}) {
  return {
    original_fulfillment_order: { id: 111, status: 'closed', assigned_location_id: 1 },
    moved_fulfillment_order: { id: 222, status: 'open', assigned_location_id: 999 },
    destination_location_id: 999,
    source_location: { id: 1 },
    ...overrides,
  }
}

function signedWebhookHeaders(body) {
  const rawBody = Buffer.from(JSON.stringify(body))
  const hmac = hmacSha256Base64(process.env.SHOPIFY_WEBHOOK_SECRET, rawBody)
  return {
    'x-shopify-hmac-sha256': hmac,
    'content-type': 'application/json',
  }
}

let app

async function postMove(payload) {
  const headers = signedWebhookHeaders(payload)
  return request(app)
    .post('/webhooks/fulfillment-order-moved')
    .set(headers)
    .send(JSON.stringify(payload))
}

beforeAll(() => {
  app = createApp()
})

beforeEach(() => {
  mockInsert.mockImplementation(makeInsertChain())
  mockUpdate.mockImplementation(makeUpdateChain())
  mockSelectResult.value = []
  orderPushQueue.add.mockClear()
  mockGetOrderByFulfillmentOrder.mockReset()
  mockGetOrderByFulfillmentOrder.mockResolvedValue({
    shopifyOrderId: '123456789',
    shopifyOrderName: '#1001',
    cancelledAt: null,
    fulfillmentOrderStatus: 'open',
  })
  env.ZAPPR_SHOPIFY_LOCATION_ID = ZAPPR_LOCATION_GID
})

describe('POST /webhooks/fulfillment-order-moved', () => {
  it('skips when ZAPPR_SHOPIFY_LOCATION_ID is unset', async () => {
    delete env.ZAPPR_SHOPIFY_LOCATION_ID
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('skips when moved to a location other than the Zappr location', async () => {
    const res = await postMove(movePayload({ destination_location_id: 5, moved_fulfillment_order: { id: 222, status: 'open', assigned_location_id: 5 } }))
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('skips when the moved fulfillment order is not open', async () => {
    const res = await postMove(movePayload({ moved_fulfillment_order: { id: 222, status: 'closed', assigned_location_id: 999 } }))
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('skips when the order is cancelled', async () => {
    mockGetOrderByFulfillmentOrder.mockResolvedValue({
      shopifyOrderId: '123456789',
      shopifyOrderName: '#1001',
      cancelledAt: '2026-01-01T00:00:00Z',
      fulfillmentOrderStatus: 'open',
    })
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('creates a mapping and queues a push for an order with no prior mapping', async () => {
    mockSelectResult.value = []
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockInsert).toHaveBeenCalled()
    expect(orderPushQueue.add).toHaveBeenCalledWith('push-order', {
      shopifyOrderId: '123456789',
      shopifyOrderName: '#1001',
    })
  })

  it('skips when the order is already PUSHED (own move-after-push loop)', async () => {
    mockSelectResult.value = [{ status: ORDER_STATUS.PUSHED, zapprOrderId: 'z-1' }]
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('skips when the order is already CANCELLED', async () => {
    mockSelectResult.value = [{ status: ORDER_STATUS.CANCELLED }]
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('skips when the order is already PENDING (in-flight)', async () => {
    mockSelectResult.value = [{ status: ORDER_STATUS.PENDING }]
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
    expect(orderPushQueue.add).not.toHaveBeenCalled()
  })

  it('resets a FAILED order to PENDING and re-queues the push', async () => {
    mockSelectResult.value = [{ status: ORDER_STATUS.FAILED }]
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalled()
    expect(orderPushQueue.add).toHaveBeenCalledWith('push-order', {
      shopifyOrderId: '123456789',
      shopifyOrderName: '#1001',
    })
  })

  it('resets a FALLBACK order to PENDING and re-queues the push', async () => {
    mockSelectResult.value = [{ status: ORDER_STATUS.FALLBACK }]
    const res = await postMove(movePayload())
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(orderPushQueue.add).toHaveBeenCalledWith('push-order', {
      shopifyOrderId: '123456789',
      shopifyOrderName: '#1001',
    })
  })

  it('returns 401 for missing HMAC', async () => {
    const res = await request(app)
      .post('/webhooks/fulfillment-order-moved')
      .set('content-type', 'application/json')
      .send(JSON.stringify(movePayload()))
    expect(res.status).toBe(401)
  })
})
