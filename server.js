import 'dotenv/config'
import { env } from './src/config/env.js'
import { connectPostgres, disconnectPostgres } from './src/db/postgres/connection.js'
import { connectRedis, disconnectRedis } from './src/cache/redis.js'
import { seedServiceablePincodes } from './src/cache/pincodeCache.js'
import { registerScheduledJobs } from './src/queue/schedulers.js'
import { closeQueues } from './src/queue/queues.js'
import { createApp } from './src/app.js'
import { logger } from './src/utils/logger.js'

async function boot() {
  logger.info('Booting zappr-middleware...')

  await Promise.all([connectPostgres(), connectRedis()])
  await seedServiceablePincodes()
  await registerScheduledJobs()

  const app = createApp()

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, mode: env.ZAPPR_MODE }, 'HTTP server listening')
  })

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true

    logger.info({ signal }, 'Shutting down...')
    server.close(async () => {
      try {
        await closeQueues()
        await Promise.all([disconnectPostgres(), disconnectRedis()])
        logger.info('Clean shutdown complete')
        process.exit(0)
      } catch (err) {
        logger.error({ err }, 'Error during shutdown')
        process.exit(1)
      }
    })
    setTimeout(() => {
      logger.error('Forced shutdown after timeout')
      process.exit(1)
    }, 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'Unhandled promise rejection')
    shutdown('unhandledRejection')
  })
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting')
    process.exit(1)
  })
}

boot().catch((err) => {
  console.error('Boot failed:', err)
  process.exit(1)
})
