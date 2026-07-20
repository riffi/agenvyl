import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/AppError.js';
import { registerErrorHandler } from './errorHandler.js';

describe('central error handler', () => {
  it('maps typed application errors to the public envelope', async () => {
    const app = Fastify({ logger: false });
    await registerErrorHandler(app);
    app.get('/known', async () => {
      throw new AppError('room_not_found', 404, 'Room not found', { room_id: 'missing' });
    });

    const response = await app.inject('/known');

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'room_not_found',
      message: 'Room not found',
      room_id: 'missing',
    });
    await app.close();
  });

  it('does not expose unexpected error details', async () => {
    const app = Fastify({ logger: false });
    await registerErrorHandler(app);
    app.get('/unexpected', async () => {
      throw new Error('database password leaked');
    });

    const response = await app.inject('/unexpected');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'internal_error',
      message: 'Internal server error',
    });
    expect(response.body).not.toContain('password');
    await app.close();
  });
});
