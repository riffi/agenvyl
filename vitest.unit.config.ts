import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/vitestDatabaseGlobalSetup.ts'],
    teardownTimeout: 30_000,
  },
});
