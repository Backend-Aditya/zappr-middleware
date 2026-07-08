import { verifyWebhookHmac } from '../shopify/hmac.js'
import { HmacError } from '../errors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('shopify-hmac')

/**
 * Express middleware that verifies Shopify webhook HMAC.
 * Must be used AFTER express.raw({ type: 'application/json' }).
 * @type {import('express').RequestHandler}
 */
export function shopifyHmacMiddleware(req, res, next) {
  const hmac = req.headers['x-shopify-hmac-sha256']

  if (!hmac) {
    log.warn('Missing X-Shopify-Hmac-Sha256 header')
    return next(new HmacError())
  }

  if (!Buffer.isBuffer(req.body)) {
    log.warn('req.body is not a Buffer — ensure express.raw() precedes this middleware')
    return next(new HmacError())
  }

  if (!verifyWebhookHmac(req.body, hmac)) {
    log.warn({ hmac }, 'Shopify webhook HMAC mismatch')
    return next(new HmacError())
  }

  req.rawBody = req.body
  try {
    req.body = JSON.parse(req.body.toString('utf8'))
  } catch {
    log.warn('Webhook body passed HMAC but is not valid JSON')
    return next(new HmacError())
  }
  next()
}
