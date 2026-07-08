import { Router } from 'express'
import { orderStore } from '../store.js'
import { randomLatency } from '../utils.js'

const router = Router()

// Mirrors EasyEcom's GET /Carriers/getTrackingDetails
router.get('/Carriers/getTrackingDetails', async (req, res) => {
  await randomLatency()

  const { reference_code: referenceCode } = req.query
  const order = orderStore.get(referenceCode)

  if (!order) {
    return res.status(404).json({ status: false, message: 'Order not found' })
  }

  return res.json([
    {
      reference_code: order.referenceCode,
      invoiceId: order.invoiceId,
      orderStatus: order.orderStatus,
      currentShippingStatus: order.orderStatus,
      awbNumber: order.awbNumber,
      expectedDeliveryDate: null,
    },
  ])
})

export default router
