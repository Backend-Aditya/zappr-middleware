import { randomUUID } from 'node:crypto'

/**
 * Attach X-Request-Id to every request/response.
 * @type {import('express').RequestHandler}
 */
export function requestIdMiddleware(req, res, next) {
  const id = req.headers['x-request-id'] ?? randomUUID()
  req.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}
