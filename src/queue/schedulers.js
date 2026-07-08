import { maintenanceQueue } from './queues.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('schedulers')

/**
 * Register recurring BullMQ jobs.
 * Called once at server boot.
 * @returns {Promise<void>}
 */
export async function registerScheduledJobs() {
  await maintenanceQueue.add(
    'daily-db-cleanup',
    { type: 'cleanup' },
    {
      repeat: { cron: '0 21 * * *' },
      jobId: 'daily-db-cleanup',
    },
  )

  log.info('Scheduled jobs registered')
}
