import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../../shared/errors/AppError.js';

export async function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...error.details,
      });
    }

    if ('validation' in error && error.validation) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Request does not match the API schema',
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });
}
