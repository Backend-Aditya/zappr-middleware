import { Router } from 'express'
import { orderStore, invoiceIndex, nextInvoiceIdValue } from '../store.js'
import { randomLatency, maybe503 } from '../utils.js'

const router = Router()

// Mirrors EasyEcom's POST /webhook/v2/createOrder
router.post('/webhook/v2/createOrder', async (req, res) => {
  await randomLatency()
  if (maybe503(res)) return

  const { orderNumber, items, customer } = req.body

  if (!orderNumber || !items?.length) {
    return res.status(400).json({ status: false, message: 'orderNumber and items required' })
  }

  const invoiceId = nextInvoiceIdValue()

  orderStore.set(orderNumber, {
    referenceCode: orderNumber,
    invoiceId,
    items,
    customer,
    orderStatus: 'Pending',
    awbNumber: null,
    stateIndex: 0,
    createdAt: Date.now(),
  })
  invoiceIndex.set(invoiceId, orderNumber)

  return res.status(200).json({
    status: true,
    message: 'Order created successfully',
    data: { orderNumber, invoiceId },
  })
})

// Mirrors EasyEcom's POST /orders/cancelOrder
router.post('/orders/cancelOrder', async (req, res) => {
  await randomLatency()
  if (maybe503(res)) return

  const { reference_code: referenceCode } = req.body
  const order = orderStore.get(referenceCode)

  if (!order) {
    return res.status(404).json({ status: false, message: 'Order not found' })
  }

  order.orderStatus = 'Cancelled'
  orderStore.set(referenceCode, order)

  return res.json({ status: true, message: 'Order cancelled successfully' })
})

// Mirrors EasyEcom's GET /orders/V2/getOrderDetails
router.get('/orders/V2/getOrderDetails', async (req, res) => {
  await randomLatency()
  if (maybe503(res)) return

  const invoiceId = Number(req.query.invoice_id)
  const referenceCode = invoiceIndex.get(invoiceId)
  const order = referenceCode ? orderStore.get(referenceCode) : null

  if (!order) {
    return res.status(404).json({ status: false, message: 'Order not found' })
  }

  return res.json({
    status: true,
    data: {
      invoice_id: order.invoiceId,
      reference_code: order.referenceCode,
      orderStatus: order.orderStatus,
      awbNumber: order.awbNumber,
      items: order.items,
    },
  })
})

export default router
