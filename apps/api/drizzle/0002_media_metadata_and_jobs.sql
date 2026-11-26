CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_video_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"message" text,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"artifacts" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_jobs_status_check" CHECK ("processing_jobs"."status" in ('PENDING', 'VALIDATING', 'EXTRACTING_MEDIA', 'COMPLETED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "processing_jobs_progress_check" CHECK ("processing_jobs"."progress" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "video_codec" text;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "audio_codec" text;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "has_audio" boolean;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "container" text;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_source_video_id_source_videos_id_fk" FOREIGN KEY ("source_video_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_jobs_source_video_id_idx" ON "processing_jobs" USING btree ("source_video_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_idx" ON "processing_jobs" USING btree ("status");