import { Router } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { safeCompare } from '../utils/crypto.js'
import { HmacError } from '../errors.js'
import { validate } from '../middleware/validate.js'
import { processTrackingUpdate } from '../services/trackingService.js'
import { createLogger } from '../utils/logger.js'

const router = Router()
const log = createLogger('zappr-webhook')

/**
 * EasyEcom webhooks carry no signature — auth is a shared-secret token
 * embedded in the callback URL we hand the Zappr team.
 * @type {import('express').RequestHandler}
 */
function webhookTokenMiddleware(req, _res, next) {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!safeCompare(token, env.ZAPPR_WEBHOOK_TOKEN)) {
    log.warn('Zappr webhook token mismatch')
    return next(new HmacError())
  }
  next()
}

const trackingEventSchema = z.object({
  reference_code: z.string().min(1),
  orderStatus: z.string().nullable().optional(),
  currentShippingStatus: z.string().nullable().optional(),
  awbNumber: z.union([z.string(), z.number()]).nullable().optional(),
})

// EasyEcom posts a single event object or an array of them, depending on the trigger
const trackingBodySchema = z.union([trackingEventSchema, z.array(trackingEventSchema)])

router.post(
  '/tracking',
  webhookTokenMiddleware,
  validate(trackingBodySchema),
  async (req, res) => {
    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const status = event.orderStatus ?? event.currentShippingStatus ?? 'PENDING'

      log.info({ zapprOrderId: event.reference_code, status }, 'Received Zappr tracking webhook')

      await processTrackingUpdate({
        zapprOrderId: event.reference_code,
        status,
        trackingNumber: event.awbNumber != null ? String(event.awbNumber) : null,
        trackingUrl: null,
        rawPayload: event,
      })
    }

    res.status(200).json({ ok: true })
  },
)

export default router
