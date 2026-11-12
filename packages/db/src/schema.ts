// Drizzle schema for every Vigil table (HACKATHON_ARCHITECTURE_PLAN.md, "Database schema").
// Deviation from the plan's SQL sketch: money columns are BIGINT integer cents (`*_cents`),
// never numeric/float, per the "money is integer cents" rule.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const cents = (name: string) => bigint(name, { mode: 'number' });
const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const currency = (name = 'currency') => char(name, { length: 3 });

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

// ---------------------------------------------------------------- PayPal mirror

export const ppOrders = pgTable('pp_orders', {
  id: text('id').primaryKey(),
  intent: text('intent').notNull(),
  status: text('status').notNull(),
  amountCents: cents('amount_cents').notNull(),
  currency: currency().notNull(),
  customId: text('custom_id'),
  invoiceId: text('invoice_id'),
  isPhysical: boolean('is_physical').notNull().default(true),
  createdAt: tsz('created_at'),
  raw: jsonb('raw'),
  syncedAt: tsz('synced_at').notNull().defaultNow(),
});

export const ppAuthorizations = pgTable(
  'pp_authorizations',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id'),
    status: text('status').notNull(),
    amountCents: cents('amount_cents').notNull(),
    currency: currency().notNull(),
    capturedTotalCents: cents('captured_total_cents').notNull().default(0),
    createdAt: tsz('created_at'),
    expirationTime: tsz('expiration_time'),
    raw: jsonb('raw'),
    syncedAt: tsz('synced_at').notNull().defaultNow(),
  },
  (t) => [index('pp_authorizations_status_idx').on(t.status)],
);

export const ppCaptures = pgTable(
  'pp_captures',
  {
    id: text('id').primaryKey(),
    authorizationId: text('authorization_id'),
    orderId: text('order_id'),
    status: text('status').notNull(),
    amountCents: cents('amount_cents').notNull(),
    currency: currency().notNull(),
    refundedTotalCents: cents('refunded_total_cents').notNull().default(0),
    hasTracker: boolean('has_tracker').notNull().default(false),
    createdAt: tsz('created_at'),
    raw: jsonb('raw'),
    syncedAt: tsz('synced_at').notNull().defaultNow(),
  },
  (t) => [index('pp_captures_order_idx').on(t.orderId)],
);

export const ppSubscriptions = pgTable('pp_subscriptions', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  status: text('status').notNull(),
  outstandingBalanceCents: cents('outstanding_balance_cents').notNull().default(0),
  currency: currency().notNull(),
  lastFailedReason: text('last_failed_reason'),
  lastFailedAt: tsz('last_failed_at'),
  raw: jsonb('raw'),
  syncedAt: tsz('synced_at').notNull().defaultNow(),
});

export const ppTransactions = pgTable(
  'pp_transactions',
  {
    transactionId: text('transaction_id').primaryKey(),
    eventCode: text('event_code'),
    status: char('status', { length: 1 }),
    amountCents: cents('amount_cents').notNull(),
    currency: currency().notNull(),
    feeCents: cents('fee_cents'),
    invoiceId: text('invoice_id'),
    customId: text('custom_id'),
    initiationDate: tsz('initiation_date'),
    raw: jsonb('raw'),
  },
  (t) => [index('pp_transactions_initiation_idx').on(t.initiationDate)],
);

/** The merchant's own books (seeded), matched against Transaction Search by E4. */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull(),
    externalRef: text('external_ref'),
    amountCents: cents('amount_cents').notNull(),
    currency: currency().notNull(),
    bookedOn: date('booked_on', { mode: 'string' }).notNull(),
    memo: text('memo'),
    matchedTxnId: text('matched_txn_id'),
  },
  (t) => [index('ledger_entries_external_ref_idx').on(t.externalRef)],
);

// ---------------------------------------------------------------- Workflow

export const exceptions = pgTable(
  'exceptions',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    targetRef: text('target_ref').notNull(),
    amountAtRiskCents: cents('amount_at_risk_cents'),
    currency: currency(),
    severity: smallint('severity').notNull().default(1),
    /** Money at risk × urgency at detection time (queue order). */
    score: bigint('score', { mode: 'number' }).notNull().default(0),
    deadlineAt: tsz('deadline_at'),
    status: text('status').notNull(),
    detectorVersion: text('detector_version').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    detectedAt: tsz('detected_at').notNull().defaultNow(),
    resolvedAt: tsz('resolved_at'),
  },
  (t) => [
    unique('exceptions_type_target_uq').on(t.type, t.targetRef),
    index('exceptions_status_idx').on(t.status),
    index('exceptions_score_idx').on(t.score),
  ],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    exceptionId: uuid('exception_id').references(() => exceptions.id),
    model: text('model').notNull(),
    mode: text('mode').notNull(),
    promptHash: char('prompt_hash', { length: 64 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    turns: integer('turns'),
    trace: jsonb('trace'),
    startedAt: tsz('started_at').notNull().defaultNow(),
    finishedAt: tsz('finished_at'),
  },
  (t) => [check('agent_runs_mode_ck', sql`${t.mode} in ('live', 'replay')`)],
);

export const OPEN_PROPOSAL_STATUSES_SQL = sql.raw(
  `('DRAFT','PENDING_APPROVAL','APPROVED','QUEUED','EXECUTING','FAILED_RETRYABLE','NEEDS_RECONCILE')`,
);

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey(),
    exceptionId: uuid('exception_id')
      .notNull()
      .references(() => exceptions.id),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
    actionType: text('action_type').notNull(),
    targetRef: text('target_ref').notNull(),
    params: jsonb('params').notNull(),
    paramsHash: char('params_hash', { length: 64 }).notNull(),
    rationale: text('rationale').notNull(),
    evidenceRefs: text('evidence_refs').array().notNull(),
    confidence: real('confidence').notNull(),
    policyVersion: text('policy_version'),
    policyResult: jsonb('policy_result'),
    riskTier: smallint('risk_tier'),
    amountCents: cents('amount_cents'),
    currency: currency(),
    status: text('status').notNull(),
    createdAt: tsz('created_at').notNull().defaultNow(),
    expiresAt: tsz('expires_at'),
  },
  (t) => [
    // R6: at most one open proposal per target.
    uniqueIndex('proposals_one_open_per_target')
      .on(t.targetRef)
      .where(sql`${t.status} in ${OPEN_PROPOSAL_STATUSES_SQL}`),
    index('proposals_exception_idx').on(t.exceptionId),
    check('proposals_rationale_len_ck', sql`char_length(${t.rationale}) <= 600`),
    check('proposals_confidence_ck', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .unique('approvals_proposal_uq')
      .references(() => proposals.id),
    decision: text('decision').notNull(),
    approver: text('approver').notNull(),
    typedConfirmation: text('typed_confirmation'),
    paramsHash: char('params_hash', { length: 64 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }),
    tokenUsedAt: tsz('token_used_at'),
    decidedAt: tsz('decided_at').notNull().defaultNow(),
    reason: text('reason'),
  },
  (t) => [check('approvals_decision_ck', sql`${t.decision} in ('APPROVED', 'REJECTED')`)],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    attempt: integer('attempt').notNull(),
    paypalRequestId: varchar('paypal_request_id', { length: 38 }),
    operation: text('operation').notNull(),
    endpoint: text('endpoint').notNull(),
    mockCode: text('mock_code'),
    httpStatus: integer('http_status'),
    paypalStatus: text('paypal_status'),
    debugId: text('debug_id'),
    response: jsonb('response'),
    renderTaskRunId: text('render_task_run_id'),
    startedAt: tsz('started_at').notNull().defaultNow(),
    finishedAt: tsz('finished_at'),
  },
  (t) => [unique('executions_proposal_attempt_uq').on(t.proposalId, t.attempt)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    operation: text('operation').notNull(),
    businessKey: text('business_key').notNull(),
    paypalRequestId: varchar('paypal_request_id', { length: 38 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    retentionUntil: tsz('retention_until'),
    resultRef: uuid('result_ref'),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.operation, t.businessKey] })],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    eventType: text('event_type').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    transmissionId: text('transmission_id'),
    transmissionTime: tsz('transmission_time'),
    verificationMethod: text('verification_method'),
    verificationStatus: text('verification_status'),
    simulated: boolean('simulated').notNull().default(false),
    headers: jsonb('headers'),
    rawBody: bytea('raw_body').notNull(),
    receivedAt: tsz('received_at').notNull().defaultNow(),
    processedAt: tsz('processed_at'),
    processingStatus: text('processing_status').notNull(),
    error: text('error'),
  },
  (t) => [index('webhook_events_resource_idx').on(t.resourceId)],
);

/** Append-only (trigger in migration 0001) and hash-chained (see audit.ts). */
export const auditLog = pgTable('audit_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  ts: tsz('ts').notNull().defaultNow(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload').notNull().default({}),
  prevHash: char('prev_hash', { length: 64 }).notNull(),
  hash: char('hash', { length: 64 }).notNull().unique('audit_log_hash_uq'),
});

export const policies = pgTable('policies', {
  version: text('version').primaryKey(),
  rules: jsonb('rules').notNull(),
  active: boolean('active').notNull().default(false),
  createdAt: tsz('created_at').notNull().defaultNow(),
});

export const recordings = pgTable(
  'recordings',
  {
    fixtureKey: char('fixture_key', { length: 64 }).primaryKey(),
    kind: text('kind').notNull(),
    request: jsonb('request').notNull(),
    response: jsonb('response').notNull(),
    recordedAt: tsz('recorded_at').notNull().defaultNow(),
  },
  (t) => [check('recordings_kind_ck', sql`${t.kind} in ('llm', 'paypal')`)],
);

// ---------------------------------------------------------------- Demo seeding

/** What the sandbox seeder created, keyed by a stable seed key, so re-runs never duplicate. */
export const seedObjects = pgTable(
  'seed_objects',
  {
    seedKey: text('seed_key').primaryKey(),
    kind: text('kind').notNull(),
    paypalId: text('paypal_id').notNull(),
    status: text('status').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: tsz('created_at').notNull().defaultNow(),
    updatedAt: tsz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('seed_objects_kind_idx').on(t.kind)],
);

/** Free text from customers (support inbox). Always treated as UNTRUSTED by the agent. */
export const customerNotes = pgTable(
  'customer_notes',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull(),
    externalRef: text('external_ref').notNull(),
    body: text('body').notNull(),
    receivedAt: tsz('received_at').notNull().defaultNow(),
  },
  (t) => [index('customer_notes_external_ref_idx').on(t.externalRef)],
);

/**
 * Small key/value settings saved from the web app (e.g. the merchant's PayPal sandbox app).
 * Secret values are stored encrypted by the web app; this table never sees plaintext secrets.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: tsz('updated_at').notNull().defaultNow(),
});
