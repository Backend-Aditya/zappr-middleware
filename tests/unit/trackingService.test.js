import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/shopify/fulfillment.js', () => ({
  createFulfillment: vi.fn(async () => ({ fulfillmentId: 'gid://shopify/Fulfillment/1' })),
  updateFulfillmentTracking: vi.fn(async () => {}),
}))

// Two-queue fake DB: `selectQueue` answers each `db.select()...` call in order
// (first = "previous tracking_updates row", second = "order mapping" when the
// code path reaches that far); inserts/updates are just recorded.
const state = { selectQueue: [], inserted: [], updated: [] }

vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(state.selectQueue.shift() ?? []) }),
          limit: () => Promise.resolve(state.selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (v) => ({
        returning: () => {
          const row = { id: `row-${state.inserted.length}`, ...v }
          state.inserted.push(row)
          return Promise.resolve([row])
        },
      }),
    }),
    update: () => ({
      set: (v) => ({
        where: () => {
          state.updated.push(v)
          return Promise.resolve()
        },
      }),
    }),
  }),
}))

const { createFulfillment, updateFulfillmentTracking } = await import('../../src/shopify/fulfillment.js')
const { processTrackingUpdate } = await import('../../src/services/trackingService.js')

beforeEach(() => {
  vi.clearAllMocks()
  state.selectQueue = []
  state.inserted = []
  state.updated = []
})

describe('processTrackingUpdate — dedup against unchanged status', () => {
  it('skips entirely (no insert, no Shopify call) when status and trackingNumber match the last recorded update', async () => {
    state.selectQueue = [
      // "previous" lookup — identical status + trackingNumber already on record
      [{ status: 'Confirmed', trackingNumber: '1784177558452GDTF7R3N' }],
    ]

    await processTrackingUpdate({
      zapprOrderId: 'ref-1',
      status: 'Confirmed',
      trackingNumber: '1784177558452GDTF7R3N',
      trackingUrl: null,
    })

    expect(state.inserted).toHaveLength(0)
    expect(createFulfillment).not.toHaveBeenCalled()
    expect(updateFulfillmentTracking).not.toHaveBeenCalled()
  })

  it('proceeds and calls updateFulfillmentTracking when the status genuinely changed', async () => {
    state.selectQueue = [
      // "previous" lookup — different status than the incoming update
      [{ status: 'Assigned', trackingNumber: '1784177558452GDTF7R3N' }],
      // order mapping lookup — fulfillment already exists from a prior sync
      [{ id: 'map-1', fulfillmentOrderId: 'fo-1', shopifyFulfillmentId: 'gid://shopify/Fulfillment/1' }],
    ]

    await processTrackingUpdate({
      zapprOrderId: 'ref-1',
      status: 'Shipped',
      trackingNumber: '1784177558452GDTF7R3N',
      trackingUrl: null,
    })

    expect(state.inserted).toHaveLength(1)
    expect(updateFulfillmentTracking).toHaveBeenCalledTimes(1)
    expect(createFulfillment).not.toHaveBeenCalled()
  })

  it('proceeds on the very first update for an order (no previous row)', async () => {
    state.selectQueue = [
      [], // no previous tracking_updates row
      [{ id: 'map-1', fulfillmentOrderId: 'fo-1', shopifyFulfillmentId: null }],
    ]

    await processTrackingUpdate({
      zapprOrderId: 'ref-2',
      status: 'Confirmed',
      trackingNumber: 'AWB-NEW',
      trackingUrl: null,
    })

    expect(state.inserted).toHaveLength(1)
    expect(createFulfillment).toHaveBeenCalledTimes(1)
  })
})
