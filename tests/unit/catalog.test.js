import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGraphql = vi.fn()
vi.mock('../../src/shopify/graphql.js', () => ({
  shopifyGraphql: (...args) => mockGraphql(...args),
}))

const tracked = []
vi.mock('../../src/services/zapprInventorySyncService.js', () => ({
  trackEligibleSku: vi.fn(async (opts) => { tracked.push(opts) }),
}))

const { scanEligibleProducts } = await import('../../src/shopify/catalog.js')

beforeEach(() => {
  mockGraphql.mockReset()
  tracked.length = 0
})

describe('scanEligibleProducts', () => {
  it('pages through the catalog and tracks eligible variants only', async () => {
    mockGraphql
      .mockResolvedValueOnce({
        products: {
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
          nodes: [
            {
              id: 'gid://shopify/Product/1',
              metafield: { value: 'false' },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/1', sku: 'SKU-1', inventoryItem: { id: 'gid://shopify/InventoryItem/1' }, metafield: { value: 'true' } },
                  { id: 'gid://shopify/ProductVariant/2', sku: 'SKU-2', inventoryItem: { id: 'gid://shopify/InventoryItem/2' }, metafield: null },
                ],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'gid://shopify/Product/2',
              metafield: { value: 'true' },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/3', sku: 'SKU-3', inventoryItem: { id: 'gid://shopify/InventoryItem/3' }, metafield: null },
                ],
              },
            },
          ],
        },
      })

    const count = await scanEligibleProducts()

    expect(mockGraphql).toHaveBeenCalledTimes(2)
    expect(mockGraphql).toHaveBeenNthCalledWith(1, expect.any(String), { cursor: null })
    expect(mockGraphql).toHaveBeenNthCalledWith(2, expect.any(String), { cursor: 'cursor-1' })

    // SKU-1: variant metafield true → tracked. SKU-2: variant metafield null,
    // product metafield false → not tracked. SKU-3: variant metafield null,
    // product metafield true → tracked (product-level flag as fallback).
    expect(tracked.map((t) => t.sku)).toEqual(['SKU-1', 'SKU-3'])
    expect(count).toBe(2)
  })

  it('skips eligible variants with missing sku or inventoryItem.id', async () => {
    mockGraphql
      .mockResolvedValueOnce({
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: 'gid://shopify/Product/1',
              metafield: { value: 'false' },
              variants: {
                nodes: [
                  { id: 'gid://shopify/ProductVariant/1', sku: 'SKU-VALID', inventoryItem: { id: 'gid://shopify/InventoryItem/1' }, metafield: { value: 'true' } },
                  { id: 'gid://shopify/ProductVariant/2', sku: '', inventoryItem: { id: 'gid://shopify/InventoryItem/2' }, metafield: { value: 'true' } },
                  { id: 'gid://shopify/ProductVariant/3', sku: 'SKU-NO-INVENTORY', inventoryItem: null, metafield: { value: 'true' } },
                  { id: 'gid://shopify/ProductVariant/4', sku: 'SKU-NO-INVENTORY-ID', inventoryItem: { id: null }, metafield: { value: 'true' } },
                ],
              },
            },
          ],
        },
      })

    const count = await scanEligibleProducts()

    expect(mockGraphql).toHaveBeenCalledTimes(1)
    expect(mockGraphql).toHaveBeenNthCalledWith(1, expect.any(String), { cursor: null })

    // Only SKU-VALID should be tracked; the other three are eligible but lack sku or inventoryItem.id
    expect(tracked.map((t) => t.sku)).toEqual(['SKU-VALID'])
    expect(count).toBe(1)
  })
})
