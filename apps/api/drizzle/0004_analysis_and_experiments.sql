CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_video_id" uuid NOT NULL,
	"processing_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"settings" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"output_path" text,
	"output" jsonb,
	"metrics" jsonb,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_status_check" CHECK ("experiments"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "video_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_video_id" uuid NOT NULL,
	"processing_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"transcript" jsonb,
	"visual_analysis" jsonb NOT NULL,
	"model_metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_analyses_processing_job_id_unique" UNIQUE("processing_job_id")
);
--> statement-breakpoint
ALTER TABLE "processing_jobs" DROP CONSTRAINT "processing_jobs_status_check";--> statement-breakpoint
DROP INDEX "processing_jobs_one_active_per_video";--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_video_id_source_videos_id_fk" FOREIGN KEY ("source_video_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_processing_job_id_processing_jobs_id_fk" FOREIGN KEY ("processing_job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_source_video_id_source_videos_id_fk" FOREIGN KEY ("source_video_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_processing_job_id_processing_jobs_id_fk" FOREIGN KEY ("processing_job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_analyses" ADD CONSTRAINT "video_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiments_source_video_id_idx" ON "experiments" USING btree ("source_video_id");--> statement-breakpoint
CREATE INDEX "video_analyses_source_video_id_idx" ON "video_analyses" USING btree ("source_video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_one_active_per_video" ON "processing_jobs" USING btree ("source_video_id") WHERE status in ('PENDING', 'VALIDATING', 'EXTRACTING_MEDIA', 'TRANSCRIBING', 'ANALYZING_VISUALS');--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_status_check" CHECK ("processing_jobs"."status" in ('PENDING', 'VALIDATING', 'EXTRACTING_MEDIA', 'TRANSCRIBING', 'ANALYZING_VISUALS', 'COMPLETED', 'FAILED', 'CANCELLED'));