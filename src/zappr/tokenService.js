import ky from 'ky'
import { env } from '../config/env.js'
import { getRedis } from '../cache/redis.js'
import { ZapprApiError } from '../errors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('zappr-token-service')

const CACHE_KEY = 'zappr:easyecom_jwt'
const REFRESH_BUFFER_SECONDS = 24 * 60 * 60 // refresh 1 day before expiry
const FALLBACK_TTL_SECONDS = 24 * 60 * 60 // used when the JWT's exp claim can't be read

/**
 * Decode a JWT's exp claim without verifying the signature — we trust
 * whatever EasyEcom/Zappr just issued us, we're only reading the expiry.
 * @param {string} jwt
 * @returns {number | null} unix seconds, or null if undecodable
 */
function decodeJwtExpiry(jwt) {
  try {
    const payload = jwt.split('.')[1]
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(payload.length + (4 - payload.length % 4) % 4, '=')
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

/**
 * Exchange the Zappr-provided Supabase account for a fresh EasyEcom JWT.
 * Two-step flow supplied by Zappr: sign in to Supabase, then call their
 * credentials function with the resulting access token.
 * @returns {Promise<string>}
 */
async function fetchEasyEcomToken() {
  try {
    const { access_token: supabaseToken } = await ky.post(
      `${env.ZAPPR_SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        headers: { apikey: env.ZAPPR_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        json: { email: env.ZAPPR_SUPABASE_EMAIL, password: env.ZAPPR_SUPABASE_PASSWORD },
        timeout: 10_000,
        retry: { limit: 2, statusCodes: [429, 503] },
      },
    ).json()

    const credentials = await ky.get(
      `${env.ZAPPR_SUPABASE_URL}/functions/v1/get-brand-easyecom-credentials`,
      {
        headers: { Authorization: `Bearer ${supabaseToken}` },
        timeout: 10_000,
        retry: { limit: 2, statusCodes: [429, 503] },
      },
    ).json()

    // Response shape isn't formally documented — tolerate a few plausible
    // nestings the way we already do for EasyEcom's own API responses.
    const jwt = credentials?.jwt_token
      ?? credentials?.token?.jwt_token
      ?? credentials?.access_token
      ?? credentials?.data?.jwt_token

    if (!jwt) throw new Error('No jwt_token found in credentials response')

    log.info('EasyEcom JWT refreshed via Supabase')
    return jwt
  } catch (err) {
    throw new ZapprApiError(`Failed to refresh EasyEcom JWT via Supabase: ${err.message}`, 502, err)
  }
}

/**
 * Get a valid EasyEcom bearer token. When Supabase auto-refresh credentials
 * are configured, fetches and caches a fresh JWT (keyed off its own exp
 * claim); otherwise falls back to the static ZAPPR_API_KEY.
 * @returns {Promise<string>}
 */
export async function getEasyEcomToken() {
  if (!env.ZAPPR_SUPABASE_ANON_KEY || !env.ZAPPR_SUPABASE_EMAIL || !env.ZAPPR_SUPABASE_PASSWORD) {
    return env.ZAPPR_API_KEY
  }

  const redis = getRedis()

  const cached = await redis.get(CACHE_KEY)
  if (cached) return cached

  const jwt = await fetchEasyEcomToken()

  const exp = decodeJwtExpiry(jwt)
  const ttl = exp ? Math.max(exp - Math.floor(Date.now() / 1000) - REFRESH_BUFFER_SECONDS, 60) : FALLBACK_TTL_SECONDS
  await redis.setex(CACHE_KEY, ttl, jwt)

  return jwt
}

/**
 * Invalidate the cached EasyEcom JWT (call after a 401 from EasyEcom).
 * @returns {Promise<void>}
 */
export async function invalidateEasyEcomToken() {
  await getRedis().del(CACHE_KEY)
  log.info('EasyEcom JWT invalidated — will refresh on next request')
}
