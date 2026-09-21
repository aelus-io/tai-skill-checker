CREATE TYPE "public"."recording_status" AS ENUM('STARTING', 'ACTIVE', 'COMPLETED', 'FAILED');--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "egress_id" text;--> statement-breakpoint
UPDATE "recordings" SET "egress_id" = 'legacy-' || "id"::text WHERE "egress_id" IS NULL;--> statement-breakpoint
ALTER TABLE "recordings" ALTER COLUMN "egress_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "status" "recording_status" DEFAULT 'STARTING' NOT NULL;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_egress_uidx" ON "recordings" USING btree ("egress_id");
