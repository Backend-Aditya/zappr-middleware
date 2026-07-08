import express from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { requestIdMiddleware } from './middleware/requestId.js'
import { errorHandler } from './middleware/errorHandler.js'
import { logger } from './utils/logger.js'
import router from './routes/index.js'

const BODY_LIMIT = '1mb'

/**
 * Build the Express application (no listen).
 * @returns {import('express').Application}
 */
export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  // API-only service — no CSP needed, but keep the rest of helmet's headers
  app.use(helmet({ contentSecurityPolicy: false }))

  // Request ID must be first
  app.use(requestIdMiddleware)

  // Structured request logging
  app.use(pinoHttp({
    logger,
    customLogLevel: (_req, res) => (res.statusCode >= 500 ? 'error' : 'info'),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }))

  // JSON body parser for all non-raw routes
  app.use((req, res, next) => {
    // Skip for routes that need raw body (HMAC verified against exact bytes)
    if (req.path === '/webhooks/orders-paid' || req.path === '/carrier') {
      return next()
    }
    express.json({ limit: BODY_LIMIT })(req, res, next)
  })

  app.use(router)

  // Global error handler (must be last)
  app.use(errorHandler)

  return app
}
