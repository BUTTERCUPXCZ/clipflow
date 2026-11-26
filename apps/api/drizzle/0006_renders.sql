CREATE TABLE "render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"source_video_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"clip_count" integer NOT NULL,
	"metrics" jsonb,
	"failures" jsonb,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_jobs_status_check" CHECK ("render_jobs"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "rendered_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"render_id" uuid NOT NULL,
	"planned_clip_id" uuid,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"start_seconds" double precision NOT NULL,
	"end_seconds" double precision NOT NULL,
	"file_path" text NOT NULL,
	"thumbnail_path" text NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_plan_id_editing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."editing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_source_video_id_source_videos_id_fk" FOREIGN KEY ("source_video_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_clips" ADD CONSTRAINT "rendered_clips_render_id_render_jobs_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."render_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_clips" ADD CONSTRAINT "rendered_clips_planned_clip_id_planned_clips_id_fk" FOREIGN KEY ("planned_clip_id") REFERENCES "public"."planned_clips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "render_jobs_plan_id_idx" ON "render_jobs" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "render_jobs_one_active_per_video" ON "render_jobs" USING btree ("source_video_id") WHERE status in ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX "rendered_clips_render_id_idx" ON "rendered_clips" USING btree ("render_id");