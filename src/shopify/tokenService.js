import ky from 'ky'
import { env } from '../config/env.js'
import { getRedis } from '../cache/redis.js'
import { ShopifyApiError } from '../errors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-token-service')

const CACHE_KEY = 'shopify:access_token'
const REFRESH_BUFFER_SECONDS = 3600 // refresh 1h before expiry

/**
 * @typedef {{ access_token: string, expires_in: number, token_type: string }} TokenResponse
 */

/**
 * Fetch a new access token from Shopify using the client credentials grant.
 * @returns {Promise<TokenResponse>}
 */
async function fetchAccessToken() {
  try {
    const response = await ky.post(
      `https://${env.SHOPIFY_STORE}/admin/oauth/access_token`,
      {
        json: {
          client_id: env.SHOPIFY_CLIENT_ID,
          client_secret: env.SHOPIFY_CLIENT_SECRET,
          grant_type: 'client_credentials',
        },
        timeout: 10_000,
        retry: { limit: 2, statusCodes: [429, 503] },
      },
    ).json()

    log.info({ expiresIn: response.expires_in }, 'Shopify access token fetched')
    return response
  } catch (err) {
    throw new ShopifyApiError(`Failed to fetch Shopify access token: ${err.message}`, 502, err)
  }
}

/**
 * Get a valid Shopify Admin API access token.
 * Returns cached token from Redis if still valid, otherwise fetches a new one.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  // Static admin-app token (Settings → Develop apps) — used for collaborator
  // stores where the client credentials grant is not permitted (different org).
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN

  const redis = getRedis()

  const cached = await redis.get(CACHE_KEY)
  if (cached) return cached

  const { access_token, expires_in } = await fetchAccessToken()

  const ttl = expires_in - REFRESH_BUFFER_SECONDS
  await redis.setex(CACHE_KEY, ttl > 0 ? ttl : expires_in, access_token)

  return access_token
}

/**
 * Invalidate cached token (call after receiving 401 from Shopify).
 * @returns {Promise<void>}
 */
export async function invalidateAccessToken() {
  await getRedis().del(CACHE_KEY)
  log.info('Shopify access token invalidated — will refresh on next request')
}
