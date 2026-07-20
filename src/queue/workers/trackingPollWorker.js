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

const POLL_INTERVAL_MS = 5 * 60 * 1000
// A transient Zappr/EasyEcom outage must never permanently stop tracking for
// an order — this bounds it instead: give up only after ~14 days of 5-minute
// polls (an order still not delivered by then needs a human, not a retry).
const MAX_POLLS = (14 * 24 * 60) / 5

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Tracking poll worker booted')
}

/**
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { zapprOrderId, pollCount = 0 } = job.data
  log.info({ zapprOrderId, pollCount }, 'Polling tracking')

  let delivered = false

  try {
    const adapter = await getAdapter()
    const tracking = await adapter.getTracking({ zapprOrderId })

    await processTrackingUpdate({
      zapprOrderId,
      status: tracking.status,
      trackingNumber: tracking.trackingNumber,
      trackingUrl: tracking.trackingUrl,
      rawPayload: tracking,
    })

    // EasyEcom's status casing isn't guaranteed (seen: "Confirmed", "Shipment
    // Created") — compare case-insensitively, matching trackingService.js.
    delivered = tracking.status?.toUpperCase() === TRACKING_STATUS.DELIVERED
  } catch (err) {
    // Log and fall through to re-queue below — a single failed poll (e.g. an
    // upstream 502) must not be the reason tracking silently stops forever.
    log.error({ err, zapprOrderId, pollCount }, 'Tracking poll failed — will retry on the next cycle')
  }

  if (delivered) {
    log.info({ zapprOrderId }, 'Order delivered — stopping tracking polls')
    return
  }

  if (pollCount + 1 >= MAX_POLLS) {
    log.error({ zapprOrderId, pollCount }, 'Tracking poll giving up after max attempts — needs manual follow-up')
    return
  }

  const { trackingPollQueue } = await import('../queues.js')
  await trackingPollQueue.add(
    'poll',
    { zapprOrderId, pollCount: pollCount + 1 },
    { delay: POLL_INTERVAL_MS },
  )
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
