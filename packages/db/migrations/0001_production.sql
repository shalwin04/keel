ALTER TABLE "ad_accounts" ADD COLUMN "watching" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "cycles" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "outcome" jsonb;--> statement-breakpoint
CREATE INDEX "cycles_account_idx" ON "cycles" USING btree ("account_id","started_at");--> statement-breakpoint
CREATE INDEX "findings_account_idx" ON "findings" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "findings_ad_idx" ON "findings" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "proposals_account_idx" ON "proposals" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "proposals_cycle_idx" ON "proposals" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "snapshots_account_idx" ON "snapshots" USING btree ("account_id","taken_at");--> statement-breakpoint
CREATE INDEX "snapshots_ad_idx" ON "snapshots" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "trace_cycle_idx" ON "trace_events" USING btree ("cycle_id","seq");