// pnpm seed:check — shows the mix of seeded objects as they are now in the sandbox.
import { ConfigError, loadSeedEnv } from '@vigil/config';
import { createPayPalClient } from '@vigil/paypal';
import { openDb } from './db.js';
import { inspectSeed } from './seed/check.js';

try {
  const env = loadSeedEnv();
  const { http } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    secret: env.PAYPAL_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
  });
  const handle = await openDb();
  const report = await inspectSeed(http, handle.db);
  await handle.close();
  console.table(report.objects);
  for (const [kind, statuses] of Object.entries(report.byKindStatus)) {
    console.log(
      `${kind}: ${Object.entries(statuses)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ')}`,
    );
  }
  console.log(`ledger rows: ${report.ledgerRows} · customer notes: ${report.notes}`);
  for (const p of report.pending) console.log(`pending: ${p.key}${p.link ? ` → ${p.link}` : ''}`);
} catch (error) {
  console.error(
    error instanceof ConfigError ? error.message : `seed:check failed: ${(error as Error).message}`,
  );
  process.exit(1);
}
