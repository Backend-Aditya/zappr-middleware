import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Shopify — client credentials grant (replaces static SHOPIFY_ADMIN_TOKEN)
    // Create app in Partner Dashboard → get Client ID + Client Secret
    // Tokens are fetched automatically and cached in Redis (expire 24h)
    SHOPIFY_STORE: z.string().min(1),
    SHOPIFY_CLIENT_ID: z.string().min(1),
    SHOPIFY_CLIENT_SECRET: z.string().min(1),
    SHOPIFY_APP_PROXY_SECRET: z.string().min(1),
    SHOPIFY_WEBHOOK_SECRET: z.string().min(1),

    // Zappr — backed by EasyEcom's API in live mode
    ZAPPR_MODE: z.enum(['mock', 'live']).default('mock'),
    ZAPPR_BASE_URL: z.string().url().optional(),
    ZAPPR_API_KEY: z.string().optional(), // JWT bearer token (rotated manually by Zappr, ~90 day validity)
    ZAPPR_X_API_KEY: z.string().optional(), // EasyEcom x-api-key header, mandatory alongside the bearer token
    ZAPPR_MARKETPLACE_ID: z.coerce.number().int().positive().default(10),
    // Shared secret in the webhook URL we give the Zappr team
    // (e.g. /webhooks/zappr/tracking?token=...) — EasyEcom does not sign webhooks
    ZAPPR_WEBHOOK_TOKEN: z.string().min(16),
    ZAPPR_CARRIER_ID: z.coerce.number().int().positive().optional(),
    ZAPPR_MOCK_URL: z.string().url().default('http://localhost:4001'),
    ZAPPR_MOCK_API_KEY: z.string().default('MOCK_ZAPPR_KEY'),
    ZAPPR_MOCK_X_API_KEY: z.string().default('MOCK_ZAPPR_X_API_KEY'),
    ZAPPR_SURCHARGE_AMOUNT: z.coerce.number().int().positive().default(49),
    ZAPPR_HOLIDAYS: z
      .string()
      .optional()
      .transform((v) =>
        v ? v.split(',').map((d) => d.trim()).filter(Boolean) : [],
      ),

    // PostgreSQL
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().url(),

    // App
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    ZAPPR_STOCK_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  },

  runtimeEnv: process.env,

  emptyStringAsUndefined: true,
})
