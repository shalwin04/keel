CREATE TABLE "ad_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"meta_account_id" text NOT NULL,
	"token_ref" text NOT NULL,
	"poll_interval_min" integer DEFAULT 180 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"channel" text NOT NULL,
	"decided_by" text NOT NULL,
	"decision" text NOT NULL,
	"raw" jsonb,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"whatsapp_number" text,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_baselines" (
	"creative_id" text PRIMARY KEY NOT NULL,
	"ad_id" text NOT NULL,
	"approved_image_hash" text,
	"features_spec" jsonb NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"model_tier" text NOT NULL,
	"precision" real NOT NULL,
	"recall" real NOT NULL,
	"cost_per_variant_usd" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"variant_id" text,
	"code" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" real NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"regions" jsonb NOT NULL,
	"detected_by" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"ad_id" text NOT NULL,
	"finding_ids" jsonb NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"requires_approval" boolean NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"thread_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rulebooks" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"version" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"source_ads" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"creative_id" text NOT NULL,
	"features_spec" jsonb NOT NULL,
	"variants" jsonb NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rulebooks" ADD CONSTRAINT "rulebooks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;