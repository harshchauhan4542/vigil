// Minimal shapes of the PayPal resources Vigil reads. Field names follow the official specs;
// only the fields Vigil uses are typed, the rest stays available through the index signature.
import type { PayPalAmount } from '@vigil/core';

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalResource {
  id: string;
  status: string;
  links?: Link[];
  [key: string]: unknown;
}

export interface Authorization extends PayPalResource {
  amount: PayPalAmount;
  invoice_id?: string;
  custom_id?: string;
  expiration_time?: string;
  create_time?: string;
  update_time?: string;
  status_details?: { reason?: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
}

export interface Capture extends PayPalResource {
  amount: PayPalAmount;
  final_capture?: boolean;
  invoice_id?: string;
  custom_id?: string;
  create_time?: string;
  seller_receivable_breakdown?: {
    gross_amount: PayPalAmount;
    paypal_fee?: PayPalAmount;
    net_amount?: PayPalAmount;
  };
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
}

export interface Refund extends PayPalResource {
  amount?: PayPalAmount;
  invoice_id?: string;
  custom_id?: string;
  note_to_payer?: string;
}

export interface PurchaseUnit {
  reference_id?: string;
  amount: PayPalAmount;
  custom_id?: string;
  invoice_id?: string;
  description?: string;
  shipping?: { trackers?: { id: string; status?: string }[] };
  payments?: {
    authorizations?: Authorization[];
    captures?: Capture[];
    refunds?: Refund[];
  };
}

export interface Order extends PayPalResource {
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: PurchaseUnit[];
  create_time?: string;
  payer?: { email_address?: string; payer_id?: string };
}

export interface Subscription extends PayPalResource {
  plan_id: string;
  custom_id?: string;
  start_time?: string;
  create_time?: string;
  billing_info?: {
    outstanding_balance?: PayPalAmount;
    failed_payments_count?: number;
    last_payment?: { amount: PayPalAmount; time: string };
    last_failed_payment?: {
      amount: PayPalAmount;
      time: string;
      reason_code?: string;
    };
    next_billing_time?: string;
  };
}

export interface SubscriptionTransaction {
  id: string;
  status: string;
  time: string;
  amount_with_breakdown: { gross_amount: PayPalAmount; fee_amount?: PayPalAmount };
}

export interface TransactionDetail {
  transaction_info: {
    transaction_id: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_status?: string;
    transaction_amount: PayPalAmount;
    fee_amount?: PayPalAmount;
    invoice_id?: string;
    custom_field?: string;
    paypal_reference_id?: string;
  };
  [key: string]: unknown;
}

export interface TransactionSearchPage {
  transaction_details: TransactionDetail[];
  page: number;
  total_pages: number;
  total_items?: number;
  start_date?: string;
  end_date?: string;
}

export interface Tracker {
  transaction_id: string;
  tracking_number?: string;
  status: string;
  carrier?: string;
}

export interface Invoice extends PayPalResource {
  detail?: { invoice_number?: string; currency_code?: string; note?: string; memo?: string };
  amount?: PayPalAmount;
  due_amount?: PayPalAmount;
}

export interface Dispute {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_amount?: PayPalAmount;
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string }[];
  [key: string]: unknown;
}

export interface Product extends PayPalResource {
  name: string;
  type: string;
}

export interface Plan extends PayPalResource {
  product_id: string;
  name: string;
}
