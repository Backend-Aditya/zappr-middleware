import { verifyProxyHmac } from '../shopify/hmac.js'
import { HmacError } from '../errors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('proxy-hmac')

/**
 * Express middleware that verifies Shopify App Proxy HMAC.
 * @type {import('express').RequestHandler}
 */
export function proxyHmacMiddleware(req, _res, next) {
  if (!verifyProxyHmac(req.query)) {
    log.warn({ query: req.query }, 'App Proxy HMAC mismatch')
    return next(new HmacError())
  }
  next()
}
