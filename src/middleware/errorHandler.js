import { AppError } from '../errors.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('error-handler')

/**
 * Global Express 5 error handler. Must have 4 params.
 * @type {import('express').ErrorRequestHandler}
 */
 
export function errorHandler(err, req, res, _next) {
  const requestId = req.requestId

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error({ err, requestId }, err.message)
    } else {
      log.warn({ err: { code: err.code, message: err.message }, requestId }, err.message)
    }

    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
      requestId,
    })
  }

  log.error({ err, requestId }, 'Unhandled error')

  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    requestId,
  })
}
