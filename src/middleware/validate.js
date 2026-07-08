import { ZodError } from 'zod'
import { ValidationError } from '../errors.js'

/**
 * @template T
 * @param {import('zod').ZodSchema<T>} schema
 * @param {'body' | 'query' | 'params'} [source]
 * @returns {import('express').RequestHandler}
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req[source])
      // Express 5: req.query is a read-only getter — store parsed on req.validatedQuery
      if (source === 'query') {
        req.validatedQuery = parsed
      } else {
        req[source] = parsed
      }
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        return next(new ValidationError('Validation failed', err.errors))
      }
      next(err)
    }
  }
}
