import { shopifyGraphql } from './graphql.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-inventory')

const INVENTORY_SET_QUANTITIES = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`

/**
 * Set the "available" quantity for a SKU's inventory item at a specific
 * Shopify location — used to mirror EasyEcom's stock count for the Zappr
 * location so the store owner can see it directly in Shopify admin.
 * @param {{ inventoryItemId: string, locationId: string, quantity: number }} opts
 * @returns {Promise<void>}
 */
export async function setInventoryQuantity({ inventoryItemId, locationId, quantity }) {
  const data = await shopifyGraphql(INVENTORY_SET_QUANTITIES, {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId, locationId, quantity }],
    },
  })

  const { userErrors } = data.inventorySetQuantities
  if (userErrors?.length) {
    log.error({ userErrors }, 'InventorySetQuantities userErrors')
    throw new Error(`InventorySetQuantities failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
