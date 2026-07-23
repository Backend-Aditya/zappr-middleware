export const GET_FULFILLMENT_ORDERS = /* GraphQL */ `
  query GetFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      name
      billingAddress {
        firstName
        lastName
        phone
        address1
        address2
        city
        province
        countryCode
        zip
      }
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
                price
                metafield(namespace: "custom", key: "zappr_eligible") {
                  value
                }
                product {
                  metafield(namespace: "custom", key: "zappr_eligible") {
                    value
                  }
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
