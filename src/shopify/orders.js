import { shopifyGraphql } from './graphql.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-orders')

const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
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
 * Add tags to a Shopify order (or any taggable node).
 * @param {{ orderId: string, tags: string[] }} opts
 * @returns {Promise<void>}
 */
export async function addOrderTags({ orderId, tags }) {
  const data = await shopifyGraphql(TAGS_ADD, { id: orderId, tags })

  const { userErrors } = data.tagsAdd
  if (userErrors?.length) {
    log.error({ userErrors }, 'TagsAdd userErrors')
    throw new Error(`TagsAdd failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
