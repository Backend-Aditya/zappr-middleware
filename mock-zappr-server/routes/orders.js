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

  // Real EasyEcom rejects items without Price via HTTP 200 + code 400
  const missingPrice = items.filter((i) => i.Price == null || i.Price === '')
  if (missingPrice.length) {
    return res.status(200).json({
      code: 400,
      message: 'Error creating order',
      data: missingPrice.map((i) => ({ ...i, Price: 0, Message: ' Mandatory parameter missing ' })),
    })
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

  // Mirrors real response: code/message plus EasyEcom's own IDs
  return res.status(200).json({
    code: 200,
    message: `${orderNumber} created successfully`,
    data: {
      Status: 200,
      Message: `Success SuborderID:${invoiceId}1 OrderID:${invoiceId}2 InvoiceID:${invoiceId}`,
      SuborderID: `${invoiceId}1`,
      OrderID: `${invoiceId}2`,
      InvoiceID: String(invoiceId),
    },
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
