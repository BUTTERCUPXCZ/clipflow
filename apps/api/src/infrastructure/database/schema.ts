// Database schema (spec/SPEC-phase-2.md, Data Model). Imports only from drizzle-orm so drizzle-kit can load it.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const VIDEO_STATUSES = ['IMPORTING', 'READY', 'FAILED'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_user_id_idx').on(t.userId)],
);

export const sourceVideos = pgTable(
  'source_videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    storagePath: text('storage_path').notNull(),
    // 'number' mode: sizes are capped at 50 GiB, far below Number.MAX_SAFE_INTEGER.
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    bytesCopied: bigint('bytes_copied', { mode: 'number' }).notNull().default(0),
    mimeType: text('mime_type').notNull(),
    status: text('status', { enum: VIDEO_STATUSES }).notNull(),
    errorMessage: text('error_message'),
    // Filled by FFprobe (ProbeVideo) when the copy finishes; NULL if the AI service was unavailable then.
    duration: doublePrecision('duration'),
    width: integer('width'),
    height: integer('height'),
    frameRate: doublePrecision('frame_rate'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    hasAudio: boolean('has_audio'),
    container: text('container'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('source_videos_project_id_idx').on(t.projectId),
    check('source_videos_status_check', sql`${t.status} in ('IMPORTING', 'READY', 'FAILED')`),
  ],
);

export const JOB_STATUSES = [
  'PENDING',
  'VALIDATING',
  'EXTRACTING_MEDIA',
  'TRANSCRIBING',
  'ANALYZING_VISUALS',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
const ACTIVE_JOB_SQL = sql.raw("('PENDING', 'VALIDATING', 'EXTRACTING_MEDIA', 'TRANSCRIBING', 'ANALYZING_VISUALS')");
export type JobStatus = (typeof JOB_STATUSES)[number];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/** Relative paths (MEDIA_ROOT) to what a completed Phase 3 job produced. */
export interface JobArtifacts {
  hasAudio: boolean;
  audioPath: string | null;
  audioDurationSeconds: number | null;
  frameCount: number;
  frameIntervalSeconds: number;
  framesPath: string;
  transcriptPath: string | null;
  visualPath: string;
  validBatches: number;
  totalBatches: number;
}

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceVideoId: uuid('source_video_id')
      .notNull()
      .references(() => sourceVideos.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    stage: text('stage').notNull(),
    progress: integer('progress').notNull().default(0),
    message: text('message'),
    // Highest event sequence applied; older or repeated events from the worker are ignored.
    lastSequence: integer('last_sequence').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    artifacts: jsonb('artifacts').$type<JobArtifacts>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('processing_jobs_source_video_id_idx').on(t.sourceVideoId),
    index('processing_jobs_status_idx').on(t.status),
    // At most one active job per video, enforced by the database (two concurrent POST /process calls).
    uniqueIndex('processing_jobs_one_active_per_video')
      .on(t.sourceVideoId)
      .where(sql`status in ${ACTIVE_JOB_SQL}`),
    check(
      'processing_jobs_status_check',
      sql`${t.status} in ('PENDING', 'VALIDATING', 'EXTRACTING_MEDIA', 'TRANSCRIBING', 'ANALYZING_VISUALS', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
    check('processing_jobs_progress_check', sql`${t.progress} between 0 and 100`),
  ],
);

export type ProcessingJobRow = typeof processingJobs.$inferSelect;

/** What a completed job understood about its video (Phase 4). One row per completed job. */
export const videoAnalyses = pgTable(
  'video_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceVideoId: uuid('source_video_id')
      .notNull()
      .references(() => sourceVideos.id, { onDelete: 'cascade' }),
    processingJobId: uuid('processing_job_id')
      .notNull()
      .unique()
      .references(() => processingJobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transcript: jsonb('transcript'), // null when the video has no audio
    visualAnalysis: jsonb('visual_analysis').notNull(),
    modelMetadata: jsonb('model_metadata').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('video_analyses_source_video_id_idx').on(t.sourceVideoId)],
);

export const EXPERIMENT_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export interface ExperimentMetrics {
  loadMs: number;
  inferenceMs: number;
  totalMs: number;
  peakVramMiB: number | null;
  framesAnalysed: number;
  validBatches: number;
  totalBatches: number;
}

/** A visual-analysis run with a chosen model on a completed job's frames (system-design §10). */
export const experiments = pgTable(
  'experiments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceVideoId: uuid('source_video_id')
      .notNull()
      .references(() => sourceVideos.id, { onDelete: 'cascade' }),
    processingJobId: uuid('processing_job_id')
      .notNull()
      .references(() => processingJobs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    promptVersion: text('prompt_version').notNull(),
    settings: jsonb('settings').$type<{ maxFrames: number; batchSize: number }>().notNull(),
    status: text('status', { enum: EXPERIMENT_STATUSES }).notNull(),
    progress: integer('progress').notNull().default(0),
    outputPath: text('output_path'),
    output: jsonb('output'),
    metrics: jsonb('metrics').$type<ExperimentMetrics>(),
    lastSequence: integer('last_sequence').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('experiments_source_video_id_idx').on(t.sourceVideoId),
    check('experiments_status_check', sql`${t.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`),
  ],
);

export type VideoAnalysisRow = typeof videoAnalyses.$inferSelect;
export type ExperimentRow = typeof experiments.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type SourceVideoRow = typeof sourceVideos.$inferSelect;
export type NewSourceVideoRow = typeof sourceVideos.$inferInsert;

export * from './plans.schema.js';
export * from './renders.schema.js';
