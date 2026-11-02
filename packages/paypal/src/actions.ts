// THE ONLY MODULE THAT MOVES MONEY (or changes PayPal state for an exception fix).
// Importable only from apps/workflows (ESLint trust-boundary rule + the "./actions" subpath).
// Every call that PayPal lets us make idempotent REQUIRES a PayPal-Request-Id; the caller must
// have persisted it (idempotency_keys) before calling.
import type { ActionParams } from '@vigil/core';
import type { PayPalHttp, PayPalResponse } from './http.js';
import { mockResponseHeader, type MockCode } from './mock-response.js';
import type { Authorization, Capture, Order, Refund } from './types.js';

const enc = encodeURIComponent;

export interface MutationOptions {
  /** Persisted PayPal-Request-Id; reused unchanged on every retry. */
  requestId: string;
  /** Retries for 429/5xx/network with the same request id. Default 0 (the workflow retries). */
  retries?: number;
}

export interface MockableMutationOptions extends MutationOptions {
  /** Negative test (Orders v2 / Payments v2 only). */
  mock?: MockCode;
}

function mutate<T>(
  http: PayPalHttp,
  operation: string,
  path: string,
  body: unknown,
  options: Partial<MockableMutationOptions>,
): Promise<PayPalResponse<T>> {
  return http.request<T>({
    method: 'POST',
    path,
    operation,
    body,
    retries: options.retries ?? 0,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.mock ? { mockResponseHeader: mockResponseHeader(operation, options.mock) } : {}),
  });
}

/** POST /v2/payments/authorizations/{id}/capture */
export function captureAuthorization(
  http: PayPalHttp,
  params: ActionParams['capture_authorization'],
  options: MockableMutationOptions,
) {
  const { authorization_id, ...body } = params;
  return mutate<Capture>(
    http,
    'authorizations.capture',
    `/v2/payments/authorizations/${enc(authorization_id)}/capture`,
    body,
    options,
  );
}

/** POST /v2/payments/authorizations/{id}/reauthorize. Returns a NEW authorization id. */
export function reauthorizeAuthorization(
  http: PayPalHttp,
  params: ActionParams['reauthorize'],
  options: MutationOptions,
) {
  return mutate<Authorization>(
    http,
    'authorizations.reauthorize',
    `/v2/payments/authorizations/${enc(params.authorization_id)}/reauthorize`,
    { amount: params.amount },
    options,
  );
}

/** POST /v2/payments/authorizations/{id}/void (irreversible). */
export function voidAuthorization(
  http: PayPalHttp,
  params: ActionParams['void_authorization'],
  options: MockableMutationOptions,
) {
  return mutate<Authorization | undefined>(
    http,
    'authorizations.void',
    `/v2/payments/authorizations/${enc(params.authorization_id)}/void`,
    undefined,
    options,
  );
}

/** POST /v2/payments/captures/{id}/refund. No amount = full refund. */
export function refundCapture(
  http: PayPalHttp,
  params: ActionParams['refund'],
  options: MockableMutationOptions,
) {
  const { capture_id, ...body } = params;
  return mutate<Refund>(
    http,
    'captures.refund',
    `/v2/payments/captures/${enc(capture_id)}/refund`,
    body,
    options,
  );
}

/**
 * POST /v2/checkout/orders/{id}/track. PayPal declares no PayPal-Request-Id here, so the caller
 * relies on the idempotency_keys row plus a check-before-act GET.
 */
export function addTracking(
  http: PayPalHttp,
  params: ActionParams['add_tracking'],
  options: { retries?: number } = {},
) {
  const { order_id, ...body } = params;
  return mutate<Order>(
    http,
    'orders.track',
    `/v2/checkout/orders/${enc(order_id)}/track`,
    body,
    options,
  );
}

/** POST /v1/billing/subscriptions/{id}/capture with capture_type OUTSTANDING_BALANCE. */
export function captureSubscriptionBalance(
  http: PayPalHttp,
  params: ActionParams['retry_outstanding_balance'],
  options: MutationOptions,
) {
  return mutate<Record<string, unknown> | undefined>(
    http,
    'subscriptions.capture',
    `/v1/billing/subscriptions/${enc(params.subscription_id)}/capture`,
    { note: params.note, capture_type: 'OUTSTANDING_BALANCE', amount: params.amount },
    options,
  );
}

/** POST /v1/billing/subscriptions/{id}/suspend (204 No Content). No PayPal-Request-Id. */
export function suspendSubscription(
  http: PayPalHttp,
  params: ActionParams['suspend_subscription'],
  options: { retries?: number } = {},
) {
  return mutate<undefined>(
    http,
    'subscriptions.suspend',
    `/v1/billing/subscriptions/${enc(params.subscription_id)}/suspend`,
    { reason: params.reason },
    options,
  );
}
