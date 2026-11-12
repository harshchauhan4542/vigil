import {
  getException,
  insertLedgerEntries,
  listExceptions,
  listLedgerEntries,
  transitionException,
  upsertSeedObject,
} from '@vigil/db';
import { describe, expect, it } from 'vitest';
import { detectExceptions } from '../src/sync/detect.js';
import { useTestEnv } from './helpers.js';

const env = useTestEnv();
const NOW = new Date('2026-11-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

async function seedWorld() {
  const { fake, handle } = env;
  fake.addAuthorization('AUTH-OLD', 4800, hoursAgo(61)); // honor ends in 11h → E3
  fake.addAuthorization('AUTH-NEW', 12900, hoursAgo(5)); // fine
  for (const id of ['AUTH-OLD', 'AUTH-NEW']) {
    await upsertSeedObject(handle.db, {
      seedKey: `auth:${id}`,
      kind: 'order_authorize',
      paypalId: `ORDER-${id}`,
      status: 'CREATED',
      data: { authorization_id: id },
    });
  }
  // One clean sale, one sale with a wrong booking.
  fake.addTransaction('TX-OK', 6500, '2026-11-02T10:00:00Z', { invoice_id: 'INV-1' });
  fake.addTransaction('TX-BAD', 3200, '2026-11-02T11:00:00Z', { invoice_id: 'INV-2' });
  await insertLedgerEntries(handle.db, [
    {
      id: '00000000-0000-4000-8000-000000000001',
      source: 'books',
      externalRef: 'INV-1',
      amountCents: 6500,
      currency: 'USD',
      bookedOn: '2026-11-02',
      memo: 'Sale INV-1',
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      source: 'books',
      externalRef: 'INV-2',
      amountCents: 2900,
      currency: 'USD',
      bookedOn: '2026-11-02',
      memo: 'Sale INV-2',
    },
  ]);
}

describe('detectExceptions', () => {
  it('syncs mirrors, detects E3 + E4 and marks matched ledger rows', async () => {
    await seedWorld();
    const s = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    expect(s).toMatchObject({ authorizationsSynced: 2, transactionsSynced: 2, detected: 2 });
    const list = await listExceptions(env.handle.db);
    expect(list.map((e) => [e.type, e.targetRef]).sort()).toEqual([
      ['AUTH_HONOR_EXPIRING', 'authorization:AUTH-OLD'],
      ['UNMATCHED_TXN', 'txn:TX-BAD'],
    ]);
    const e3 = list.find((e) => e.type === 'AUTH_HONOR_EXPIRING')!;
    expect(e3).toMatchObject({
      amountAtRiskCents: 4800,
      status: 'OPEN',
      severity: 3,
      score: 14400,
    });
    const ledger = await listLedgerEntries(env.handle.db);
    expect(ledger.find((l) => l.externalRef === 'INV-1')?.matchedTxnId).toBe('TX-OK');
    expect(ledger.find((l) => l.externalRef === 'INV-2')?.matchedTxnId).toBeNull();
  });

  it('is idempotent and re-opens a dismissed exception that fires again', async () => {
    await seedWorld();
    const first = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    const second = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    expect(second.created).toEqual([]);
    expect(await listExceptions(env.handle.db)).toHaveLength(2);

    const id = first.created[0]!;
    await transitionException(env.handle.db, id, 'OPEN', 'DISMISSED', { type: 'human', id: 'u' });
    const third = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    expect(third.reopened).toEqual([id]);
    expect((await getException(env.handle.db, id))?.status).toBe('OPEN');
  });

  it('ignores stale authorization ids (404) without failing the sweep', async () => {
    await seedWorld();
    await upsertSeedObject(env.handle.db, {
      seedKey: 'auth:gone',
      kind: 'order_authorize',
      paypalId: 'ORDER-GONE',
      status: 'CREATED',
      data: { authorization_id: 'AUTH-GONE' },
    });
    const s = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    expect(s.authorizationsSynced).toBe(2);
  });
});

describe('books booked today', () => {
  it('matches a sale booked today, and holds back a fresh booking with no PayPal item', async () => {
    const { fake, handle } = env;
    // Sold and booked today: must match, not be "missing in books".
    fake.addTransaction('TX-TODAY', 4200, hoursAgo(5), { invoice_id: 'INV-T' });
    await insertLedgerEntries(handle.db, [
      {
        id: '00000000-0000-4000-8000-000000000011',
        source: 'books',
        externalRef: 'INV-T',
        amountCents: 4200,
        currency: 'USD',
        bookedOn: '2026-11-05',
        memo: 'Sale INV-T',
      },
      // Booked today with nothing in PayPal yet: too new to call "missing in PayPal".
      {
        id: '00000000-0000-4000-8000-000000000012',
        source: 'books',
        externalRef: 'INV-LAG',
        amountCents: 1000,
        currency: 'USD',
        bookedOn: '2026-11-05',
        memo: 'Sale INV-LAG',
      },
    ]);
    const s = await detectExceptions({ db: handle.db, http: env.http, now: NOW });
    expect(s.detected).toBe(0);
    const ledger = await listLedgerEntries(handle.db);
    expect(ledger.find((l) => l.externalRef === 'INV-T')?.matchedTxnId).toBe('TX-TODAY');
  });
});

describe('Transaction Search not enabled on the PayPal app', () => {
  it('skips E4 (no false "missing in PayPal") but still detects E3', async () => {
    const { http: mswHttp, HttpResponse } = await import('msw');
    await seedWorld();
    env.server.use(
      mswHttp.get('https://api-m.sandbox.paypal.com/v1/reporting/transactions', () =>
        HttpResponse.json(
          {
            name: 'NOT_AUTHORIZED',
            message: 'Authorization failed due to insufficient permissions.',
          },
          { status: 403 },
        ),
      ),
    );
    const s = await detectExceptions({ db: env.handle.db, http: env.http, now: NOW });
    expect(s.transactionsSynced).toBeNull();
    const types = (await listExceptions(env.handle.db)).map((e) => e.type);
    expect(types).toEqual(['AUTH_HONOR_EXPIRING']);
  });
});
