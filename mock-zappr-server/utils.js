/**
 * Random delay between 80–350ms simulating real API latency.
 * @returns {Promise<void>}
 */
export function randomLatency() {
  const ms = 80 + Math.random() * 270
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * ~2% chance of responding with 503 Retry-After to test retry logic.
 * @param {import('express').Response} res
 * @returns {boolean} true if 503 was sent
 */
export function maybe503(res) {
  if (Math.random() < 0.02) {
    res.set('Retry-After', '2')
    res.status(503).json({ error: 'Service temporarily unavailable' })
    return true
  }
  return false
}

/**
 * EasyEcom requires both x-api-key and Authorization: Bearer <jwt> on every call.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function authMiddleware(req, res, next) {
  const expectedXApiKey = process.env.MOCK_X_API_KEY ?? 'MOCK_ZAPPR_X_API_KEY'
  const expectedToken = process.env.MOCK_API_KEY ?? 'MOCK_ZAPPR_KEY'

  const xApiKey = req.headers['x-api-key']
  const auth = req.headers.authorization ?? ''

  if (xApiKey !== expectedXApiKey || auth !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ status: false, message: 'Unauthorized' })
  }
  next()
}
