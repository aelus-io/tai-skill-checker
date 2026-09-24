ALTER TABLE "evaluations" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "evaluations_status_claimed_idx" ON "evaluations" USING btree ("status","claimed_at");