import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'
import * as schema from './schema.js'

const { Pool } = pg

let _db = null
let _pool = null

/**
 * @returns {import('drizzle-orm/node-postgres').NodePgDatabase}
 */
export function getDb() {
  if (!_db) throw new Error('Postgres not connected. Call connectPostgres() first.')
  return _db
}

/**
 * Connect to PostgreSQL and return Drizzle instance.
 * @returns {Promise<import('drizzle-orm/node-postgres').NodePgDatabase>}
 */
export async function connectPostgres() {
  if (_db) return _db

  _pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  _pool.on('error', (err) => {
    logger.error({ err }, 'Postgres pool error')
  })

  await _pool.query('SELECT 1')
  _db = drizzle(_pool, { schema, logger: false })
  logger.info('PostgreSQL connected')
  return _db
}

/**
 * Gracefully close the Postgres pool.
 * @returns {Promise<void>}
 */
export async function disconnectPostgres() {
  if (_pool) {
    await _pool.end()
    _db = null
    _pool = null
    logger.info('PostgreSQL disconnected')
  }
}
