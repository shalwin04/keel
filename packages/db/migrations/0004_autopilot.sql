CREATE TABLE "autopilots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"account_id" text NOT NULL,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"settings" jsonb NOT NULL,
	"site" jsonb,
	"profile" jsonb,
	"project_id" text,
	"performance" jsonb,
	"learnings" jsonb,
	"moves" jsonb,
	"log" jsonb,
	"next_check_at" timestamp with time zone,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilots" ADD CONSTRAINT "autopilots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilots_ws_idx" ON "autopilots" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "autopilots_due_idx" ON "autopilots" USING btree ("status","next_check_at");