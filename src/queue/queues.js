import { Queue } from 'bullmq'
import { env } from '../config/env.js'
import { QUEUE_NAMES } from '../config/constants.js'

const connection = { url: env.REDIS_URL }

export const orderPushQueue = new Queue(QUEUE_NAMES.ORDER_PUSH, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export const trackingPollQueue = new Queue(QUEUE_NAMES.TRACKING_POLL, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

export const shopifySyncQueue = new Queue(QUEUE_NAMES.SHOPIFY_SYNC, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export const maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 30_000 },
  },
})

/**
 * Close all queue connections (for graceful shutdown).
 * @returns {Promise<void>}
 */
export async function closeQueues() {
  await Promise.all([
    orderPushQueue.close(),
    trackingPollQueue.close(),
    shopifySyncQueue.close(),
    maintenanceQueue.close(),
  ])
}
