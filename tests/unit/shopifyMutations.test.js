import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGraphql = vi.fn()
vi.mock('../../src/shopify/graphql.js', () => ({
  shopifyGraphql: (...args) => mockGraphql(...args),
}))

const { moveFulfillmentOrder } = await import('../../src/shopify/fulfillment.js')
const { addOrderTags } = await import('../../src/shopify/orders.js')
const { setInventoryQuantity } = await import('../../src/shopify/inventory.js')

beforeEach(() => {
  mockGraphql.mockReset()
})

describe('moveFulfillmentOrder', () => {
  it('calls fulfillmentOrderMove with the right variables', async () => {
    mockGraphql.mockResolvedValue({ fulfillmentOrderMove: { movedFulfillmentOrder: { id: 'fo-1' }, userErrors: [] } })

    await moveFulfillmentOrder({ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1', locationId: 'gid://shopify/Location/1' })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('fulfillmentOrderMove'),
      { id: 'gid://shopify/FulfillmentOrder/1', newLocationId: 'gid://shopify/Location/1' },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ fulfillmentOrderMove: { movedFulfillmentOrder: null, userErrors: [{ field: 'id', message: 'not found' }] } })

    await expect(moveFulfillmentOrder({ fulfillmentOrderId: 'fo-1', locationId: 'loc-1' })).rejects.toThrow(/not found/)
  })
})

describe('addOrderTags', () => {
  it('calls tagsAdd with the right variables', async () => {
    mockGraphql.mockResolvedValue({ tagsAdd: { node: { id: 'order-1' }, userErrors: [] } })

    await addOrderTags({ orderId: 'gid://shopify/Order/1', tags: ['zappr-fulfillment'] })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('tagsAdd'),
      { id: 'gid://shopify/Order/1', tags: ['zappr-fulfillment'] },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ tagsAdd: { node: null, userErrors: [{ field: 'id', message: 'bad id' }] } })

    await expect(addOrderTags({ orderId: 'order-1', tags: ['x'] })).rejects.toThrow(/bad id/)
  })
})

describe('setInventoryQuantity', () => {
  it('calls inventorySetQuantities with the right variables', async () => {
    mockGraphql.mockResolvedValue({ inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'adj-1' }, userErrors: [] } })

    await setInventoryQuantity({ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1', quantity: 42 })

    expect(mockGraphql).toHaveBeenCalledWith(
      expect.stringContaining('inventorySetQuantities'),
      {
        input: {
          name: 'available',
          reason: 'correction',
          ignoreCompareQuantity: true,
          quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1', quantity: 42 }],
        },
      },
    )
  })

  it('throws on userErrors', async () => {
    mockGraphql.mockResolvedValue({ inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: 'quantity', message: 'invalid' }] } })

    await expect(setInventoryQuantity({ inventoryItemId: 'i', locationId: 'l', quantity: -1 })).rejects.toThrow(/invalid/)
  })
})
