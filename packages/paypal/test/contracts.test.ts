// Contract tests: each call hits the right method + path with spec field names and headers.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as actions from '../src/actions.js';
import { PayPalApiError } from '../src/errors.js';
import { paypalRequestId } from '../src/idempotency.js';
import {
  MOCKABLE_OPERATIONS,
  MockNotSupportedError,
  isMockableOperation,
  mockResponseHeader,
} from '../src/mock-response.js';
import * as reads from '../src/reads.js';
import * as setup from '../src/sandbox-setup.js';
import { BASE, makeClient, server, tokenHandler } from './helpers.js';

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Headers;
  body: unknown;
}

let seen: Seen[] = [];

/** Record every request to PayPal and answer with `reply`. */
function capture(reply: (s: Seen) => Response | Promise<Response> = () => HttpResponse.json({})) {
  server.use(
    http.all(`${BASE}/v*/*`, async ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname === '/v1/oauth2/token') return undefined;
      const text = await request.text();
      const s: Seen = {
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      seen.push(s);
      return reply(s);
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  seen = [];
});
afterAll(() => server.close());

async function client() {
  server.use(tokenHandler());
  return (await makeClient()).http;
}

const usd = (value: string) => ({ currency_code: 'USD', value });
const RID = paypalRequestId('proposal-1', 'authorizations.capture');

describe('reads', () => {
  it.each([
    ['getOrder', '/v2/checkout/orders/O-1'],
    ['getAuthorization', '/v2/payments/authorizations/O-1'],
    ['getCapture', '/v2/payments/captures/O-1'],
    ['getRefund', '/v2/payments/refunds/O-1'],
    ['getSubscription', '/v1/billing/subscriptions/O-1'],
    ['getInvoice', '/v2/invoicing/invoices/O-1'],
    ['getDispute', '/v1/customer/disputes/O-1'],
  ] as const)('%s → GET %s', async (fn, path) => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'O-1', status: 'X' }));
    const res = await (reads[fn] as (h: unknown, id: string) => Promise<{ id: string }>)(h, 'O-1');
    expect(res.id).toBe('O-1');
    expect(seen[0]).toMatchObject({ method: 'GET', path });
    expect(seen[0]!.headers.get('paypal-request-id')).toBeNull();
    expect(seen[0]!.headers.get('prefer')).toBeNull();
  });

  it('URL-encodes ids', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'x' }));
    await reads.getOrder(h, '../v1/oauth2');
    expect(seen[0]!.path).toBe('/v2/checkout/orders/..%2Fv1%2Foauth2');
  });

  it('lists subscription transactions with ISO start/end', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ transactions: [{ id: 'T1', status: 'FAILED' }] }));
    const tx = await reads.listSubscriptionTransactions(
      h,
      'I-SUB1',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(tx).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      path: '/v1/billing/subscriptions/I-SUB1/transactions',
      query: { start_time: '2026-10-01T00:00:00.000Z', end_time: '2026-11-01T00:00:00.000Z' },
    });
  });

  it('splits Transaction Search into 31-day windows and follows every page', async () => {
    const h = await client();
    capture((s) =>
      HttpResponse.json({
        transaction_details: [
          { transaction_info: { transaction_id: `${s.query.start_date}-p${s.query.page}` } },
        ],
        page: Number(s.query.page),
        total_pages: 2,
      }),
    );
    const start = new Date('2026-09-01T00:00:00Z');
    const end = new Date('2026-11-01T00:00:00Z'); // 61 days → 2 windows
    const rows = [];
    for await (const row of reads.searchTransactions(h, start, end)) rows.push(row);
    expect(rows).toHaveLength(4); // 2 windows × 2 pages
    expect(seen.map((s) => s.query.page)).toEqual(['1', '2', '1', '2']);
    for (const s of seen) {
      expect(s.path).toBe('/v1/reporting/transactions');
      expect(s.query).toMatchObject({ fields: 'all', page_size: '500' });
      const span = Date.parse(s.query.end_date!) - Date.parse(s.query.start_date!);
      expect(span).toBeLessThanOrEqual(reads.MAX_SEARCH_WINDOW_MS);
    }
    expect(reads.searchWindows(end, start)).toEqual([]);
  });

  it('lists trackers, invoices and disputes', async () => {
    const h = await client();
    capture((s) =>
      HttpResponse.json(
        s.path.includes('trackers')
          ? { trackers: [{ transaction_id: 'C1', status: 'SHIPPED' }] }
          : { items: [{}] },
      ),
    );
    expect(await reads.listTrackers(h, 'C1')).toHaveLength(1);
    expect(await reads.listInvoices(h)).toHaveLength(1);
    expect(await reads.listDisputes(h, { dispute_state: 'REQUIRED_ACTION' })).toHaveLength(1);
    expect(seen.map((s) => [s.path, s.query])).toEqual([
      ['/v1/shipping/trackers', { transaction_id: 'C1' }],
      ['/v2/invoicing/invoices', { page: '1', page_size: '50', total_required: 'true' }],
      ['/v1/customer/disputes', { dispute_state: 'REQUIRED_ACTION' }],
    ]);
  });
});

describe('actions', () => {
  it('captures an authorization with spec field names', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'CAP1', status: 'COMPLETED' }, { status: 201 }));
    const res = await actions.captureAuthorization(
      h,
      {
        authorization_id: 'AUTH1',
        amount: usd('48.00'),
        final_capture: true,
        invoice_id: 'VIG-ORD-1042',
        note_to_payer: 'Thanks — your order has shipped.',
      },
      { requestId: RID },
    );
    expect(res.data.id).toBe('CAP1');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v2/payments/authorizations/AUTH1/capture',
      body: {
        amount: usd('48.00'),
        final_capture: true,
        invoice_id: 'VIG-ORD-1042',
        note_to_payer: 'Thanks — your order has shipped.',
      },
    });
    expect(seen[0]!.body).not.toHaveProperty('authorization_id');
    expect(seen[0]!.headers.get('paypal-request-id')).toBe(RID);
    expect(seen[0]!.headers.get('prefer')).toBe('return=representation');
  });

  it('reauthorizes with only an amount', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'AUTH2', status: 'CREATED' }, { status: 201 }));
    const res = await actions.reauthorizeAuthorization(
      h,
      { authorization_id: 'AUTH1', amount: usd('55.20') },
      { requestId: RID },
    );
    expect(res.data.id).toBe('AUTH2');
    expect(seen[0]).toMatchObject({
      path: '/v2/payments/authorizations/AUTH1/reauthorize',
      body: { amount: usd('55.20') },
    });
  });

  it('voids with no body', async () => {
    const h = await client();
    capture(() => new HttpResponse(null, { status: 204 }));
    const res = await actions.voidAuthorization(
      h,
      { authorization_id: 'AUTH1' },
      { requestId: RID },
    );
    expect(res.status).toBe(204);
    expect(seen[0]).toMatchObject({
      path: '/v2/payments/authorizations/AUTH1/void',
      body: undefined,
    });
  });

  it('refunds partially, and fully with an empty body', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'R1', status: 'COMPLETED' }, { status: 201 }));
    await actions.refundCapture(
      h,
      { capture_id: 'CAP1', amount: usd('12.50'), note_to_payer: 'Duplicate charge reversed' },
      { requestId: RID },
    );
    await actions.refundCapture(h, { capture_id: 'CAP1' }, { requestId: RID });
    expect(seen[0]).toMatchObject({
      path: '/v2/payments/captures/CAP1/refund',
      body: { amount: usd('12.50'), note_to_payer: 'Duplicate charge reversed' },
    });
    expect(seen[1]!.body).toEqual({});
  });

  it('adds tracking without a PayPal-Request-Id', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'O1', status: 'COMPLETED' }, { status: 201 }));
    await actions.addTracking(h, {
      order_id: 'O1',
      capture_id: 'CAP1',
      tracking_number: '1Z999AA10123456784',
      carrier: 'UPS',
      notify_payer: true,
    });
    expect(seen[0]).toMatchObject({
      path: '/v2/checkout/orders/O1/track',
      body: {
        capture_id: 'CAP1',
        tracking_number: '1Z999AA10123456784',
        carrier: 'UPS',
        notify_payer: true,
      },
    });
    expect(seen[0]!.headers.get('paypal-request-id')).toBeNull();
  });

  it('captures a subscription outstanding balance', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ status: 'COMPLETED' }, { status: 202 }));
    await actions.captureSubscriptionBalance(
      h,
      { subscription_id: 'I-SUB1', amount: usd('24.00'), note: 'Retry after card update' },
      { requestId: RID },
    );
    expect(seen[0]).toMatchObject({
      path: '/v1/billing/subscriptions/I-SUB1/capture',
      body: {
        note: 'Retry after card update',
        capture_type: 'OUTSTANDING_BALANCE',
        amount: usd('24.00'),
      },
    });
  });

  it('suspends a subscription', async () => {
    const h = await client();
    capture(() => new HttpResponse(null, { status: 204 }));
    const res = await actions.suspendSubscription(h, {
      subscription_id: 'I-SUB1',
      reason: 'Repeated failures',
    });
    expect(res.status).toBe(204);
    expect(seen[0]).toMatchObject({
      path: '/v1/billing/subscriptions/I-SUB1/suspend',
      body: { reason: 'Repeated failures' },
    });
  });

  it('surfaces mocked 422s as typed errors', async () => {
    const h = await client();
    capture((s) =>
      s.headers.get('paypal-mock-response')
        ? HttpResponse.json(
            {
              name: 'UNPROCESSABLE_ENTITY',
              debug_id: 'd1',
              details: [{ issue: 'AUTHORIZATION_EXPIRED' }],
            },
            { status: 422 },
          )
        : HttpResponse.json({}),
    );
    const err = await actions
      .captureAuthorization(
        h,
        { authorization_id: 'AUTH1', amount: usd('1.00'), final_capture: true },
        { requestId: RID, mock: 'AUTHORIZATION_EXPIRED' },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect((err as PayPalApiError).kind).toBe('authorization_expired');
    expect(seen[0]!.headers.get('paypal-mock-response')).toBe(
      '{"mock_application_codes":"AUTHORIZATION_EXPIRED"}',
    );
  });
});

describe('sandbox setup', () => {
  it('creates product, plan, subscription and orders with request ids', async () => {
    const h = await client();
    capture((s) =>
      HttpResponse.json(
        { id: `id-${seen.length}`, status: 'CREATED', path: s.path },
        { status: 201 },
      ),
    );
    const o = (k: string) => ({ requestId: `rid-${k}` });
    await setup.createProduct(h, { name: 'Vigil Coffee Club', type: 'PHYSICAL' }, o('p'));
    await setup.createPlan(
      h,
      { product_id: 'PROD-1', name: 'Monthly beans', price: usd('24.00'), interval: 'MONTH' },
      o('plan'),
    );
    await setup.createSubscription(
      h,
      {
        plan_id: 'P-1',
        custom_id: 'vigil-seed-sub-1',
        return_url: 'https://x/r',
        cancel_url: 'https://x/c',
      },
      o('sub'),
    );
    await setup.createOrder(
      h,
      {
        intent: 'AUTHORIZE',
        amount: usd('48.00'),
        custom_id: 'vigil-seed-a1',
        invoice_id: 'VIG-ORD-1',
      },
      o('order'),
    );
    await setup.authorizeOrder(h, 'O1', o('auth'));
    await setup.captureOrder(h, 'O2', o('cap'));
    expect(seen.map((s) => [s.method, s.path, s.headers.get('paypal-request-id')])).toEqual([
      ['POST', '/v1/catalogs/products', 'rid-p'],
      ['POST', '/v1/billing/plans', 'rid-plan'],
      ['POST', '/v1/billing/subscriptions', 'rid-sub'],
      ['POST', '/v2/checkout/orders', 'rid-order'],
      ['POST', '/v2/checkout/orders/O1/authorize', 'rid-auth'],
      ['POST', '/v2/checkout/orders/O2/capture', 'rid-cap'],
    ]);
    expect(seen[1]!.body).toMatchObject({
      product_id: 'PROD-1',
      billing_cycles: [{ tenure_type: 'REGULAR', pricing_scheme: { fixed_price: usd('24.00') } }],
    });
    expect(seen[3]!.body).toMatchObject({
      intent: 'AUTHORIZE',
      purchase_units: [
        { reference_id: 'default', amount: usd('48.00'), custom_id: 'vigil-seed-a1' },
      ],
      payment_source: { paypal: { experience_context: { user_action: 'CONTINUE' } } },
    });
  });

  it('sends a card payment source for single-step orders', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'O9', status: 'COMPLETED' }, { status: 201 }));
    await setup.createOrder(
      h,
      {
        intent: 'AUTHORIZE',
        amount: usd('10.00'),
        custom_id: 'c',
        card: { number: '4111111111111111', expiry: '2030-12', name: 'Test Buyer' },
      },
      { requestId: 'r' },
    );
    expect(seen[0]!.body).toMatchObject({
      payment_source: { card: { number: '4111111111111111', expiry: '2030-12' } },
    });
  });
});

describe('PayPal-Mock-Response allowlist', () => {
  it('covers exactly Orders v2 and Payments v2 operations', () => {
    for (const op of MOCKABLE_OPERATIONS)
      expect(op).toMatch(/^(orders|authorizations|captures|refunds)\./);
    for (const op of [
      'subscriptions.capture',
      'subscriptions.suspend',
      'orders.track',
      'invoices.get',
      'disputes.list',
      'transactions.search',
      'authorizations.reauthorize',
    ]) {
      expect(isMockableOperation(op)).toBe(false);
      expect(() => mockResponseHeader(op, 'TRANSACTION_REFUSED')).toThrow(MockNotSupportedError);
    }
  });

  it('http refuses a mock header on a non-mockable operation, before any request', async () => {
    const h = await client();
    capture();
    await expect(
      h.request({
        method: 'POST',
        path: '/v1/billing/subscriptions/I-1/capture',
        operation: 'subscriptions.capture',
        mockResponseHeader: '{"mock_application_codes":"INTERNAL_SERVER_ERROR"}',
      }),
    ).rejects.toBeInstanceOf(MockNotSupportedError);
    expect(seen).toHaveLength(0);
  });

  it('attaches the header on mockable reads', async () => {
    const h = await client();
    capture(() => HttpResponse.json({ id: 'A' }));
    await reads.getAuthorization(h, 'A', { mock: 'AUTHORIZATION_VOIDED' });
    expect(seen[0]!.headers.get('paypal-mock-response')).toContain('AUTHORIZATION_VOIDED');
  });
});
