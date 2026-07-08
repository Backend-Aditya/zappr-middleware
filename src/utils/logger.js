import pino from 'pino'
import { env } from '../config/env.js'

export const logger = pino({
  level: env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'SHOPIFY_API_SECRET',
      'SHOPIFY_ADMIN_TOKEN',
      'SHOPIFY_WEBHOOK_SECRET',
      'SHOPIFY_APP_PROXY_SECRET',
      'ZAPPR_API_KEY',
      'ZAPPR_X_API_KEY',
      'ZAPPR_WEBHOOK_TOKEN',
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers["x-shopify-hmac-sha256"]',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
})

/**
 * Create a child logger bound to a module name.
 * @param {string} module
 * @returns {import('pino').Logger}
 */
export function createLogger(module) {
  return logger.child({ module })
}
