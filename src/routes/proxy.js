import { Router } from 'express'
import { z } from 'zod'
import { proxyHmacMiddleware } from '../middleware/proxyHmac.js'
import { proxyRateLimiter } from '../middleware/rateLimiter.js'
import { validate } from '../middleware/validate.js'
import { checkAvailability } from '../services/availabilityService.js'
import { getAdapter } from '../zappr/adapter.js'

const router = Router()

const proxyQuerySchema = z.object({
  pincode: z.string().regex(/^\d{6}$/),
  variantId: z.string().min(1),
  quantity: z.coerce.number().int().positive().default(1),
  zapprSku: z.string().min(1),
  zappr_eligible: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
  signature: z.string().optional(),
  path_prefix: z.string().optional(),
  timestamp: z.string().optional(),
})

router.get(
  '/check',
  proxyHmacMiddleware,
  proxyRateLimiter,
  validate(proxyQuerySchema, 'query'),
  async (req, res) => {
    const { pincode, variantId, quantity, zapprSku, zappr_eligible: zapprEligible } = req.validatedQuery
    const adapter = await getAdapter()

    const result = await checkAvailability(
      { pincode, variantId, quantity, zapprSku, zapprEligible },
      adapter,
    )

    res.json(result)
  },
)

export default router
