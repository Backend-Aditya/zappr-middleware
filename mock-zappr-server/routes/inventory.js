import { Router } from 'express'
import { skuCatalogue } from '../data/skus.js'
import { randomLatency, maybe503 } from '../utils.js'

const router = Router()

// Mirrors EasyEcom's GET /getInventoryDetailsV3
router.get('/getInventoryDetailsV3', async (req, res) => {
  await randomLatency()
  if (maybe503(res)) return

  const { sku } = req.query

  if (!sku) {
    return res.status(400).json({ status: false, message: 'sku is required' })
  }

  const item = skuCatalogue.get(String(sku))

  // 10% random stock-unavailable, matching real-world flakiness
  if (!item || Math.random() < 0.10) {
    return res.json({ status: true, data: [] })
  }

  return res.json({
    status: true,
    data: [
      {
        sku: String(sku),
        productName: item.name,
        locationId: 'ee73171873009',
        availableQuantity: item.stock,
      },
    ],
  })
})

export default router
