// PayPal-Mock-Response (negative testing) is honoured ONLY by Orders v2 and Payments v2.
// This typed allowlist makes it impossible to attach the header anywhere else, so Vigil never
// claims to mock Subscriptions, Tracking, Invoicing or Disputes failures.
// Source: developer.paypal.com/tools/sandbox/negative-testing/request-headers/

export const MOCKABLE_OPERATIONS = [
  'orders.create',
  'orders.update',
  'orders.get',
  'orders.authorize',
  'orders.capture',
  'authorizations.get',
  'authorizations.capture',
  'authorizations.void',
  'captures.get',
  'captures.refund',
  'refunds.get',
] as const;
export type MockableOperation = (typeof MOCKABLE_OPERATIONS)[number];

/** Error codes Vigil's demo triggers (issue names from SPEC-ORD / SPEC-PAY and the Orders errors page). */
export const MOCK_CODES = [
  'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_VOIDED',
  'MAX_CAPTURE_AMOUNT_EXCEEDED',
  'PREVIOUSLY_CAPTURED',
  'REFUND_AMOUNT_EXCEEDED',
  'TRANSACTION_DISPUTED',
  'TRANSACTION_REFUSED',
  'PAYER_ACTION_REQUIRED',
  'INSTRUMENT_DECLINED',
  'INTERNAL_SERVER_ERROR',
] as const;
export type MockCode = (typeof MOCK_CODES)[number];

const MOCKABLE = new Set<string>(MOCKABLE_OPERATIONS);
const CODES = new Set<string>(MOCK_CODES);

export function isMockableOperation(operation: string): operation is MockableOperation {
  return MOCKABLE.has(operation);
}

export class MockNotSupportedError extends Error {
  override name = 'MockNotSupportedError';
  constructor(operation: string) {
    super(
      `PayPal-Mock-Response is only supported on Orders v2 and Payments v2; "${operation}" is not mockable`,
    );
  }
}

/** Header value for a mock. Throws if the operation or code is outside the allowlist. */
export function mockResponseHeader(operation: string, code: MockCode): string {
  if (!isMockableOperation(operation)) throw new MockNotSupportedError(operation);
  if (!CODES.has(code)) throw new Error(`Unknown mock code: ${code}`);
  return JSON.stringify({ mock_application_codes: code });
}
