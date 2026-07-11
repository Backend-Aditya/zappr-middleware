import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { getRedis } from '../cache/redis.js'

/**
 * Build a rate limiter backed by Redis.
 * @param {{ windowMs?: number, max?: number, keyPrefix?: string }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function buildRateLimiter(opts = {}) {
  const { windowMs = 60_000, max = 60, keyPrefix = 'rl:proxy' } = opts

  let _limiter = null

  // Lazy-init: create the limiter on first request so Redis is already connected
  return (req, res, next) => {
    if (!_limiter) {
      _limiter = rateLimit({
        windowMs,
        max,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        store: new RedisStore({
          // rate-limit-redis v5 takes a sendCommand fn, not a client instance
          sendCommand: (...args) => getRedis().call(...args),
          prefix: keyPrefix,
        }),
        // ipKeyGenerator normalizes IPv6 to /56 so one user can't rotate
        // through addresses in their allocation to dodge the limit
        keyGenerator: (req) => (req.ip ? ipKeyGenerator(req.ip) : 'unknown'),
        handler: (_req, res) => {
          res.status(429).json({
            error: 'Too many requests',
            retryAfter: Math.ceil(windowMs / 1000),
          })
        },
      })
    }
    return _limiter(req, res, next)
  }
}

export const proxyRateLimiter = buildRateLimiter({ max: 60, keyPrefix: 'rl:proxy' })
export const carrierRateLimiter = buildRateLimiter({ max: 120, keyPrefix: 'rl:carrier' })
