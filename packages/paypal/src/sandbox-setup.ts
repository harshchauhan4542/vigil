// Calls that CREATE demo data in the sandbox (catalog, plans, subscriptions, orders).
// Used only by the seeder (scripts/) and the reseed task (apps/workflows); lint forbids it
// everywhere else. All creates carry a PayPal-Request-Id.
import type { PayPalAmount } from '@vigil/core';
import type { PayPalHttp } from './http.js';
import { mockResponseHeader, type MockCode } from './mock-response.js';
import type { Order, Plan, Product, Subscription } from './types.js';

const enc = encodeURIComponent;

interface CreateOptions {
  requestId: string;
  mock?: MockCode;
}

function create<T>(
  http: PayPalHttp,
  operation: string,
  path: string,
  body: unknown,
  o: CreateOptions,
) {
  return http
    .request<T>({
      method: 'POST',
      path,
      operation,
      body,
      requestId: o.requestId,
      retries: 2,
      ...(o.mock ? { mockResponseHeader: mockResponseHeader(operation, o.mock) } : {}),
    })
    .then((r) => r.data);
}

export interface CreateProductInput {
  name: string;
  type: 'PHYSICAL' | 'DIGITAL' | 'SERVICE';
  description?: string;
}

/** POST /v1/catalogs/products */
export const createProduct = (http: PayPalHttp, input: CreateProductInput, o: CreateOptions) =>
  create<Product>(http, 'products.create', '/v1/catalogs/products', input, o);

export interface CreatePlanInput {
  product_id: string;
  name: string;
  price: PayPalAmount;
  interval: 'DAY' | 'WEEK' | 'MONTH';
}

/** POST /v1/billing/plans: one regular, infinite cycle; plans are created ACTIVE. */
export const createPlan = (http: PayPalHttp, input: CreatePlanInput, o: CreateOptions) =>
  create<Plan>(
    http,
    'plans.create',
    '/v1/billing/plans',
    {
      product_id: input.product_id,
      name: input.name,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: input.interval, interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: input.price },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: false,
        payment_failure_threshold: 3,
        setup_fee_failure_action: 'CONTINUE',
      },
    },
    o,
  );

export interface CreateSubscriptionInput {
  plan_id: string;
  custom_id: string;
  subscriber_email?: string;
  return_url: string;
  cancel_url: string;
}

/** POST /v1/billing/subscriptions → APPROVAL_PENDING until the buyer approves the link. */
export const createSubscription = (
  http: PayPalHttp,
  input: CreateSubscriptionInput,
  o: CreateOptions,
) =>
  create<Subscription>(
    http,
    'subscriptions.create',
    '/v1/billing/subscriptions',
    {
      plan_id: input.plan_id,
      custom_id: input.custom_id,
      ...(input.subscriber_email ? { subscriber: { email_address: input.subscriber_email } } : {}),
      application_context: {
        brand_name: 'Vigil Demo Store',
        user_action: 'SUBSCRIBE_NOW',
        return_url: input.return_url,
        cancel_url: input.cancel_url,
      },
    },
    o,
  );

export interface CardSource {
  number: string;
  expiry: string; // YYYY-MM
  name: string;
  security_code?: string;
}

export interface CreateOrderInput {
  intent: 'CAPTURE' | 'AUTHORIZE';
  amount: PayPalAmount;
  custom_id: string;
  invoice_id?: string;
  description?: string;
  /** Card payment source: the order needs no buyer redirect (single-step). */
  card?: CardSource;
  return_url?: string;
  cancel_url?: string;
}

/** POST /v2/checkout/orders */
export function createOrder(http: PayPalHttp, input: CreateOrderInput, o: CreateOptions) {
  const purchaseUnit = {
    reference_id: 'default',
    amount: input.amount,
    custom_id: input.custom_id,
    ...(input.invoice_id ? { invoice_id: input.invoice_id } : {}),
    ...(input.description ? { description: input.description } : {}),
  };
  const payment_source = input.card
    ? {
        card: {
          number: input.card.number,
          expiry: input.card.expiry,
          name: input.card.name,
          ...(input.card.security_code ? { security_code: input.card.security_code } : {}),
        },
      }
    : {
        paypal: {
          experience_context: {
            brand_name: 'Vigil Demo Store',
            user_action: input.intent === 'CAPTURE' ? 'PAY_NOW' : 'CONTINUE',
            ...(input.return_url ? { return_url: input.return_url } : {}),
            ...(input.cancel_url ? { cancel_url: input.cancel_url } : {}),
          },
        },
      };
  return create<Order>(
    http,
    'orders.create',
    '/v2/checkout/orders',
    { intent: input.intent, purchase_units: [purchaseUnit], payment_source },
    o,
  );
}

/** POST /v2/checkout/orders/{id}/authorize (order must be APPROVED). */
export const authorizeOrder = (http: PayPalHttp, orderId: string, o: CreateOptions) =>
  create<Order>(http, 'orders.authorize', `/v2/checkout/orders/${enc(orderId)}/authorize`, {}, o);

/** POST /v2/checkout/orders/{id}/capture (order must be APPROVED). */
export const captureOrder = (http: PayPalHttp, orderId: string, o: CreateOptions) =>
  create<Order>(http, 'orders.capture', `/v2/checkout/orders/${enc(orderId)}/capture`, {}, o);
