import { shopifyGraphql } from './graphql.js'
import { GET_PRODUCTS_PAGE } from './queries/getProductsPage.js'
import { trackEligibleSku } from '../services/zapprInventorySyncService.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-catalog')

/**
 * Page through the full Shopify catalog and track every zappr_eligible
 * variant for inventory sync (variant-level metafield wins, falls back to
 * the product-level flag). Run once daily to catch products marked eligible
 * before they've ever been viewed on the storefront or ordered.
 * @returns {Promise<number>} number of SKUs tracked this run
 */
export async function scanEligibleProducts() {
  let cursor = null
  let hasNextPage = true
  let tracked = 0

  while (hasNextPage) {
    const data = await shopifyGraphql(GET_PRODUCTS_PAGE, { cursor })
    const { nodes, pageInfo } = data.products

    for (const product of nodes) {
      for (const variant of product.variants.nodes) {
        const eligible = (variant.metafield?.value ?? product.metafield?.value) === 'true'
        if (!eligible || !variant.sku || !variant.inventoryItem?.id) continue

        await trackEligibleSku({
          sku: variant.sku,
          shopifyVariantId: variant.id,
          shopifyInventoryItemId: variant.inventoryItem.id,
        })
        tracked++
      }
    }

    hasNextPage = pageInfo.hasNextPage
    cursor = pageInfo.endCursor
  }

  log.info({ tracked }, 'Daily Zappr-eligible catalog scan complete')
  return tracked
}
