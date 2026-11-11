import { configDefaults, defineConfig } from 'vitest/config';

// Each test starts an in-memory PGlite; under parallel turbo runs that can take seconds.
// e2e/ holds Playwright specs (run with `pnpm e2e`), not unit tests.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
