import 'dotenv/config'
import { Worker } from 'bullmq'
import { sql } from 'drizzle-orm'
import { connectPostgres, getDb } from '../../db/postgres/connection.js'
import { connectRedis } from '../../cache/redis.js'
import { getAdapter } from '../../zappr/adapter.js'
import { getTrackedSkus, recordSyncedQuantity } from '../../services/zapprInventorySyncService.js'
import { setInventoryQuantity } from '../../shopify/inventory.js'
import { scanEligibleProducts } from '../../shopify/catalog.js'
import { QUEUE_NAMES } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('maintenance-worker')

const RETENTION_DAYS = 30

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Maintenance worker booted')
}

async function runDbCleanup() {
  const db = getDb()
  const cutoff = sql`now() - make_interval(days => ${RETENTION_DAYS})`

  const [logs, events, updates] = await Promise.all([
    db.execute(sql`DELETE FROM zappr_logs WHERE created_at < ${cutoff}`),
    db.execute(sql`DELETE FROM webhook_events WHERE created_at < ${cutoff} AND status = 'done'`),
    db.execute(sql`DELETE FROM tracking_updates WHERE created_at < ${cutoff} AND synced_to_shopify = true`),
  ])

  log.info(
    { zapprLogs: logs.rowCount, webhookEvents: events.rowCount, trackingUpdates: updates.rowCount },
    'Daily DB cleanup complete',
  )
}

async function runZapprInventorySync() {
  if (!env.ZAPPR_SHOPIFY_LOCATION_ID) {
    log.info('ZAPPR_SHOPIFY_LOCATION_ID not set — skipping Zappr inventory sync')
    return
  }

  const adapter = await getAdapter()
  const skus = await getTrackedSkus()
  let synced = 0

  for (const { sku, shopifyInventoryItemId } of skus) {
    try {
      const stock = await adapter.checkStock({ zapprSku: sku, quantity: 0 })
      await setInventoryQuantity({
        inventoryItemId: shopifyInventoryItemId,
        locationId: env.ZAPPR_SHOPIFY_LOCATION_ID,
        quantity: stock.quantity,
      })
      await recordSyncedQuantity(sku, stock.quantity)
      synced++
    } catch (err) {
      log.error({ err, sku }, 'Zappr inventory sync failed for SKU — continuing with the rest')
    }
  }

  log.info({ synced, total: skus.length }, 'Zappr inventory sync complete')
}

/**
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  switch (job.data?.type) {
    case 'cleanup':
      return runDbCleanup()
    case 'zappr-inventory-sync':
      return runZapprInventorySync()
    case 'zappr-sku-scan':
      return scanEligibleProducts()
    default:
      log.warn({ type: job.data?.type }, 'Unknown maintenance job type — skipping')
  }
}

boot().then(() => {
  const worker = new Worker(QUEUE_NAMES.MAINTENANCE, processJob, {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
  })

  worker.on('completed', (job) => log.info({ jobId: job.id }, 'Maintenance job completed'))
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Maintenance job failed'))

  process.on('SIGTERM', async () => {
    await worker.close()
    process.exit(0)
  })
})
