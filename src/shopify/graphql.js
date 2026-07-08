import ky from 'ky'
import { env } from '../config/env.js'
import { SHOPIFY_API_VERSION } from '../config/constants.js'
import { ShopifyApiError } from '../errors.js'
import { getAccessToken, invalidateAccessToken } from './tokenService.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-graphql')

/**
 * Execute a Shopify Admin GraphQL query/mutation.
 * Auto-refreshes the access token on 401 (one retry).
 * @template T
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @param {boolean} [_isRetry] - internal flag to prevent infinite retry loop
 * @returns {Promise<T>}
 */
export async function shopifyGraphql(query, variables = {}, _isRetry = false) {
  const token = await getAccessToken()

  try {
    const result = await ky.post(
      `https://${env.SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          Connection: 'keep-alive',
        },
        json: { query, variables },
        timeout: 15_000,
        retry: { limit: 2, statusCodes: [429, 503], backoffLimit: 3000 },
      },
    ).json()

    if (result.errors?.length) {
      log.error({ errors: result.errors }, 'Shopify GraphQL errors')
      throw new ShopifyApiError(`GraphQL errors: ${result.errors.map((e) => e.message).join(', ')}`)
    }

    return result.data
  } catch (err) {
    // Token may have expired early — invalidate and retry once
    if (!_isRetry && err?.response?.status === 401) {
      log.warn('Shopify 401 — invalidating token and retrying')
      await invalidateAccessToken()
      return shopifyGraphql(query, variables, true)
    }

    if (err instanceof ShopifyApiError) throw err
    throw new ShopifyApiError(`Shopify API request failed: ${err.message}`, 502, err)
  }
}
