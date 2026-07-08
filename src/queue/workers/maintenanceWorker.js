import 'dotenv/config'
import { Worker } from 'bullmq'
import { sql } from 'drizzle-orm'
import { connectPostgres, getDb } from '../../db/postgres/connection.js'
import { connectRedis } from '../../cache/redis.js'
import { QUEUE_NAMES } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('maintenance-worker')

const RETENTION_DAYS = 30

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Maintenance worker booted')
}

/**
 * Consumes the daily-db-cleanup job registered in schedulers.js —
 * prunes logs and processed webhook events past the retention window.
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  if (job.data?.type !== 'cleanup') return

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
