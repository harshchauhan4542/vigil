// Plain-language names for Vigil's internal codes, written for merchants who are not technical.
// The raw code stays available as a tooltip or under "Technical details".

export type Tone = 'ok' | 'info' | 'wait' | 'risk' | 'neutral';

export const PROBLEM: Record<string, string> = {
  FAILED_RENEWAL: 'A subscription payment failed',
  UNTRACKED_CAPTURE: 'Paid order has no tracking number',
  AUTH_HONOR_EXPIRING: 'Held payment about to expire',
  UNMATCHED_TXN: 'Payment missing from your records',
  DISPUTE_DEADLINE: 'Buyer dispute needs a reply soon',
};

export const ACTION: Record<string, string> = {
  capture_authorization: 'Collect the held payment',
  reauthorize: 'Hold the payment for longer',
  void_authorization: 'Release the held payment',
  refund: 'Refund the buyer',
  add_tracking: 'Add the tracking number',
  retry_outstanding_balance: 'Charge the renewal again',
  suspend_subscription: 'Pause the subscription',
  journal_entry: 'Add it to your records',
  send_invoice_reminder: 'Send an invoice reminder',
  dismiss: 'Ignore it, nothing to fix',
};

/** One or two sentences on what each fix does to the merchant's money. */
export const ACTION_EXPLAIN: Record<string, string> = {
  capture_authorization:
    'The buyer already approved this payment and PayPal is holding it for you. Collecting it now moves the money into your balance before the hold runs out.',
  reauthorize: "Asks PayPal to keep holding the buyer's money, so you can collect it later.",
  void_authorization: 'Lets go of the money PayPal is holding. The buyer is not charged.',
  refund: 'Sends money back to the buyer.',
  add_tracking:
    'Adds the shipping tracking number to the PayPal order. This protects you if the buyer later says the item never arrived.',
  retry_outstanding_balance: 'Tries again to charge the customer for the renewal that failed.',
  suspend_subscription: 'Pauses the subscription so the customer is not charged again for now.',
  journal_entry: 'Writes this payment into your own records. No money moves at PayPal.',
  send_invoice_reminder: 'Sends the customer a reminder about the unpaid invoice.',
  dismiss: 'Marks this as not a real problem. Nothing changes at PayPal.',
};

const EXCEPTION_STATUS: Record<string, [string, Tone]> = {
  OPEN: ['New', 'neutral'],
  TRIAGING: ['AI is looking into it', 'info'],
  PROPOSED: ['Fix suggested', 'neutral'],
  AWAITING_APPROVAL: ['Needs your OK', 'wait'],
  EXECUTING: ['Being fixed', 'info'],
  AWAITING_SETTLEMENT: ['Waiting for PayPal', 'info'],
  RESOLVED: ['Fixed', 'ok'],
  DISMISSED: ['Ignored', 'neutral'],
  ESCALATED: ['Needs your attention', 'risk'],
  FAILED: ['Fix failed', 'risk'],
};

const PROPOSAL_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Draft', 'neutral'],
  POLICY_REJECTED: ['Blocked by safety rules', 'risk'],
  PENDING_APPROVAL: ['Waiting for you', 'wait'],
  REJECTED: ['You said no', 'neutral'],
  EXPIRED: ['Expired', 'neutral'],
  APPROVED: ['Approved', 'info'],
  QUEUED: ['Sending to PayPal', 'info'],
  EXECUTING: ['Sending to PayPal', 'info'],
  SUCCEEDED: ['Done', 'ok'],
  FAILED_RETRYABLE: ['Trying again', 'wait'],
  FAILED_FINAL: ['PayPal said no', 'risk'],
  NEEDS_RECONCILE: ['Double-checking', 'wait'],
  SETTLED: ['Done and confirmed', 'ok'],
};

/** Risk tiers in plain words. */
export const TIER: Record<number, string> = {
  0: 'Only looks, changes nothing',
  1: 'No money moves',
  2: 'Moves money, within your limit',
  3: 'Large amount: you type it to confirm',
};

/** Plain-language names for the ten safety rules (policy engine R1–R10). */
export const RULE: Record<string, string> = {
  R1: 'This kind of fix is allowed for this problem',
  R2: 'The request is complete and correct',
  R3: 'The payment is still in the expected state',
  R4: 'The amount is not more than what is owed',
  R5: 'It stays within your spending limits',
  R6: 'No other fix is already running for this',
  R7: 'The AI only used real facts from your account',
  R8: 'There is no open dispute on this payment',
  R9: 'Money actions are switched on',
  R10: 'Risk level checked',
};

/** Who did something, in words. */
export const ACTOR: Record<string, string> = {
  detector: 'Vigil',
  system: 'Vigil',
  agent: 'the AI',
  human: 'you',
  policy: 'the safety rules',
  paypal: 'PayPal',
};

const titleCase = (code: string) =>
  code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');

export function exceptionStatus(code: string): [string, Tone] {
  return EXCEPTION_STATUS[code] ?? [titleCase(code), 'neutral'];
}
export function proposalStatus(code: string): [string, Tone] {
  return PROPOSAL_STATUS[code] ?? [titleCase(code), 'neutral'];
}
export const problemLabel = (type: string) => PROBLEM[type] ?? titleCase(type);
export const actionLabel = (type: string) => ACTION[type] ?? titleCase(type);

/** Why an approval did not go through, in words a merchant can act on. */
export const REFUSAL: Record<string, string> = {
  typed_amount_required:
    'This amount is above your limit. Type the exact amount in the box, then press Approve again.',
  not_pending: 'Someone already decided on this fix, maybe in another tab.',
  expired: 'This suggestion is too old. Check PayPal again to get a fresh one.',
  policy_failed:
    'The safety rules checked this fix again and it no longer passes, so nothing was sent.',
  mock_not_supported: 'Test failures only work when collecting, releasing or refunding a payment.',
  not_found: 'This suggestion no longer exists. Reload the page.',
};

export const money = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
