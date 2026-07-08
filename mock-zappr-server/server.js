import express from 'express'
import { authMiddleware } from './utils.js'
import { startStateMachine } from './store.js'
import inventoryRoutes from './routes/inventory.js'
import orderRoutes from './routes/orders.js'
import trackingRoutes from './routes/tracking.js'

const app = express()
const PORT = Number(process.env.PORT ?? 4001)

app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'mock-zappr' }))

// Mirrors EasyEcom: every real endpoint is mounted at its own root-level path,
// not under a shared /api/v1 prefix — see realAdapter.js for the equivalents.
app.use(authMiddleware)
app.use(inventoryRoutes)
app.use(orderRoutes)
app.use(trackingRoutes)

app.use((_req, res) => res.status(404).json({ status: false, message: 'Not found' }))

app.listen(PORT, () => {
  console.log(`[mock-zappr] listening on :${PORT}`)
  startStateMachine()
})

export default app
