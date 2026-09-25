CREATE TABLE "organization_agent_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"system_prompt" text NOT NULL,
	"welcome_message" text NOT NULL,
	"closing_message" text NOT NULL,
	"voice" text NOT NULL,
	"temperature" real NOT NULL,
	"top_p" real NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_agent_settings" ADD CONSTRAINT "organization_agent_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_agent_settings_org_uidx" ON "organization_agent_settings" USING btree ("organization_id");