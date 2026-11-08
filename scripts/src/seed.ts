// pnpm seed [--cohort[=YYYY-MM-DD]] [--no-card]
// Creates the demo data in the PayPal sandbox and the local books. Safe to run repeatedly.
import { ConfigError, loadSeedEnv } from '@vigil/config';
import { createPayPalClient } from '@vigil/paypal';
import { openDb } from './db.js';
import { runSeed } from './seed/run.js';

const args = process.argv.slice(2);
const cohortArg = args.find((a) => a.startsWith('--cohort'));
const cohort = cohortArg
  ? (cohortArg.split('=')[1] ?? new Date().toISOString().slice(0, 10))
  : undefined;

try {
  const env = loadSeedEnv();
  const card =
    args.includes('--no-card') || !env.SEED_CARD_NUMBER
      ? undefined
      : { number: env.SEED_CARD_NUMBER, expiry: env.SEED_CARD_EXPIRY, name: 'Vigil Test Buyer' };
  const { http } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    secret: env.PAYPAL_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
    redisUrl: env.REDIS_URL,
  });
  const handle = await openDb();
  await handle.migrate();
  const summary = await runSeed({ http, db: handle.db, card, cohort, log: console.log });
  for (const p of summary.pending) {
    console.log(`  waiting for buyer approval: ${p.key}${p.link ? ` → ${p.link}` : ''}`);
  }
  if (summary.pending.length) {
    console.log('Log in with the sandbox Personal account to approve, then run `pnpm seed` again.');
  }
  await handle.close();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`${error.message}\nAdd the missing values to vigil/.env (see .env.example).`);
  } else {
    console.error(`Seeding failed: ${(error as Error).message}`);
  }
  process.exit(1);
}
