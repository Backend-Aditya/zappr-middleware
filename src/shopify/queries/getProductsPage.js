export const GET_PRODUCTS_PAGE = /* GraphQL */ `
  query GetProductsPage($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        metafield(namespace: "custom", key: "zappr_eligible") {
          value
        }
        variants(first: 50) {
          nodes {
            id
            sku
            inventoryItem {
              id
            }
            metafield(namespace: "custom", key: "zappr_eligible") {
              value
            }
          }
        }
      }
    }
  }
`
