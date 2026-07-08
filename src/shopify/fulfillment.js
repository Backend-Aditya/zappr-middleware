import { shopifyGraphql } from './graphql.js'
import { GET_FULFILLMENT_ORDERS } from './queries/getFulfillmentOrders.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-fulfillment')

const CREATE_FULFILLMENT = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo {
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`

const UPDATE_TRACKING = /* GraphQL */ `
  mutation FulfillmentTrackingInfoUpdate(
    $fulfillmentId: ID!
    $trackingInfoInput: FulfillmentTrackingInput!
    $notifyCustomer: Boolean!
  ) {
    fulfillmentTrackingInfoUpdate(
      fulfillmentId: $fulfillmentId
      trackingInfoInput: $trackingInfoInput
      notifyCustomer: $notifyCustomer
    ) {
      fulfillment {
        id
        trackingInfo {
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`

/**
 * Fetch fulfillment orders for a Shopify order.
 * @param {string} shopifyOrderGid - gid://shopify/Order/123
 * @returns {Promise<object>}
 */
export async function getFulfillmentOrders(shopifyOrderGid) {
  return shopifyGraphql(GET_FULFILLMENT_ORDERS, { orderId: shopifyOrderGid })
}

/**
 * Create a Shopify fulfillment with tracking info.
 * @param {{ fulfillmentOrderId: string, trackingNumber: string, trackingUrl: string, trackingCompany: string }} opts
 * @returns {Promise<{ fulfillmentId: string }>}
 */
export async function createFulfillment({ fulfillmentOrderId, trackingNumber, trackingUrl, trackingCompany = 'Zappr' }) {
  const data = await shopifyGraphql(CREATE_FULFILLMENT, {
    fulfillment: {
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
      trackingInfo: { number: trackingNumber, url: trackingUrl, company: trackingCompany },
      notifyCustomer: true,
    },
  })

  const { userErrors, fulfillment } = data.fulfillmentCreate

  if (userErrors?.length) {
    log.error({ userErrors }, 'FulfillmentCreate userErrors')
    throw new Error(`FulfillmentCreate failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }

  return { fulfillmentId: fulfillment.id }
}

/**
 * Update tracking info on an existing Shopify fulfillment.
 * @param {{ fulfillmentId: string, trackingNumber: string, trackingUrl: string }} opts
 * @returns {Promise<void>}
 */
export async function updateFulfillmentTracking({ fulfillmentId, trackingNumber, trackingUrl }) {
  const data = await shopifyGraphql(UPDATE_TRACKING, {
    fulfillmentId,
    trackingInfoInput: { number: trackingNumber, url: trackingUrl },
    notifyCustomer: true,
  })

  const { userErrors } = data.fulfillmentTrackingInfoUpdate
  if (userErrors?.length) {
    log.error({ userErrors }, 'FulfillmentTrackingInfoUpdate userErrors')
    throw new Error(`Tracking update failed: ${userErrors.map((e) => e.message).join(', ')}`)
  }
}
