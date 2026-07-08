import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const now = () => sql`now()`

export const orderMappings = pgTable(
  'order_mappings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shopifyOrderId: varchar('shopify_order_id', { length: 64 }).notNull().unique(),
    shopifyOrderName: varchar('shopify_order_name', { length: 32 }),
    fulfillmentOrderId: varchar('fulfillment_order_id', { length: 128 }).notNull(),
    zapprOrderId: varchar('zappr_order_id', { length: 128 }).unique(),
    shopifyFulfillmentId: varchar('shopify_fulfillment_id', { length: 128 }),
    status: varchar('status', { length: 32 }).notNull().default('PENDING'),
    pincode: varchar('pincode', { length: 16 }),
    slot: varchar('slot', { length: 16 }),
    surchargeAmount: numeric('surcharge_amount', { precision: 8, scale: 2 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()).$onUpdate(now),
  },
  (t) => [
    index('idx_order_mappings_shopify_order_id').on(t.shopifyOrderId),
    index('idx_order_mappings_zappr_order_id').on(t.zapprOrderId),
    index('idx_order_mappings_status').on(t.status),
    index('idx_order_mappings_created_at').on(t.createdAt),
  ],
)

// Doubles as idempotency store (replaces MongoDB WebhookEvent)
// Unique constraint on shopify_order_id prevents duplicate processing
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shopifyOrderId: varchar('shopify_order_id', { length: 64 }).unique(),
    eventType: varchar('event_type', { length: 64 }),
    hmac: varchar('hmac', { length: 256 }),
    status: varchar('status', { length: 16 }).notNull().default('processing'), // processing | done | failed
    retryCount: integer('retry_count').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index('idx_webhook_events_shopify_order_id').on(t.shopifyOrderId),
    index('idx_webhook_events_created_at').on(t.createdAt),
    index('idx_webhook_events_status').on(t.status),
  ],
)

export const trackingUpdates = pgTable(
  'tracking_updates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    zapprOrderId: varchar('zappr_order_id', { length: 128 }).notNull(),
    status: varchar('status', { length: 64 }),
    trackingNumber: varchar('tracking_number', { length: 128 }),
    trackingUrl: text('tracking_url'),
    rawPayload: jsonb('raw_payload'),
    syncedToShopify: boolean('synced_to_shopify').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index('idx_tracking_updates_zappr_order_id').on(t.zapprOrderId),
    index('idx_tracking_updates_synced').on(t.syncedToShopify),
    index('idx_tracking_updates_created_at').on(t.createdAt),
  ],
)

// Replaces MongoDB ZapprLog — raw Zappr API call logs
// Cleaned up by daily BullMQ job (DELETE WHERE created_at < NOW() - INTERVAL '30 days')
export const zapprLogs = pgTable(
  'zappr_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    direction: varchar('direction', { length: 16 }).notNull(), // outbound | inbound
    endpoint: text('endpoint').notNull(),
    requestBody: jsonb('request_body'),
    responseBody: jsonb('response_body'),
    statusCode: integer('status_code'),
    latencyMs: integer('latency_ms'),
    zapprOrderId: varchar('zappr_order_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  },
  (t) => [
    index('idx_zappr_logs_zappr_order_id').on(t.zapprOrderId),
    index('idx_zappr_logs_created_at').on(t.createdAt),
  ],
)
