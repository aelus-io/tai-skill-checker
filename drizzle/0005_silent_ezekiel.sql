ALTER TABLE "resource_chunks" ADD COLUMN "assessment_version_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_chunks" ADD CONSTRAINT "resource_chunks_assessment_version_id_assessment_versions_id_fk" FOREIGN KEY ("assessment_version_id") REFERENCES "public"."assessment_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_chunks_version_idx" ON "resource_chunks" USING btree ("assessment_version_id");
--> statement-breakpoint
CREATE TRIGGER published_resource_chunks_immutable
BEFORE UPDATE OR DELETE ON resource_chunks
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();
