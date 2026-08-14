import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/connector/src/conformance/**/*.test.ts'],
    maxWorkers: 2,
  },
});
