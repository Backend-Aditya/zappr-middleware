import 'dotenv/config'
import { Worker } from 'bullmq'
import { connectPostgres } from '../../db/postgres/connection.js'
import { connectRedis } from '../../cache/redis.js'
import { getAdapter } from '../../zappr/adapter.js'
import { processTrackingUpdate } from '../../services/trackingService.js'
import { QUEUE_NAMES, TRACKING_STATUS } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tracking-poll-worker')

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Tracking poll worker booted')
}

/**
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { zapprOrderId } = job.data
  log.info({ zapprOrderId }, 'Polling tracking')

  const adapter = await getAdapter()
  const tracking = await adapter.getTracking({ zapprOrderId })

  await processTrackingUpdate({
    zapprOrderId,
    status: tracking.status,
    trackingNumber: tracking.trackingNumber,
    trackingUrl: tracking.trackingUrl,
    rawPayload: tracking,
  })

  // Re-queue if not yet delivered
  if (tracking.status !== TRACKING_STATUS.DELIVERED) {
    const { trackingPollQueue } = await import('../queues.js')
    await trackingPollQueue.add('poll', { zapprOrderId }, { delay: 5 * 60 * 1000 })
  }
}

boot().then(() => {
  const worker = new Worker(QUEUE_NAMES.TRACKING_POLL, processJob, {
    connection: { url: env.REDIS_URL },
    concurrency: 10,
  })

  worker.on('completed', (job) => log.info({ jobId: job.id }, 'Tracking poll completed'))
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Tracking poll failed'))

  process.on('SIGTERM', async () => {
    await worker.close()
    process.exit(0)
  })
})
