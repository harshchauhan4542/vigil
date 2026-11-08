CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_ref" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_objects" (
	"seed_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"paypal_id" text NOT NULL,
	"status" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "customer_notes_external_ref_idx" ON "customer_notes" USING btree ("external_ref");--> statement-breakpoint
CREATE INDEX "seed_objects_kind_idx" ON "seed_objects" USING btree ("kind");