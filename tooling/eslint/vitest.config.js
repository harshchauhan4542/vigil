import { defineConfig } from 'vitest/config';

// Linting with typescript-eslint is slow to warm up under parallel turbo runs.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
