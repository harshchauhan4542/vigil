// Opens the database the same way the apps do: DATABASE_URL (pg) or PGlite in .data/pglite.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbEnv } from '@vigil/config';
import { createDb } from '@vigil/db';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function openDb() {
  const env = loadDbEnv();
  return createDb({
    databaseUrl: env.DATABASE_URL,
    pgliteDir: path.resolve(repoRoot, env.PGLITE_DIR),
  });
}
