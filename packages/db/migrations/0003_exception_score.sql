ALTER TABLE "exceptions" ADD COLUMN "score" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "exceptions_score_idx" ON "exceptions" USING btree ("score");