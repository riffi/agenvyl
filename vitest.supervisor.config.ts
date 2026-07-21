import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/supervisor/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
