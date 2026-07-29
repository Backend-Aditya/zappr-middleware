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

  // Fallback/refresh sync for the Zappr-managed Shopify location's inventory
  // display — 4x/day keeps EasyEcom API usage well within its 500 req/day
  // quota alongside order pushes, tracking polling, and storefront checks.
  await maintenanceQueue.add(
    'zappr-inventory-sync',
    { type: 'zappr-inventory-sync' },
    {
      repeat: { cron: '0 */6 * * *' },
      jobId: 'zappr-inventory-sync',
    },
  )

  // Catches products marked zappr_eligible before they've ever been viewed
  // on the storefront or ordered (organic tracking wouldn't see them yet).
  await maintenanceQueue.add(
    'zappr-sku-scan',
    { type: 'zappr-sku-scan' },
    {
      repeat: { cron: '30 21 * * *' },
      jobId: 'zappr-sku-scan',
    },
  )

  log.info('Scheduled jobs registered')
}
