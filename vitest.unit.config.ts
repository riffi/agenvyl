import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/vitestDatabaseGlobalSetup.ts'],
    maxWorkers: 4,
    teardownTimeout: 30_000,
  },
});
