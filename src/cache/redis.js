import Redis from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

let _client = null

/**
 * @returns {Redis}
 */
export function getRedis() {
  if (!_client) throw new Error('Redis not connected. Call connectRedis() first.')
  return _client
}

/**
 * Initialize ioredis client.
 * @returns {Promise<Redis>}
 */
export async function connectRedis() {
  if (_client) return _client

  _client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  })

  _client.on('error', (err) => logger.error({ err }, 'Redis error'))
  _client.on('connect', () => logger.info('Redis connected'))
  _client.on('reconnecting', () => logger.warn('Redis reconnecting'))

  await _client.connect()
  return _client
}

/**
 * Close Redis connection gracefully.
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  if (_client) {
    await _client.quit()
    _client = null
    logger.info('Redis disconnected')
  }
}
