import { randomUUID } from 'node:crypto'
import { getRedis } from '../cache/redis.js'

// Only releases the lock if it still holds our token — a slow holder whose
// lock already expired must never delete a different holder's lock.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Acquire a short-lived distributed lock, polling until it succeeds or times out.
 * @param {string} key
 * @param {{ ttlMs?: number, waitMs?: number, retryMs?: number }} [opts]
 * @returns {Promise<() => Promise<void>>} release function; throws if the lock could not be acquired in time
 */
export async function acquireLock(key, opts = {}) {
  const { ttlMs = 15_000, waitMs = 5_000, retryMs = 100 } = opts
  const redis = getRedis()
  const token = randomUUID()
  const deadline = Date.now() + waitMs

  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX')
    if (ok) {
      return () => redis.eval(RELEASE_SCRIPT, 1, key, token)
    }
    if (Date.now() >= deadline) {
      throw new Error(`Could not acquire lock ${key} within ${waitMs}ms`)
    }
    await new Promise((r) => setTimeout(r, retryMs))
  }
}
