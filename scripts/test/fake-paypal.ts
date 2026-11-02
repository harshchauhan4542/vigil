// A small stateful fake of the PayPal sandbox endpoints the seeder uses, honouring
// PayPal-Request-Id idempotency like the real API.
import { http, HttpResponse } from 'msw';

export const BASE = 'https://api-m.sandbox.paypal.com';

type Json = Record<string, unknown>;

export class FakePayPal {
  orders = new Map<string, Json>();
  authorizations = new Map<string, Json>();
  captures = new Map<string, Json>();
  subscriptions = new Map<string, Json>();
  creates: string[] = [];
  trackers: { orderId: string; body: Json }[] = [];
  private byRequestId = new Map<string, Json>();
  private seq = 0;

  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  /** Simulate the buyer approving an order in the browser. */
  approve(orderId: string) {
    const o = this.orders.get(orderId)!;
    o.status = 'APPROVED';
  }

  private idempotent(request: Request, make: () => Json): Json {
    const rid = request.headers.get('paypal-request-id');
    if (rid && this.byRequestId.has(rid)) return this.byRequestId.get(rid)!;
    const out = make();
    if (rid) this.byRequestId.set(rid, out);
    return out;
  }

  private newAuthorization(amount: Json) {
    const id = this.id('AUTH');
    const a = { id, status: 'CREATED', amount, create_time: '2026-11-02T10:00:00Z' };
    this.authorizations.set(id, a);
    return a;
  }

  private newCapture(amount: Json) {
    const id = this.id('CAP');
    const cents = Math.round(Number(amount.value) * 100);
    const fee = (Math.floor(cents * 0.0349) + 49) / 100;
    const c = {
      id,
      status: 'COMPLETED',
      amount,
      create_time: '2026-11-02T10:00:00Z',
      seller_receivable_breakdown: {
        gross_amount: amount,
        paypal_fee: { currency_code: 'USD', value: fee.toFixed(2) },
      },
    };
    this.captures.set(id, c);
    return c;
  }

  private complete(order: Json) {
    const pu = (order.purchase_units as Json[])[0]!;
    const amount = pu.amount as Json;
    pu.payments =
      order.intent === 'AUTHORIZE'
        ? { authorizations: [this.newAuthorization(amount)] }
        : { captures: [this.newCapture(amount)] };
    order.status = 'COMPLETED';
    return order;
  }

  handlers() {
    const notFound = () => HttpResponse.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    const getFrom =
      (m: Map<string, Json>) =>
      ({ params }: { params: Record<string, string | readonly string[] | undefined> }) => {
        const v = m.get(String(params.id));
        return v ? HttpResponse.json(v) : notFound();
      };
    return [
      http.post(`${BASE}/v1/oauth2/token`, () =>
        HttpResponse.json({ access_token: 'T', token_type: 'Bearer', expires_in: 32400 }),
      ),
      http.post(`${BASE}/v1/catalogs/products`, async ({ request }) => {
        const body = (await request.json()) as Json;
        return HttpResponse.json(
          this.idempotent(request, () => {
            this.creates.push('product');
            return { id: this.id('PROD'), ...body };
          }),
          { status: 201 },
        );
      }),
      http.post(`${BASE}/v1/billing/plans`, async ({ request }) => {
        const body = (await request.json()) as Json;
        return HttpResponse.json(
          this.idempotent(request, () => {
            this.creates.push('plan');
            return {
              id: this.id('P'),
              status: 'ACTIVE',
              product_id: body.product_id,
              name: body.name,
            };
          }),
          { status: 201 },
        );
      }),
      http.post(`${BASE}/v1/billing/subscriptions`, async ({ request }) => {
        const body = (await request.json()) as Json;
        return HttpResponse.json(
          this.idempotent(request, () => {
            this.creates.push('subscription');
            const id = this.id('I');
            const s = {
              id,
              status: 'APPROVAL_PENDING',
              plan_id: body.plan_id,
              custom_id: body.custom_id,
              links: [
                {
                  rel: 'approve',
                  href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}`,
                },
              ],
            };
            this.subscriptions.set(id, s);
            return s;
          }),
          { status: 201 },
        );
      }),
      http.get(`${BASE}/v1/billing/subscriptions/:id`, getFrom(this.subscriptions)),
      http.post(`${BASE}/v2/checkout/orders`, async ({ request }) => {
        const body = (await request.json()) as Json;
        const order = this.idempotent(request, () => {
          this.creates.push('order');
          const id = this.id('O');
          const o: Json = {
            id,
            intent: body.intent,
            status: 'PAYER_ACTION_REQUIRED',
            purchase_units: structuredClone(body.purchase_units),
            links: [
              {
                rel: 'payer-action',
                href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
              },
            ],
          };
          this.orders.set(id, o);
          // Card source: single-step, the payment completes immediately.
          if ((body.payment_source as Json).card) this.complete(o);
          return o;
        });
        return HttpResponse.json(order, { status: 201 });
      }),
      http.get(`${BASE}/v2/checkout/orders/:id`, getFrom(this.orders)),
      ...(['authorize', 'capture'] as const).map((verb) =>
        http.post(`${BASE}/v2/checkout/orders/:id/${verb}`, ({ request, params }) => {
          const order = this.orders.get(String(params.id));
          if (!order) return notFound();
          if (order.status !== 'APPROVED') {
            return HttpResponse.json(
              { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] },
              { status: 422 },
            );
          }
          return HttpResponse.json(
            this.idempotent(request, () => this.complete(order)),
            { status: 201 },
          );
        }),
      ),
      http.post(`${BASE}/v2/checkout/orders/:id/track`, async ({ request, params }) => {
        this.trackers.push({ orderId: String(params.id), body: (await request.json()) as Json });
        return HttpResponse.json(this.orders.get(String(params.id)), { status: 201 });
      }),
      http.get(`${BASE}/v2/payments/authorizations/:id`, getFrom(this.authorizations)),
      http.get(`${BASE}/v2/payments/captures/:id`, getFrom(this.captures)),
    ];
  }
}
