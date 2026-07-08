import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Compute HMAC-SHA256 digest as base64.
 * @param {string | Buffer} secret
 * @param {string | Buffer} data
 * @returns {string}
 */
export function hmacSha256Base64(secret, data) {
  return createHmac('sha256', secret).update(data).digest('base64')
}

/**
 * Compute HMAC-SHA256 digest as hex.
 * @param {string | Buffer} secret
 * @param {string | Buffer} data
 * @returns {string}
 */
export function hmacSha256Hex(secret, data) {
  return createHmac('sha256', secret).update(data).digest('hex')
}

/**
 * Timing-safe comparison of two strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeCompare(a, b) {
  try {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}
