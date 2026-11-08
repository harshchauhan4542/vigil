CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exception_id" uuid,
	"model" text NOT NULL,
	"mode" text NOT NULL,
	"prompt_hash" char(64),
	"input_tokens" integer,
	"output_tokens" integer,
	"turns" integer,
	"trace" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "agent_runs_mode_ck" CHECK ("agent_runs"."mode" in ('live', 'replay'))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"approver" text NOT NULL,
	"typed_confirmation" text,
	"params_hash" char(64) NOT NULL,
	"token_hash" char(64),
	"token_used_at" timestamp with time zone,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "approvals_proposal_uq" UNIQUE("proposal_id"),
	CONSTRAINT "approvals_decision_ck" CHECK ("approvals"."decision" in ('APPROVED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" char(64) NOT NULL,
	"hash" char(64) NOT NULL,
	CONSTRAINT "audit_log_hash_uq" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_ref" text NOT NULL,
	"amount_at_risk_cents" bigint,
	"currency" char(3),
	"severity" smallint DEFAULT 1 NOT NULL,
	"deadline_at" timestamp with time zone,
	"status" text NOT NULL,
	"detector_version" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "exceptions_type_target_uq" UNIQUE("type","target_ref")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"paypal_request_id" varchar(38),
	"operation" text NOT NULL,
	"endpoint" text NOT NULL,
	"mock_code" text,
	"http_status" integer,
	"paypal_status" text,
	"debug_id" text,
	"response" jsonb,
	"render_task_run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "executions_proposal_attempt_uq" UNIQUE("proposal_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"operation" text NOT NULL,
	"business_key" text NOT NULL,
	"paypal_request_id" varchar(38) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"retention_until" timestamp with time zone,
	"result_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_operation_business_key_pk" PRIMARY KEY("operation","business_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_ref" text,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"booked_on" date NOT NULL,
	"memo" text,
	"matched_txn_id" text
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"version" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pp_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"captured_total_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone,
	"expiration_time" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pp_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"authorization_id" text,
	"order_id" text,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"refunded_total_cents" bigint DEFAULT 0 NOT NULL,
	"has_tracker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pp_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"intent" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"custom_id" text,
	"invoice_id" text,
	"is_physical" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pp_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"outstanding_balance_cents" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"last_failed_reason" text,
	"last_failed_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pp_transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"event_code" text,
	"status" char(1),
	"amount_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"fee_cents" bigint,
	"invoice_id" text,
	"custom_id" text,
	"initiation_date" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exception_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"action_type" text NOT NULL,
	"target_ref" text NOT NULL,
	"params" jsonb NOT NULL,
	"params_hash" char(64) NOT NULL,
	"rationale" text NOT NULL,
	"evidence_refs" text[] NOT NULL,
	"confidence" real NOT NULL,
	"policy_version" text,
	"policy_result" jsonb,
	"risk_tier" smallint,
	"amount_cents" bigint,
	"currency" char(3),
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "proposals_rationale_len_ck" CHECK (char_length("proposals"."rationale") <= 600),
	CONSTRAINT "proposals_confidence_ck" CHECK ("proposals"."confidence" >= 0 and "proposals"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"fixture_key" char(64) PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_kind_ck" CHECK ("recordings"."kind" in ('llm', 'paypal'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"transmission_id" text,
	"transmission_time" timestamp with time zone,
	"verification_method" text,
	"verification_status" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"headers" jsonb,
	"raw_body" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_exception_id_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."exceptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exceptions_status_idx" ON "exceptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_entries_external_ref_idx" ON "ledger_entries" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "pp_authorizations_status_idx" ON "pp_authorizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pp_captures_order_idx" ON "pp_captures" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pp_transactions_initiation_idx" ON "pp_transactions" USING btree ("initiation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_one_open_per_target" ON "proposals" USING btree ("target_ref") WHERE "proposals"."status" in ('DRAFT','PENDING_APPROVAL','APPROVED','QUEUED','EXECUTING','FAILED_RETRYABLE','NEEDS_RECONCILE');--> statement-breakpoint
CREATE INDEX "proposals_exception_idx" ON "proposals" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "webhook_events_resource_idx" ON "webhook_events" USING btree ("resource_id");