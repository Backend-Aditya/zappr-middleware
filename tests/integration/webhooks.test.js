import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { hmacSha256Base64 } from '../../src/utils/crypto.js'

const mockInsert = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    update: mockUpdate,
  })),
  connectPostgres: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/queue/queues.js', () => ({
  orderPushQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  },
}))

const { orderPushQueue } = await import('../../src/queue/queues.js')

function makeInsertChain(returning) {
  return vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue(returning),
      })),
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

const ORDER_PAYLOAD = {
  id: 123456789,
  name: '#1001',
  email: 'customer@test.com',
  fulfillments: [],
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

beforeAll(() => {
  app = createApp()
})

describe('POST /webhooks/orders-paid', () => {
  it('returns 200 and queues job on valid webhook', async () => {
    mockInsert.mockImplementation(makeInsertChain([{ id: 'uuid-1' }]))
    mockUpdate.mockImplementation(makeUpdateChain())

    const headers = signedWebhookHeaders(ORDER_PAYLOAD)
    const res = await request(app)
      .post('/webhooks/orders-paid')
      .set(headers)
      .send(JSON.stringify(ORDER_PAYLOAD))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(orderPushQueue.add).toHaveBeenCalledWith('push-order', {
      shopifyOrderId: '123456789',
      shopifyOrderName: '#1001',
    })
  })

  it('returns 200 and skips on duplicate (empty returning array)', async () => {
    // ON CONFLICT DO NOTHING → returning([]) → duplicate
    mockInsert.mockImplementation(makeInsertChain([]))
    mockUpdate.mockImplementation(makeUpdateChain())

    const headers = signedWebhookHeaders(ORDER_PAYLOAD)
    const res = await request(app)
      .post('/webhooks/orders-paid')
      .set(headers)
      .send(JSON.stringify(ORDER_PAYLOAD))

    expect(res.status).toBe(200)
    expect(res.body.skipped).toBe(true)
  })

  it('returns 401 for missing HMAC', async () => {
    const res = await request(app)
      .post('/webhooks/orders-paid')
      .set('content-type', 'application/json')
      .send(JSON.stringify(ORDER_PAYLOAD))

    expect(res.status).toBe(401)
  })
})
