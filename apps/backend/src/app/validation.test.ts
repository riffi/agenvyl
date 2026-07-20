import { describe, expect, it, vi } from 'vitest';
import { buildApp as buildAppBase, type AppOptions } from './buildApp.js';
import { testDatabaseUrl } from '../testDatabase.js';

const buildApp = (options: AppOptions = {}) => buildAppBase({ connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32), ...options });

describe('route validation contracts', () => {
  it('returns a stable envelope for a body type mismatch', async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl('validation'),
      distPath: 'missing-dist',
      fetch: vi.fn<typeof fetch>(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { title: { unexpected: true } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_error',
      message: 'Request does not match the API schema',
    });
    await app.close();
  });
});
