CREATE TABLE "editing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_video_id" uuid NOT NULL,
	"processing_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"schema_version" text,
	"language" text,
	"duration_seconds" double precision NOT NULL,
	"settings" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"skipped" jsonb,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editing_plans_status_check" CHECK ("editing_plans"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "planned_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"start_seconds" double precision NOT NULL,
	"end_seconds" double precision NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"caption" text NOT NULL,
	"reason" text NOT NULL,
	"score" integer NOT NULL,
	"crop_mode" text DEFAULT 'center' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_clips_range_check" CHECK ("planned_clips"."start_seconds" >= 0 and "planned_clips"."end_seconds" > "planned_clips"."start_seconds")
);
--> statement-breakpoint
ALTER TABLE "editing_plans" ADD CONSTRAINT "editing_plans_source_video_id_source_videos_id_fk" FOREIGN KEY ("source_video_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editing_plans" ADD CONSTRAINT "editing_plans_processing_job_id_processing_jobs_id_fk" FOREIGN KEY ("processing_job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editing_plans" ADD CONSTRAINT "editing_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_clips" ADD CONSTRAINT "planned_clips_plan_id_editing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."editing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "editing_plans_source_video_id_idx" ON "editing_plans" USING btree ("source_video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editing_plans_one_active_per_video" ON "editing_plans" USING btree ("source_video_id") WHERE status in ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX "planned_clips_plan_id_idx" ON "planned_clips" USING btree ("plan_id");