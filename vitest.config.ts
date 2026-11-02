import { defineConfig } from 'vitest/config';

// Run every workspace project from the root with `pnpm vitest`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tooling/*'],
  },
});
