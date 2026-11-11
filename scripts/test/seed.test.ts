import {
  createTestDb,
  listCustomerNotes,
  listLedgerEntries,
  listSeedObjects,
  type DbHandle,
} from '@vigil/db';
import { MemoryCache, createPayPalClient, type PayPalHttp } from '@vigil/paypal';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inspectSeed } from '../src/seed/check.js';
import {
  AUTH_ORDERS,
  CAPTURE_ORDERS,
  INJECTION_NOTE,
  SUBSCRIPTION_KEYS,
  buildLedger,
} from '../src/seed/plan.js';
import { runSeed } from '../src/seed/run.js';
import { BASE, FakePayPal } from './fake-paypal.js';

const server = setupServer();
const card = { number: '4111111111111111', expiry: '2030-12', name: 'Test Buyer' };
let fake: FakePayPal;
let handle: DbHandle;
let http: PayPalHttp;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  fake = new FakePayPal();
  server.use(...fake.handlers());
  handle = await createTestDb();
  ({ http } = await createPayPalClient({
    clientId: 'c',
    secret: 's',
    baseUrl: BASE,
    cache: new MemoryCache(),
    sleep: async () => {},
  }));
});
afterEach(async () => {
  server.resetHandlers();
  await handle.close();
});

const ORDER_COUNT = AUTH_ORDERS.length + CAPTURE_ORDERS.length;

describe('runSeed (card source, single-step)', () => {
  it('creates everything once, and a second run creates nothing', async () => {
    const first = await runSeed({ http, db: handle.db, card });
    expect(fake.creates.filter((c) => c === 'order')).toHaveLength(ORDER_COUNT);
    expect(fake.creates.filter((c) => c === 'subscription')).toHaveLength(SUBSCRIPTION_KEYS.length);
    expect(first.created).toHaveLength(2 + SUBSCRIPTION_KEYS.length + ORDER_COUNT);

    const objects1 = await listSeedObjects(handle.db);
    const ledger1 = await listLedgerEntries(handle.db);
    const trackers1 = fake.trackers.length;

    const second = await runSeed({ http, db: handle.db, card });
    expect(second.created).toEqual([]);
    expect(second.ledgerAdded).toBe(0);
    expect(second.notesAdded).toBe(0);
    expect(fake.creates).toHaveLength(2 + SUBSCRIPTION_KEYS.length + ORDER_COUNT);
    expect(fake.trackers).toHaveLength(trackers1);
    expect(await listSeedObjects(handle.db)).toHaveLength(objects1.length);
    expect(await listLedgerEntries(handle.db)).toHaveLength(ledger1.length);
  });

  it('seeds holds, captures with and without tracking, and pending subscriptions', async () => {
    await runSeed({ http, db: handle.db, card });
    const report = await inspectSeed(http, handle.db);
    expect(report.byKindStatus).toEqual({
      order_authorize: { CREATED: AUTH_ORDERS.length },
      order_capture: { COMPLETED: CAPTURE_ORDERS.length },
      plan: { ACTIVE: 1 },
      product: { CREATED: 1 },
      subscription: { APPROVAL_PENDING: SUBSCRIPTION_KEYS.length },
    });
    const tracked = report.objects
      .filter((o) => o.kind === 'order_capture' && o.tracked)
      .map((o) => o.key);
    expect(tracked.sort()).toEqual(['cap:1', 'cap:2']);
    expect(fake.trackers.every((t) => t.body.carrier === 'UPS' && t.body.capture_id)).toBe(true);
    expect(report.pending.map((p) => p.key)).toEqual([...SUBSCRIPTION_KEYS]);
    expect(report.pending.every((p) => p.link?.startsWith('https://www.sandbox.paypal.com/'))).toBe(
      true,
    );
  });

  it('plants the three ledger mismatches and the injection note', async () => {
    await runSeed({ http, db: handle.db, card });
    const ledger = await listLedgerEntries(handle.db);
    const forInvoice = (inv: string) => ledger.filter((l) => l.externalRef === inv);

    // cap:1 missing fee
    expect(forInvoice('VIG-ORD-2001').map((l) => l.memo)).toEqual(['Sale VIG-ORD-2001']);
    // cap:2 wrong amount: books $29.00, PayPal $32.00
    expect(forInvoice('VIG-ORD-2002').find((l) => l.memo?.startsWith('Sale'))?.amountCents).toBe(
      2900,
    );
    // cap:3 duplicate refund
    expect(forInvoice('VIG-ORD-2003').filter((l) => l.memo?.startsWith('Refund'))).toHaveLength(2);
    // cap:4 clean: sale + fee
    expect(forInvoice('VIG-ORD-2004')).toHaveLength(2);
    expect(ledger.every((l) => Number.isInteger(l.amountCents))).toBe(true);

    const notes = await listCustomerNotes(handle.db);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe(INJECTION_NOTE);
    const cap4 = (await listSeedObjects(handle.db)).find((o) => o.seedKey === 'cap:4')!;
    expect(notes[0]!.externalRef).toBe(cap4.paypalId);
  });

  it('adds a dated cohort of holds without touching the base pool', async () => {
    await runSeed({ http, db: handle.db, card });
    const r = await runSeed({ http, db: handle.db, card, cohort: '2026-11-03' });
    expect(r.created).toEqual(['auth:2026-11-03:1', 'auth:2026-11-03:2']);
    await runSeed({ http, db: handle.db, card, cohort: '2026-11-03' });
    expect(fake.creates.filter((c) => c === 'order')).toHaveLength(ORDER_COUNT + 2);
  });

  it('recovers from a crash after PayPal replied but before the DB write', async () => {
    await runSeed({ http, db: handle.db, card });
    // Lose our record of one order; PayPal still has it.
    await handle.db.execute(
      (await import('drizzle-orm')).sql`delete from seed_objects where seed_key = 'auth:1'`,
    );
    const r = await runSeed({ http, db: handle.db, card });
    expect(r.created).toEqual(['auth:1']); // re-recorded...
    expect(fake.orders.size).toBe(ORDER_COUNT); // ...but PayPal returned the same order (same request id)
  });
});

describe('runSeed (buyer approval)', () => {
  it('leaves orders pending with links, then finishes the ones the buyer approved', async () => {
    const first = await runSeed({ http, db: handle.db });
    expect(first.pending.map((p) => p.key)).toEqual(
      expect.arrayContaining(['auth:1', 'cap:1', ...SUBSCRIPTION_KEYS]),
    );
    expect(await listLedgerEntries(handle.db)).toHaveLength(0);

    const objs = await listSeedObjects(handle.db);
    const id = (key: string) => objs.find((o) => o.seedKey === key)!.paypalId;
    fake.approve(id('auth:1'));
    fake.approve(id('cap:1'));

    const second = await runSeed({ http, db: handle.db });
    expect(second.created).toEqual([]);
    expect(second.advanced.sort()).toEqual(['auth:1', 'cap:1']);
    expect(fake.creates.filter((c) => c === 'order')).toHaveLength(ORDER_COUNT);
    expect(fake.trackers.map((t) => t.orderId)).toEqual([id('cap:1')]);
    expect(second.ledgerAdded).toBe(1); // cap:1 sale (its fee row is the planted omission)
  });
});

describe('buildLedger', () => {
  it('is pure and deterministic', () => {
    const caps = [
      {
        key: 'cap:4',
        captureId: 'C',
        invoiceId: 'I',
        amountCents: 2150,
        currency: 'USD',
        feeCents: 124,
        bookedOn: '2026-11-02',
      },
    ];
    expect(buildLedger(caps)).toEqual(buildLedger(caps));
    expect(buildLedger(caps).map((r) => r.amountCents)).toEqual([2150, -124]);
  });
});

describe('card refused by the sandbox', () => {
  it('falls back to buyer-approval links instead of failing', async () => {
    const { http: mswHttp, HttpResponse } = await import('msw');
    server.use(
      mswHttp.post(`${BASE}/v2/checkout/orders`, async ({ request }) => {
        const body = (await request.clone().json()) as { payment_source: { card?: unknown } };
        if (body.payment_source.card) {
          return HttpResponse.json(
            {
              name: 'UNPROCESSABLE_ENTITY',
              details: [{ issue: 'PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING' }],
            },
            { status: 422 },
          );
        }
        return undefined; // fall through to the fake
      }),
    );
    const lines: string[] = [];
    const r = await runSeed({ http, db: handle.db, card, log: (l) => lines.push(l) });
    expect(r.pending.map((p) => p.key)).toEqual(expect.arrayContaining(['auth:1', 'cap:1']));
    expect(lines.some((l) => l.includes('card refused'))).toBe(true);
  });
});
