import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { inserted: [], conflictSets: [], updated: [], selectResult: [] }

vi.mock('../../src/db/postgres/connection.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: (v) => ({
        onConflictDoUpdate: ({ set }) => {
          state.inserted.push(v)
          state.conflictSets.push(set)
          return Promise.resolve()
        },
      }),
    }),
    select: () => ({
      from: () => Promise.resolve(state.selectResult),
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

const { trackEligibleSku, getTrackedSkus, recordSyncedQuantity } = await import('../../src/services/zapprInventorySyncService.js')

beforeEach(() => {
  state.inserted.length = 0
  state.conflictSets.length = 0
  state.updated.length = 0
  state.selectResult = []
})

describe('trackEligibleSku', () => {
  it('upserts the SKU with variant and inventory item ids', async () => {
    await trackEligibleSku({ sku: 'SKU-1', shopifyVariantId: 'gid://shopify/ProductVariant/1', shopifyInventoryItemId: 'gid://shopify/InventoryItem/1' })

    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toEqual({
      sku: 'SKU-1',
      shopifyVariantId: 'gid://shopify/ProductVariant/1',
      shopifyInventoryItemId: 'gid://shopify/InventoryItem/1',
    })
  })

  it('does nothing when sku or inventory item id is missing', async () => {
    await trackEligibleSku({ sku: '', shopifyVariantId: 'v', shopifyInventoryItemId: 'i' })
    await trackEligibleSku({ sku: 'SKU-2', shopifyVariantId: 'v', shopifyInventoryItemId: '' })

    expect(state.inserted).toHaveLength(0)
  })
})

describe('getTrackedSkus', () => {
  it('returns the tracked SKU list', async () => {
    state.selectResult = [{ sku: 'SKU-1', shopifyInventoryItemId: 'gid://shopify/InventoryItem/1' }]
    const result = await getTrackedSkus()
    expect(result).toEqual(state.selectResult)
  })
})

describe('recordSyncedQuantity', () => {
  it('updates lastQuantity and lastSyncedAt', async () => {
    await recordSyncedQuantity('SKU-1', 42)
    expect(state.updated).toHaveLength(1)
    expect(state.updated[0].lastQuantity).toBe(42)
    expect(state.updated[0].lastSyncedAt).toBeInstanceOf(Date)
  })
})
