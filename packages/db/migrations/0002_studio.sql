CREATE TABLE "studio_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"direction" integer NOT NULL,
	"size" text NOT NULL,
	"doc" jsonb NOT NULL,
	"render_ref" text,
	"check" jsonb,
	"picked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"brief" jsonb NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb NOT NULL,
	"directions" jsonb,
	"launch" jsonb,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_designs" ADD CONSTRAINT "studio_designs_project_id_studio_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."studio_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_designs_project_idx" ON "studio_designs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "studio_projects_ws_idx" ON "studio_projects" USING btree ("workspace_id","created_at");