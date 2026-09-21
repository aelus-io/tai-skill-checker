import type { ErrorRequestHandler, RequestHandler } from 'express'
import multer from 'multer'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import { AppError } from './errors.js'
import { sanitizeRequestUrl } from './logging.js'

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route was not found' } })
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'Request validation failed', details: error.issues } })
      return
    }
    if (error instanceof multer.MulterError) {
      response.status(400).send({ error: { code: 'INVALID_UPLOAD', message: error.message } })
      return
    }
    if (error instanceof AppError) {
      response.status(error.status).send({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } })
      return
    }
    if (error instanceof Error && (error.message.includes('PDF') || error.message.includes('Only valid PDF'))) {
      response.status(400).send({ error: { code: 'INVALID_UPLOAD', message: error.message } })
      return
    }
    logger.error({ err: error, method: request.method, path: sanitizeRequestUrl(request.originalUrl) }, 'Unhandled request error')
    response.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } })
  }
}
