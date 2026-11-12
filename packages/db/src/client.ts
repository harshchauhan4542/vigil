// Driver switch: PGlite (embedded Postgres) locally and in tests, node-postgres on Render.
// A postgres:// DATABASE_URL selects `pg`; anything else uses PGlite.
import type { Pool as PgPool } from 'pg';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractTablesWithRelations, SQL } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries: the database or an open transaction. */
export type Executor = Db | Tx;

/** Default: next to this package's sources. Bundlers (Next.js) pass `migrationsDir` explicitly. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

export interface DbHandle {
  db: Db;
  driver: 'pglite' | 'pg';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** postgres:// URL for node-postgres. Omit to use PGlite. */
  databaseUrl?: string | undefined;
  /** PGlite data directory, or 'memory://' (default when omitted). */
  pgliteDir?: string | undefined;
  /** Where the SQL migrations live (defaults to MIGRATIONS_DIR). */
  migrationsDir?: string | undefined;
}

const isPostgresUrl = (url: string | undefined): url is string =>
  !!url && /^postgres(ql)?:\/\//.test(url);

export async function createDb(options: CreateDbOptions = {}): Promise<DbHandle> {
  if (isPostgresUrl(options.databaseUrl)) {
    // pg is CommonJS; loaded as an external ES import its named exports can be missing, so
    // fall back to the default export.
    const pg = (await import('pg')) as unknown as {
      Pool?: typeof PgPool;
      default?: { Pool?: typeof PgPool };
    };
    const Pool = pg.Pool ?? pg.default?.Pool;
    if (!Pool) throw new Error('pg could not be loaded');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: options.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db: db as unknown as Db,
      driver: 'pg',
      migrate: () => migrate(db, { migrationsFolder: options.migrationsDir ?? MIGRATIONS_DIR }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dataDir = options.pgliteDir ?? 'memory://';
  if (!dataDir.includes('://')) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migrate(db, { migrationsFolder: options.migrationsDir ?? MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}

/** Fresh, migrated in-memory database (tests). */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createDb();
  await handle.migrate();
  return handle;
}

/** Run raw SQL and return its rows (both drivers expose `.rows`). */
export async function queryRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
