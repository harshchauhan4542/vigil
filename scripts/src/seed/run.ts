// Idempotent sandbox seeder. Each seed key is created once (deterministic PayPal-Request-Id, so a
// crash between PayPal's reply and our DB write is also safe within the retention window), then
// re-runs only refresh status and advance orders a buyer has since approved.
import { money, parseMoney, toPayPalAmount } from '@vigil/core';
import {
  getSeedObject,
  insertCustomerNote,
  insertLedgerEntries,
  listSeedObjects,
  upsertSeedObject,
  type Db,
  type SeedObject,
} from '@vigil/db';
import {
  paypalRequestId,
  reads,
  type MutatingOperation,
  type Order,
  type PayPalHttp,
} from '@vigil/paypal';
import {
  authorizeOrder,
  captureOrder,
  createOrder,
  createPlan,
  createProduct,
  createSubscription,
  seedTracker,
  type CardSource,
} from '@vigil/paypal/sandbox-setup';
import {
  AUTH_ORDERS,
  CAPTURE_ORDERS,
  INJECTION_NOTE,
  PLAN,
  PRODUCT,
  SUBSCRIPTION_KEYS,
  buildLedger,
  cohortOrders,
  seedUuid,
  type CapturedOrder,
  type OrderSeed,
} from './plan.js';

export interface SeedOptions {
  http: PayPalHttp;
  db: Db;
  /** Card payment source (single-step, no buyer redirect). Omit for buyer-approval links. */
  card?: CardSource | undefined;
  /** Add a dated cohort of AUTHORIZE orders (e.g. "2026-11-02"). */
  cohort?: string | undefined;
  returnUrl?: string;
  cancelUrl?: string;
  log?: (line: string) => void;
}

export interface SeedSummary {
  created: string[];
  advanced: string[];
  pending: { key: string; link: string | undefined }[];
  ledgerAdded: number;
  notesAdded: number;
}

const rid = (key: string, op: MutatingOperation) => paypalRequestId(`seed:${key}`, op);
const usd = (cents: number) => toPayPalAmount(money(cents, 'USD'));
const linkOf = (o: { links?: { rel: string; href: string }[] }, ...rels: string[]) =>
  o.links?.find((l) => rels.includes(l.rel))?.href;

interface OrderData {
  order_id: string;
  intent: 'AUTHORIZE' | 'CAPTURE';
  amount_cents: number;
  invoice_id: string;
  authorization_id?: string;
  capture_id?: string;
  fee_cents?: number;
  booked_on?: string;
  approve_link?: string;
  tracker_added?: boolean;
}

/** Pull the authorization/capture the order produced, if any. */
function settledPart(order: Order) {
  const pu = order.purchase_units?.[0];
  const auth = pu?.payments?.authorizations?.[0];
  const cap = pu?.payments?.captures?.[0];
  return { auth, cap };
}

export async function runSeed(options: SeedOptions): Promise<SeedSummary> {
  const { http, db } = options;
  const log = options.log ?? (() => {});
  const returnUrl = options.returnUrl ?? 'https://example.com/vigil/return';
  const cancelUrl = options.cancelUrl ?? 'https://example.com/vigil/cancel';
  const summary: SeedSummary = {
    created: [],
    advanced: [],
    pending: [],
    ledgerAdded: 0,
    notesAdded: 0,
  };

  // ---- catalog + plan (create once; no refresh needed)
  let product = await getSeedObject(db, PRODUCT.key);
  if (!product) {
    const p = await createProduct(
      http,
      { name: PRODUCT.name, type: PRODUCT.type, description: 'Demo catalog for Vigil' },
      { requestId: rid(PRODUCT.key, 'products.create') },
    );
    product = await upsertSeedObject(db, {
      seedKey: PRODUCT.key,
      kind: 'product',
      paypalId: p.id,
      status: 'CREATED',
    });
    summary.created.push(PRODUCT.key);
  }
  let plan = await getSeedObject(db, PLAN.key);
  if (!plan) {
    const p = await createPlan(
      http,
      { product_id: product.paypalId, name: PLAN.name, price: PLAN.price, interval: PLAN.interval },
      { requestId: rid(PLAN.key, 'plans.create') },
    );
    plan = await upsertSeedObject(db, {
      seedKey: PLAN.key,
      kind: 'plan',
      paypalId: p.id,
      status: p.status,
    });
    summary.created.push(PLAN.key);
  }

  // ---- subscriptions (need buyer approval; see docs/spikes.md S2)
  for (const key of SUBSCRIPTION_KEYS) {
    const existing = await getSeedObject(db, key);
    const sub = existing
      ? await reads.getSubscription(http, existing.paypalId)
      : await createSubscription(
          http,
          {
            plan_id: plan.paypalId,
            custom_id: `vigil-seed-${key}`,
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
          { requestId: rid(key, 'subscriptions.create') },
        );
    const link =
      linkOf(sub, 'approve') ?? (existing?.data as { approve_link?: string })?.approve_link;
    await upsertSeedObject(db, {
      seedKey: key,
      kind: 'subscription',
      paypalId: sub.id,
      status: sub.status,
      data: { plan_id: plan.paypalId, ...(link ? { approve_link: link } : {}) },
    });
    if (!existing) summary.created.push(key);
    if (sub.status === 'APPROVAL_PENDING') summary.pending.push({ key, link });
  }

  // ---- orders
  const orderSeeds = [
    ...AUTH_ORDERS.map((s) => ({ seed: s, intent: 'AUTHORIZE' as const })),
    ...(options.cohort ? cohortOrders(options.cohort) : []).map((s) => ({
      seed: s,
      intent: 'AUTHORIZE' as const,
    })),
    ...CAPTURE_ORDERS.map((s) => ({ seed: s, intent: 'CAPTURE' as const })),
  ];
  for (const { seed, intent } of orderSeeds) {
    await ensureOrder(seed, intent);
  }

  // ---- merchant books with planted mismatches, from orders that have been captured
  const captured: CapturedOrder[] = [];
  for (const row of await listSeedObjects(db)) {
    const d = row.data as Partial<OrderData>;
    if (row.kind !== 'order_capture' || !d.capture_id) continue;
    captured.push({
      key: row.seedKey,
      captureId: d.capture_id,
      invoiceId: d.invoice_id!,
      amountCents: d.amount_cents!,
      currency: 'USD',
      feeCents: d.fee_cents ?? 0,
      bookedOn: d.booked_on!,
    });
  }
  summary.ledgerAdded = await insertLedgerEntries(db, buildLedger(captured));

  // ---- prompt-injection note (untrusted customer text) on the flagged order
  for (const seed of CAPTURE_ORDERS.filter((s) => s.injection)) {
    const row = await getSeedObject(db, seed.key);
    if (!row) continue;
    const added = await insertCustomerNote(db, {
      id: seedUuid(`note:${seed.key}`),
      source: 'support_inbox',
      externalRef: row.paypalId,
      body: INJECTION_NOTE,
    });
    if (added) summary.notesAdded++;
  }

  log(
    `Seed done: ${summary.created.length} created, ${summary.advanced.length} advanced, ` +
      `${summary.pending.length} waiting for buyer approval, ${summary.ledgerAdded} ledger rows added.`,
  );
  return summary;

  async function ensureOrder(seed: OrderSeed, intent: 'AUTHORIZE' | 'CAPTURE') {
    const kind = intent === 'AUTHORIZE' ? 'order_authorize' : 'order_capture';
    const existing = await getSeedObject(db, seed.key);
    const prev = (existing?.data ?? {}) as Partial<OrderData>;

    // Already authorized/captured: just refresh the payment's status.
    if (existing && (prev.authorization_id || prev.capture_id)) {
      const status = prev.authorization_id
        ? (await reads.getAuthorization(http, prev.authorization_id)).status
        : (await reads.getCapture(http, prev.capture_id!)).status;
      await maybeTrack(seed, existing, prev);
      await upsertSeedObject(db, { seedKey: seed.key, kind, paypalId: existing.paypalId, status });
      return;
    }

    let order: Order = existing
      ? await reads.getOrder(http, existing.paypalId)
      : await createOrder(
          http,
          {
            intent,
            amount: usd(seed.amountCents),
            custom_id: `vigil-seed-${seed.key}`,
            invoice_id: seed.invoiceId,
            description: seed.injection
              ? `${seed.description} (see support note)`
              : seed.description,
            ...(options.card ? { card: options.card } : {}),
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
          { requestId: rid(seed.key, 'orders.create') },
        );
    if (!existing) summary.created.push(seed.key);

    // Buyer approved since last run (or a card order came back APPROVED): finish it.
    if (order.status === 'APPROVED') {
      order =
        intent === 'AUTHORIZE'
          ? await authorizeOrder(http, order.id, { requestId: rid(seed.key, 'orders.authorize') })
          : await captureOrder(http, order.id, { requestId: rid(seed.key, 'orders.capture') });
      if (existing) summary.advanced.push(seed.key);
    }

    const { auth, cap } = settledPart(order);
    const data: OrderData = {
      order_id: order.id,
      intent,
      amount_cents: seed.amountCents,
      invoice_id: seed.invoiceId,
    };
    if (auth) data.authorization_id = auth.id;
    if (cap) {
      data.capture_id = cap.id;
      const fee = cap.seller_receivable_breakdown?.paypal_fee;
      data.fee_cents = fee ? parseMoney(fee.value, fee.currency_code).cents : 0;
      data.booked_on = (cap.create_time ?? new Date().toISOString()).slice(0, 10);
    }
    const link = linkOf(order, 'payer-action', 'approve');
    if (!auth && !cap) {
      if (link) data.approve_link = link;
      summary.pending.push({ key: seed.key, link });
    }
    const row = await upsertSeedObject(db, {
      seedKey: seed.key,
      kind,
      paypalId: order.id,
      status: auth?.status ?? cap?.status ?? order.status,
      data: { ...data },
    });
    if (cap) await maybeTrack(seed, row, data);
  }

  async function maybeTrack(seed: OrderSeed, row: SeedObject, data: Partial<OrderData>) {
    if (!seed.tracked || !data.capture_id || data.tracker_added) return;
    await seedTracker(http, {
      order_id: row.paypalId,
      capture_id: data.capture_id,
      tracking_number: `1ZVIGIL${seed.invoiceId.replace(/\D/g, '')}`,
      carrier: 'UPS',
    });
    await upsertSeedObject(db, {
      seedKey: seed.key,
      kind: row.kind,
      paypalId: row.paypalId,
      status: row.status,
      data: { ...(row.data as object), ...data, tracker_added: true },
    });
  }
}
