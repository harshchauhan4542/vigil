// Maps PayPal error bodies to typed errors and classifies them as retryable or final.
// REST errors: { name, message, debug_id, details: [{ issue, description, field }] }.
// OAuth errors use a different shape: { error, error_description }.

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
  value?: string;
  location?: string;
}

/** Domain meaning of the PayPal issue codes Vigil reacts to. */
export type PayPalErrorKind =
  | 'authorization_expired'
  | 'authorization_voided'
  | 'already_captured'
  | 'capture_amount_exceeded'
  | 'reauthorize_not_allowed'
  | 'refund_amount_exceeded'
  | 'transaction_disputed'
  | 'already_refunded'
  | 'refund_time_limit'
  | 'transaction_refused'
  | 'payer_action_required'
  | 'order_not_approved'
  | 'order_already_authorized'
  | 'order_expired'
  | 'action_does_not_match_intent'
  | 'capture_status_not_valid'
  | 'subscription_status_invalid'
  | 'validation'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'unknown';

/** Issue code → kind. Codes come from SPEC-ORD / SPEC-PAY / SPEC-SUB and the Orders errors page. */
export const ISSUE_KINDS: Readonly<Record<string, PayPalErrorKind>> = {
  AUTHORIZATION_EXPIRED: 'authorization_expired',
  AUTHORIZATION_VOIDED: 'authorization_voided',
  PREVIOUSLY_CAPTURED: 'already_captured',
  AUTHORIZATION_ALREADY_CAPTURED: 'already_captured',
  ORDER_ALREADY_CAPTURED: 'already_captured',
  MAX_CAPTURE_AMOUNT_EXCEEDED: 'capture_amount_exceeded',
  MAX_CAPTURE_COUNT_EXCEEDED: 'capture_amount_exceeded',
  REAUTHORIZATION_TOO_SOON: 'reauthorize_not_allowed',
  MAX_AUTHORIZATION_COUNT_EXCEEDED: 'reauthorize_not_allowed',
  REFUND_AMOUNT_EXCEEDED: 'refund_amount_exceeded',
  TRANSACTION_DISPUTED: 'transaction_disputed',
  CAPTURE_FULLY_REFUNDED: 'already_refunded',
  REFUND_TIME_LIMIT_EXCEEDED: 'refund_time_limit',
  TRANSACTION_REFUSED: 'transaction_refused',
  PAYMENT_DENIED: 'transaction_refused',
  INSTRUMENT_DECLINED: 'transaction_refused',
  PAYER_ACTION_REQUIRED: 'payer_action_required',
  ORDER_NOT_APPROVED: 'order_not_approved',
  ORDER_ALREADY_AUTHORIZED: 'order_already_authorized',
  ORDER_EXPIRED: 'order_expired',
  ACTION_DOES_NOT_MATCH_INTENT: 'action_does_not_match_intent',
  CAPTURE_STATUS_NOT_VALID: 'capture_status_not_valid',
  SUBSCRIPTION_STATUS_INVALID: 'subscription_status_invalid',
};

const STATUS_KINDS: Readonly<Record<number, PayPalErrorKind>> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation',
  429: 'rate_limited',
};

/** 429 and 5xx may be retried with the same PayPal-Request-Id; 4xx are final. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class PayPalError extends Error {
  override name = 'PayPalError';
  readonly retryable: boolean = false;
  readonly kind: PayPalErrorKind = 'unknown';
}

export class PayPalApiError extends PayPalError {
  override name = 'PayPalApiError';
  override readonly retryable: boolean;
  override readonly kind: PayPalErrorKind;
  readonly status: number;
  readonly paypalName: string | undefined;
  readonly debugId: string | undefined;
  readonly details: readonly PayPalErrorDetail[];
  readonly body: unknown;

  constructor(status: number, body: unknown, debugIdHeader?: string | null) {
    const b = (body && typeof body === 'object' ? body : {}) as {
      name?: string;
      message?: string;
      debug_id?: string;
      details?: PayPalErrorDetail[];
    };
    const details = Array.isArray(b.details) ? b.details : [];
    const issue = details[0]?.issue;
    super(
      `PayPal ${status}${b.name ? ` ${b.name}` : ''}${issue ? ` (${issue})` : ''}: ${b.message ?? 'request failed'}`,
    );
    this.status = status;
    this.paypalName = b.name;
    this.debugId = b.debug_id ?? debugIdHeader ?? undefined;
    this.details = details;
    this.body = body;
    this.retryable = isRetryableStatus(status);
    this.kind = classifyKind(status, details);
  }

  /** First issue code, e.g. "AUTHORIZATION_EXPIRED". */
  get issue(): string | undefined {
    return this.details[0]?.issue;
  }

  hasIssue(code: string): boolean {
    return this.details.some((d) => d.issue === code);
  }
}

export class PayPalAuthError extends PayPalError {
  override name = 'PayPalAuthError';
  override readonly kind: PayPalErrorKind = 'unauthorized';
  constructor(
    readonly status: number,
    readonly error: string | undefined,
    readonly errorDescription: string | undefined,
  ) {
    super(
      `PayPal OAuth ${status}: ${error ?? 'error'}${errorDescription ? ` (${errorDescription})` : ''}`,
    );
  }
}

/** Connection reset, DNS failure, timeout: the request may or may not have reached PayPal. */
export class PayPalNetworkError extends PayPalError {
  override name = 'PayPalNetworkError';
  override readonly retryable = true;
  override readonly kind: PayPalErrorKind = 'network';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

function classifyKind(status: number, details: readonly PayPalErrorDetail[]): PayPalErrorKind {
  for (const d of details) {
    const kind = d.issue ? ISSUE_KINDS[d.issue] : undefined;
    if (kind) return kind;
  }
  if (status >= 500) return 'server_error';
  return STATUS_KINDS[status] ?? 'unknown';
}

export function isRetryable(error: unknown): boolean {
  return error instanceof PayPalError && error.retryable;
}
