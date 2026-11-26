import { sql } from 'drizzle-orm';
import { check, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
// Re-exported by schema.ts (the file drizzle-kit reads); kept apart to respect the 300-line limit.
import { processingJobs, sourceVideos, users } from './schema.js';

export const PLAN_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface PlanSettings {
  minSeconds: number;
  maxSeconds: number;
  maxClips: number;
}

export interface PlanMetrics {
  llmCalls: number;
  elapsedMs: number;
  windows: number;
  skippedWindows: number;
  clipCount: number;
}

/** A clip-planning run on a completed job's analysis (Phase 5, system-design §4.7–4.10). */
export const editingPlans = pgTable(
  'editing_plans',
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
    schemaVersion: text('schema_version'),
    language: text('language'),
    durationSeconds: doublePrecision('duration_seconds').notNull(),
    settings: jsonb('settings').$type<PlanSettings>().notNull(),
    status: text('status', { enum: PLAN_STATUSES }).notNull(),
    progress: integer('progress').notNull().default(0),
    metrics: jsonb('metrics').$type<PlanMetrics>(),
    // Windows or copy batches whose answers were rejected twice, with the raw output kept for inspection.
    skipped: jsonb('skipped').$type<{ start: number; end: number; errors: string[]; raw?: string }[]>(),
    lastSequence: integer('last_sequence').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('editing_plans_source_video_id_idx').on(t.sourceVideoId),
    uniqueIndex('editing_plans_one_active_per_video')
      .on(t.sourceVideoId)
      .where(sql`status in ('PENDING', 'RUNNING')`),
    check('editing_plans_status_check', sql`${t.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`),
  ],
);

/** One proposed clip. Removal is soft (removed_at) so Phase 6 skips it and it can be restored later. */
export const plannedClips = pgTable(
  'planned_clips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => editingPlans.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    startSeconds: doublePrecision('start_seconds').notNull(),
    endSeconds: doublePrecision('end_seconds').notNull(),
    title: text('title').notNull(),
    hook: text('hook').notNull(),
    caption: text('caption').notNull(),
    reason: text('reason').notNull(),
    score: integer('score').notNull(),
    cropMode: text('crop_mode').notNull().default('center'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('planned_clips_plan_id_idx').on(t.planId),
    check('planned_clips_range_check', sql`${t.startSeconds} >= 0 and ${t.endSeconds} > ${t.startSeconds}`),
  ],
);

export type EditingPlanRow = typeof editingPlans.$inferSelect;
export type PlannedClipRow = typeof plannedClips.$inferSelect;
