CREATE TABLE "brand_memory" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"summary" jsonb,
	"ads" jsonb,
	"learnings" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_projects" ADD COLUMN "concepts" jsonb;--> statement-breakpoint
ALTER TABLE "brand_memory" ADD CONSTRAINT "brand_memory_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;