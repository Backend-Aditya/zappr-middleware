import { Router } from 'express'
import { getRedis } from '../cache/redis.js'
import { getDb } from '../db/postgres/connection.js'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const router = Router()

const __dirname = dirname(fileURLToPath(import.meta.url))
let version = 'unknown'
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))
  version = pkg.version
} catch { /* noop */ }

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version })
})

router.get('/ready', async (_req, res) => {
  const checks = await Promise.allSettled([
    getRedis().ping().then(() => true),
    getDb().execute(sql`SELECT 1`).then(() => true),
  ])

  const [redis, pg] = checks.map((c) => c.status === 'fulfilled')
  const allReady = redis && pg

  res.status(allReady ? 200 : 503).json({ db: pg, redis, queue: redis })
})

export default router
