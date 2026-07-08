import 'dotenv/config'
import { Worker } from 'bullmq'
import { connectPostgres, getDb  } from '../../db/postgres/connection.js'
import { connectRedis } from '../../cache/redis.js'
import { getAdapter } from '../../zappr/adapter.js'
import { pushOrderToZappr } from '../../services/orderService.js'
import { orderMappings } from '../../db/postgres/schema.js'
import { eq } from 'drizzle-orm'
import { ORDER_STATUS, QUEUE_NAMES } from '../../config/constants.js'
import { env } from '../../config/env.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('order-push-worker')

async function boot() {
  await Promise.all([connectPostgres(), connectRedis()])
  log.info('Order push worker booted')
}

/**
 * Process an order push job.
 * @param {import('bullmq').Job} job
 */
async function processJob(job) {
  const { shopifyOrderId, shopifyOrderName } = job.data
  log.info({ shopifyOrderId, attemptsMade: job.attemptsMade }, 'Processing order push')

  const adapter = await getAdapter()

  try {
    await pushOrderToZappr({ shopifyOrderId, shopifyOrderName }, adapter)
  } catch (err) {
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 3) - 1

    if (isLastAttempt) {
      log.error({ err, shopifyOrderId }, 'Order push failed after all retries — marking FAILED')
      await getDb().update(orderMappings)
        .set({ status: ORDER_STATUS.FAILED })
        .where(eq(orderMappings.shopifyOrderId, shopifyOrderId))
    }

    throw err
  }
}

boot().then(() => {
  const worker = new Worker(QUEUE_NAMES.ORDER_PUSH, processJob, {
    connection: { url: env.REDIS_URL },
    concurrency: 5,
  })

  worker.on('completed', (job) => log.info({ jobId: job.id }, 'Job completed'))
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'Job failed'))

  process.on('SIGTERM', async () => {
    await worker.close()
    process.exit(0)
  })
})
