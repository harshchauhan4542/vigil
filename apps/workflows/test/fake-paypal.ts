// Stateful fake of the PayPal endpoints Vigil reads and acts on. Honours PayPal-Request-Id
// (same id → same stored result, no second effect) and can inject failures.
import { http, HttpResponse } from 'msw';

export const BASE = 'https://api-m.sandbox.paypal.com';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const money = (cents: number, currency = 'USD') => ({
  currency_code: currency,
  value: (cents / 100).toFixed(2),
});
const cents = (v: string) => Math.round(Number(v) * 100);

export class FakePayPal {
  authorizations = new Map<string, Json>();
  captures = new Map<string, Json>();
  orders = new Map<string, Json>();
  transactions: Json[] = [];
  /** Every state-changing effect actually applied (after idempotency). */
  effects: { op: string; id: string; requestId: string | null }[] = [];
  /** Calls received per operation, including replays. */
  calls: Record<string, number> = {};
  private byRequestId = new Map<string, { status: number; body: Json | null }>();
  private failures: {
    op: string;
    status: number;
    issue?: string;
    times: number;
    afterEffect?: boolean;
  }[] = [];
  private seq = 100;

  addAuthorization(id: string, amountCents: number, createTime: string, over: Json = {}) {
    this.authorizations.set(id, {
      id,
      status: 'CREATED',
      amount: money(amountCents),
      create_time: createTime,
      expiration_time: new Date(Date.parse(createTime) + 29 * 86_400_000).toISOString(),
      supplementary_data: { related_ids: { order_id: `ORDER-${id}` } },
      ...over,
    });
  }

  addCapture(id: string, amountCents: number, over: Json = {}) {
    this.captures.set(id, {
      id,
      status: 'COMPLETED',
      amount: money(amountCents),
      refunded_cents: 0,
      ...over,
    });
  }

  addTransaction(id: string, amountCents: number, date: string, over: Json = {}) {
    this.transactions.push({
      transaction_info: {
        transaction_id: id,
        transaction_event_code: 'T0006',
        transaction_initiation_date: date,
        transaction_status: 'S',
        transaction_amount: money(amountCents),
        ...over,
      },
    });
  }

  /**
   * Fail the next `times` calls of `op`. With `afterEffect`, the effect is applied but the
   * response is lost (a timeout after PayPal committed) — the hardest retry case.
   */
  fail(
    op: string,
    status: number,
    times = 1,
    opts: { issue?: string; afterEffect?: boolean } = {},
  ) {
    this.failures.push({ op, status, times, ...opts });
  }

  private takeFailure(op: string) {
    const f = this.failures.find((x) => x.op === op && x.times > 0);
    if (f) f.times--;
    return f;
  }

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  /** Run a mutation once per PayPal-Request-Id. */
  private mutate(request: Request, op: string, apply: () => { status: number; body: Json | null }) {
    this.calls[op] = (this.calls[op] ?? 0) + 1;
    const rid = request.headers.get('paypal-request-id');
    const failure = this.takeFailure(op);
    if (failure && !failure.afterEffect) return this.error(failure.status, failure.issue);
    let result = rid ? this.byRequestId.get(rid) : undefined;
    if (!result) {
      result = apply();
      if (result.status < 300)
        this.effects.push({ op, id: String(result.body?.id ?? ''), requestId: rid });
      if (rid) this.byRequestId.set(rid, result);
    }
    if (failure?.afterEffect) return this.error(failure.status, failure.issue);
    return result.body
      ? HttpResponse.json(result.body, { status: result.status })
      : new HttpResponse(null, { status: result.status });
  }

  private error(status: number, issue?: string) {
    return HttpResponse.json(
      {
        name: status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'UNPROCESSABLE_ENTITY',
        debug_id: `dbg-${status}`,
        details: issue ? [{ issue }] : [],
      },
      { status },
    );
  }

  private unprocessable(issue: string) {
    return {
      status: 422,
      body: { name: 'UNPROCESSABLE_ENTITY', debug_id: 'dbg-422', details: [{ issue }] },
    };
  }

  handlers() {
    const notFound = () => HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    return [
      http.post(`${BASE}/v1/oauth2/token`, () =>
        HttpResponse.json({ access_token: 'T', token_type: 'Bearer', expires_in: 32400 }),
      ),
      http.get(`${BASE}/v2/payments/authorizations/:id`, ({ params }) => {
        const a = this.authorizations.get(String(params.id));
        return a ? HttpResponse.json(a) : notFound();
      }),
      http.get(`${BASE}/v2/payments/captures/:id`, ({ params }) => {
        const c = this.captures.get(String(params.id));
        if (!c) return notFound();
        const { refunded_cents: _r, ...rest } = c;
        return HttpResponse.json(rest);
      }),
      http.get(`${BASE}/v1/reporting/transactions`, ({ request }) => {
        const u = new URL(request.url);
        const s = Date.parse(u.searchParams.get('start_date')!);
        const e = Date.parse(u.searchParams.get('end_date')!);
        const rows = this.transactions.filter((t) => {
          const d = Date.parse(t.transaction_info.transaction_initiation_date);
          return d >= s && d < e;
        });
        return HttpResponse.json({ transaction_details: rows, page: 1, total_pages: 1 });
      }),
      http.post(`${BASE}/v2/payments/authorizations/:id/capture`, async ({ request, params }) => {
        const body = (await request.json()) as Json;
        return this.mutate(request, 'authorizations.capture', () => {
          const a = this.authorizations.get(String(params.id));
          if (!a) return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
          if (a.status === 'CAPTURED') return this.unprocessable('AUTHORIZATION_ALREADY_CAPTURED');
          if (a.status === 'VOIDED') return this.unprocessable('AUTHORIZATION_VOIDED');
          const amount = body.amount ?? a.amount;
          const captured = (a.captured_cents ?? 0) + cents(amount.value);
          if (captured > cents(a.amount.value))
            return this.unprocessable('MAX_CAPTURE_AMOUNT_EXCEEDED');
          a.captured_cents = captured;
          a.status =
            body.final_capture || captured === cents(a.amount.value)
              ? 'CAPTURED'
              : 'PARTIALLY_CAPTURED';
          const id = this.nextId('CAP');
          const cap = {
            id,
            status: 'COMPLETED',
            amount,
            final_capture: !!body.final_capture,
            supplementary_data: { related_ids: { authorization_id: a.id } },
          };
          this.captures.set(id, { ...cap, refunded_cents: 0 });
          return { status: 201, body: cap };
        });
      }),
      http.post(`${BASE}/v2/payments/authorizations/:id/void`, ({ request, params }) =>
        this.mutate(request, 'authorizations.void', () => {
          const a = this.authorizations.get(String(params.id));
          if (!a) return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
          if (a.status !== 'CREATED' && a.status !== 'PARTIALLY_CAPTURED')
            return this.unprocessable('PREVIOUSLY_CAPTURED');
          a.status = 'VOIDED';
          return { status: 204, body: null };
        }),
      ),
      http.post(
        `${BASE}/v2/payments/authorizations/:id/reauthorize`,
        async ({ request, params }) => {
          const body = (await request.json()) as Json;
          return this.mutate(request, 'authorizations.reauthorize', () => {
            const a = this.authorizations.get(String(params.id));
            if (!a) return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
            const id = this.nextId('AUTH');
            const next = {
              ...a,
              id,
              status: 'CREATED',
              amount: body.amount,
              create_time: new Date().toISOString(),
            };
            this.authorizations.set(id, next);
            return { status: 201, body: next };
          });
        },
      ),
      http.post(`${BASE}/v2/payments/captures/:id/refund`, async ({ request, params }) => {
        const body = (await request.json()) as Json;
        return this.mutate(request, 'captures.refund', () => {
          const c = this.captures.get(String(params.id));
          if (!c) return { status: 404, body: { name: 'RESOURCE_NOT_FOUND' } };
          if (c.disputed) return this.unprocessable('TRANSACTION_DISPUTED');
          const amt = body.amount
            ? cents(body.amount.value)
            : cents(c.amount.value) - c.refunded_cents;
          if (c.refunded_cents + amt > cents(c.amount.value))
            return this.unprocessable('REFUND_AMOUNT_EXCEEDED');
          c.refunded_cents += amt;
          c.status = c.refunded_cents === cents(c.amount.value) ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          return {
            status: 201,
            body: { id: this.nextId('REF'), status: 'COMPLETED', amount: money(amt) },
          };
        });
      }),
    ];
  }
}
