import { Router } from 'express'
import healthRouter from './health.js'
import proxyRouter from './proxy.js'
import carrierRouter from './carrier.js'
import webhooksRouter from './webhooks.js'
import zapprWebhookRouter from './zapprWebhook.js'
import adminRouter from './admin.js'
import demoRouter from './demo.js'

const router = Router()

router.use('/', healthRouter)
router.use('/apps/zappr', proxyRouter)
router.use('/carrier', carrierRouter)
router.use('/webhooks', webhooksRouter)
router.use('/webhooks/zappr', zapprWebhookRouter)
router.use('/admin', adminRouter)
router.use('/demo', demoRouter)

export default router
