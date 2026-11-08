// Read-only PayPal facade. Used by policy (fresh state, via its caller), detectors' sync step
// and the agent's read tools. Nothing in this file changes PayPal state.
import type { PayPalHttp } from './http.js';
import { mockResponseHeader, type MockCode } from './mock-response.js';
import type {
  Authorization,
  Capture,
  Dispute,
  Invoice,
  Order,
  Refund,
  Subscription,
  SubscriptionTransaction,
  Tracker,
  TransactionDetail,
  TransactionSearchPage,
} from './types.js';

const enc = encodeURIComponent;

/** Transaction Search accepts at most 31 days per query. */
export const MAX_SEARCH_WINDOW_MS = 31 * 24 * 3_600_000;
export const SEARCH_PAGE_SIZE = 500;

export interface ReadOptions {
  /** Negative test on Orders v2 / Payments v2 GETs only (see mock-response.ts). */
  mock?: MockCode;
}

function readRequest<T>(
  http: PayPalHttp,
  path: string,
  operation: string,
  options: ReadOptions = {},
  query?: Record<string, string | number | undefined>,
) {
  return http
    .request<T>({
      method: 'GET',
      path,
      operation,
      retries: 2,
      ...(query ? { query } : {}),
      ...(options.mock ? { mockResponseHeader: mockResponseHeader(operation, options.mock) } : {}),
    })
    .then((r) => r.data);
}

export const getOrder = (http: PayPalHttp, id: string, o?: ReadOptions) =>
  readRequest<Order>(http, `/v2/checkout/orders/${enc(id)}`, 'orders.get', o);

export const getAuthorization = (http: PayPalHttp, id: string, o?: ReadOptions) =>
  readRequest<Authorization>(
    http,
    `/v2/payments/authorizations/${enc(id)}`,
    'authorizations.get',
    o,
  );

export const getCapture = (http: PayPalHttp, id: string, o?: ReadOptions) =>
  readRequest<Capture>(http, `/v2/payments/captures/${enc(id)}`, 'captures.get', o);

export const getRefund = (http: PayPalHttp, id: string, o?: ReadOptions) =>
  readRequest<Refund>(http, `/v2/payments/refunds/${enc(id)}`, 'refunds.get', o);

export const getSubscription = (http: PayPalHttp, id: string) =>
  readRequest<Subscription>(http, `/v1/billing/subscriptions/${enc(id)}`, 'subscriptions.get');

export async function listSubscriptionTransactions(
  http: PayPalHttp,
  id: string,
  startTime: Date,
  endTime: Date,
): Promise<SubscriptionTransaction[]> {
  const data = await readRequest<{ transactions?: SubscriptionTransaction[] }>(
    http,
    `/v1/billing/subscriptions/${enc(id)}/transactions`,
    'subscriptions.transactions',
    {},
    { start_time: startTime.toISOString(), end_time: endTime.toISOString() },
  );
  return data.transactions ?? [];
}

/** Split [start, end) into windows of at most 31 days. */
export function searchWindows(start: Date, end: Date): { start: Date; end: Date }[] {
  if (end <= start) return [];
  const windows: { start: Date; end: Date }[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += MAX_SEARCH_WINDOW_MS) {
    windows.push({
      start: new Date(t),
      end: new Date(Math.min(t + MAX_SEARCH_WINDOW_MS, end.getTime())),
    });
  }
  return windows;
}

/** Transaction Search over any range: 31-day windows, every page. Data lags by up to 3 h. */
export async function* searchTransactions(
  http: PayPalHttp,
  start: Date,
  end: Date,
  filters: { transaction_id?: string; transaction_status?: string } = {},
): AsyncGenerator<TransactionDetail> {
  for (const window of searchWindows(start, end)) {
    for (let page = 1, totalPages = 1; page <= totalPages; page++) {
      const data = await readRequest<TransactionSearchPage>(
        http,
        '/v1/reporting/transactions',
        'transactions.search',
        {},
        {
          start_date: window.start.toISOString(),
          end_date: window.end.toISOString(),
          fields: 'all',
          page_size: SEARCH_PAGE_SIZE,
          page,
          ...filters,
        },
      );
      totalPages = data.total_pages ?? 1;
      yield* data.transaction_details ?? [];
    }
  }
}

export async function listTrackers(http: PayPalHttp, transactionId: string): Promise<Tracker[]> {
  const data = await readRequest<{ trackers?: Tracker[] }>(
    http,
    '/v1/shipping/trackers',
    'trackers.list',
    {},
    { transaction_id: transactionId },
  );
  return data.trackers ?? [];
}

export async function listInvoices(http: PayPalHttp, page = 1, pageSize = 50): Promise<Invoice[]> {
  const data = await readRequest<{ items?: Invoice[] }>(
    http,
    '/v2/invoicing/invoices',
    'invoices.list',
    {},
    { page, page_size: pageSize, total_required: 'true' },
  );
  return data.items ?? [];
}

export const getInvoice = (http: PayPalHttp, id: string) =>
  readRequest<Invoice>(http, `/v2/invoicing/invoices/${enc(id)}`, 'invoices.get');

export async function listDisputes(
  http: PayPalHttp,
  filters: { start_time?: string; disputed_transaction_id?: string; dispute_state?: string } = {},
): Promise<Dispute[]> {
  const data = await readRequest<{ items?: Dispute[] }>(
    http,
    '/v1/customer/disputes',
    'disputes.list',
    {},
    filters,
  );
  return data.items ?? [];
}

export const getDispute = (http: PayPalHttp, id: string) =>
  readRequest<Dispute>(http, `/v1/customer/disputes/${enc(id)}`, 'disputes.get');
