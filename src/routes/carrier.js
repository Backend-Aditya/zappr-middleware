import express, { Router } from 'express'
import { z } from 'zod'
import { shopifyHmacMiddleware } from '../middleware/shopifyHmac.js'
import { carrierRateLimiter } from '../middleware/rateLimiter.js'
import { checkAvailability } from '../services/availabilityService.js'
import { buildCarrierRate } from '../services/surchargeService.js'
import { getAdapter } from '../zappr/adapter.js'
import { createLogger } from '../utils/logger.js'

const router = Router()
const log = createLogger('carrier-route')

const carrierBodySchema = z.object({
  rate: z.object({
    origin: z.object({ postal_code: z.string() }),
    destination: z.object({ postal_code: z.string() }),
    items: z.array(z.object({
      name: z.string().optional(),
      sku: z.string().optional(),
      quantity: z.number().default(1),
      requires_shipping: z.boolean().default(true),
      properties: z.record(z.string()).optional(),
    })),
  }),
})

router.post(
  '/',
  express.raw({ type: 'application/json', limit: '1mb' }),
  shopifyHmacMiddleware,
  carrierRateLimiter,
  async (req, res) => {
    try {
      const parsed = carrierBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return res.json({ rates: [] })
      }

      const { rate } = parsed.data
      const pincode = rate.destination.postal_code
      const adapter = await getAdapter()

      // Check first item's SKU for eligibility
      const firstItem = rate.items.find((i) => i.requires_shipping)
      if (!firstItem) return res.json({ rates: [] })

      const zapprSku = firstItem.properties?.zappr_sku ?? firstItem.sku
      const zapprEligible = firstItem.properties?.zappr_eligible === 'true'

      const avail = await checkAvailability(
        { pincode, variantId: '', quantity: firstItem.quantity, zapprSku: zapprSku ?? '', zapprEligible },
        adapter,
      )

      if (!avail.available) {
        return res.json({ rates: [] })
      }

      const rate_obj = buildCarrierRate(avail)
      return res.json({ rates: [rate_obj] })
    } catch (err) {
      log.error({ err }, 'Carrier callback error — returning empty rates for graceful degradation')
      return res.json({ rates: [] })
    }
  },
)

export default router
