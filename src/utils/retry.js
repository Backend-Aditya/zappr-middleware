import { createLogger } from './logger.js'

const log = createLogger('retry')

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, maxDelayMs?: number, shouldRetry?: (err: unknown) => boolean }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    shouldRetry = () => true,
  } = opts

  let lastErr

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err

      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err
      }

      const jitter = Math.random() * 200
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, maxDelayMs)

      log.warn({ attempt, delay: Math.round(delay), err: err?.message }, 'Retrying after error')
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw lastErr
}
