import { hmacSha256Base64, hmacSha256Hex, safeCompare } from '../utils/crypto.js'
import { env } from '../config/env.js'

/**
 * Verify Shopify webhook HMAC from raw body buffer.
 * @param {Buffer} rawBody
 * @param {string} receivedHmac
 * @returns {boolean}
 */
export function verifyWebhookHmac(rawBody, receivedHmac) {
  const computed = hmacSha256Base64(env.SHOPIFY_WEBHOOK_SECRET, rawBody)
  return safeCompare(computed, receivedHmac)
}

/**
 * Verify Shopify App Proxy signature.
 * Query params are sorted alphabetically (excluding signature), multi-value
 * params joined with ",", pairs concatenated with no separator, then
 * HMAC-SHA256 hex-encoded with the app secret.
 * @param {Record<string, string | string[]>} query
 * @returns {boolean}
 */
export function verifyProxyHmac(query) {
  const { signature, ...rest } = query

  if (!signature || typeof signature !== 'string') return false

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('')

  const computed = hmacSha256Hex(env.SHOPIFY_APP_PROXY_SECRET, message)
  return safeCompare(computed, signature)
}
