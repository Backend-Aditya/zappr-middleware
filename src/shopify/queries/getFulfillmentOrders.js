export const GET_FULFILLMENT_ORDERS = /* GraphQL */ `
  query GetFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          lineItems(first: 50) {
            nodes {
              id
              remainingQuantity
              sku
              variant {
                id
                metafield(namespace: "custom", key: "zappr_eligible") {
                  value
                }
              }
            }
          }
          deliveryMethod {
            methodType
          }
          destination {
            zip
            address1
            address2
            city
            province
            countryCode
            phone
            firstName
            lastName
            email
          }
        }
      }
    }
  }
`
