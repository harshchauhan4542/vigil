import { defineConfig } from 'vitest/config';

// Each test starts an in-memory PGlite; under parallel turbo runs that can take seconds.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
