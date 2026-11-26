import { sql } from 'drizzle-orm';
import { bigint, check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { editingPlans, plannedClips } from './plans.schema.js';
// Re-exported by schema.ts (the file drizzle-kit reads); kept apart to respect the 300-line limit.
import { sourceVideos, users } from './schema.js';

export const RENDER_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;

export interface RenderSettings {
  subtitles: boolean;
  clips?: { id: string; title: string; startSeconds: number; endSeconds: number }[];
}

export interface RenderMetrics {
  rendered: number;
  failed: number;
  elapsedMs: number;
  encoder: string;
}

/** Rendering the kept clips of a plan (Phase 6, system-design §4.11–4.13). */
export const renderJobs = pgTable(
  'render_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => editingPlans.id, { onDelete: 'cascade' }),
    sourceVideoId: uuid('source_video_id')
      .notNull()
      .references(() => sourceVideos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // `clips` snapshots what was sent to the worker: edits to the plan during a render can't relabel its files.
    settings: jsonb('settings').$type<RenderSettings>().notNull(),
    status: text('status', { enum: RENDER_STATUSES }).notNull(),
    progress: integer('progress').notNull().default(0),
    clipCount: integer('clip_count').notNull(),
    metrics: jsonb('metrics').$type<RenderMetrics>(),
    failures: jsonb('failures').$type<{ clipId: string; error: string }[]>(),
    lastSequence: integer('last_sequence').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('render_jobs_plan_id_idx').on(t.planId),
    uniqueIndex('render_jobs_one_active_per_video')
      .on(t.sourceVideoId)
      .where(sql`status in ('PENDING', 'RUNNING')`),
    check('render_jobs_status_check', sql`${t.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`),
  ],
);

/** One verified output file. Title and times are copied so later plan edits never rename a past render. */
export const renderedClips = pgTable(
  'rendered_clips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    renderId: uuid('render_id')
      .notNull()
      .references(() => renderJobs.id, { onDelete: 'cascade' }),
    plannedClipId: uuid('planned_clip_id').references(() => plannedClips.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    startSeconds: doublePrecision('start_seconds').notNull(),
    endSeconds: doublePrecision('end_seconds').notNull(),
    filePath: text('file_path').notNull(),
    thumbnailPath: text('thumbnail_path').notNull(),
    durationSeconds: doublePrecision('duration_seconds').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rendered_clips_render_id_idx').on(t.renderId)],
);

export type RenderJobRow = typeof renderJobs.$inferSelect;
export type RenderedClipRow = typeof renderedClips.$inferSelect;
