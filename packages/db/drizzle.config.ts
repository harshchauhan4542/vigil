import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL migrations from src/schema.ts (`pnpm db:generate`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
