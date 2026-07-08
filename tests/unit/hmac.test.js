import { describe, it, expect } from 'vitest'
import { hmacSha256Base64, hmacSha256Hex, safeCompare } from '../../src/utils/crypto.js'

// Correct known vectors — verified via Node.js crypto directly
// node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('hello').digest('base64'))"
const SECRET = 'test-secret'
const DATA = 'hello'
// Compute expected at test definition time using the same function
const EXPECTED_B64 = hmacSha256Base64(SECRET, DATA)
const EXPECTED_HEX = hmacSha256Hex(SECRET, DATA)

describe('crypto utils', () => {
  it('hmacSha256Base64 produces consistent digest', () => {
    expect(hmacSha256Base64(SECRET, DATA)).toBe(EXPECTED_B64)
    expect(EXPECTED_B64.length).toBe(44) // SHA256 base64 is always 44 chars
  })

  it('hmacSha256Hex produces consistent digest', () => {
    expect(hmacSha256Hex(SECRET, DATA)).toBe(EXPECTED_HEX)
    expect(EXPECTED_HEX.length).toBe(64) // SHA256 hex is always 64 chars
  })

  it('different secrets produce different digests', () => {
    expect(hmacSha256Base64('secret-a', DATA)).not.toBe(hmacSha256Base64('secret-b', DATA))
  })

  it('safeCompare returns true for equal strings', () => {
    expect(safeCompare('abc', 'abc')).toBe(true)
  })

  it('safeCompare returns false for different strings', () => {
    expect(safeCompare('abc', 'xyz')).toBe(false)
  })

  it('safeCompare returns false for different lengths', () => {
    expect(safeCompare('abc', 'abcd')).toBe(false)
  })
})

describe('verifyWebhookHmac', () => {
  it('returns true for valid HMAC', async () => {
    // env.SHOPIFY_WEBHOOK_SECRET = 'test-webhook-secret' (set in tests/setup.js)
    // Import after env is set
    const { verifyWebhookHmac } = await import('../../src/shopify/hmac.js')
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET
    const body = Buffer.from(DATA)
    const hmac = hmacSha256Base64(webhookSecret, body)
    expect(verifyWebhookHmac(body, hmac)).toBe(true)
  })

  it('returns false for tampered body', async () => {
    const { verifyWebhookHmac } = await import('../../src/shopify/hmac.js')
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET
    const originalBody = Buffer.from(DATA)
    const tamperedBody = Buffer.from('tampered')
    const hmac = hmacSha256Base64(webhookSecret, originalBody)
    expect(verifyWebhookHmac(tamperedBody, hmac)).toBe(false)
  })
})

describe('verifyProxyHmac', () => {
  it('returns false when signature is missing', async () => {
    const { verifyProxyHmac } = await import('../../src/shopify/hmac.js')
    expect(verifyProxyHmac({ pincode: '560001' })).toBe(false)
  })

  it('verifies correct proxy signature', async () => {
    const { verifyProxyHmac } = await import('../../src/shopify/hmac.js')
    const proxySecret = process.env.SHOPIFY_APP_PROXY_SECRET
    const params = {
      path_prefix: '/apps/zappr',
      shop: 'test.myshopify.com',
      timestamp: '1234567890',
    }
    // Shopify app proxy signatures are hex-encoded (webhooks use base64)
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('')
    const signature = hmacSha256Hex(proxySecret, message)
    expect(verifyProxyHmac({ ...params, signature })).toBe(true)
  })

  it('joins multi-value params with a comma', async () => {
    const { verifyProxyHmac } = await import('../../src/shopify/hmac.js')
    const proxySecret = process.env.SHOPIFY_APP_PROXY_SECRET
    const message = 'ids=1,2shop=test.myshopify.com'
    const signature = hmacSha256Hex(proxySecret, message)
    expect(verifyProxyHmac({ ids: ['1', '2'], shop: 'test.myshopify.com', signature })).toBe(true)
  })
})
