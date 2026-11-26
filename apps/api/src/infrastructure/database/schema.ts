// Database schema (spec/SPEC-phase-2.md, Data Model). Imports only from drizzle-orm so drizzle-kit can load it.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
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
    // Filled by FFprobe in Phase 3.
    duration: doublePrecision('duration'),
    width: integer('width'),
    height: integer('height'),
    frameRate: doublePrecision('frame_rate'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('source_videos_project_id_idx').on(t.projectId),
    check('source_videos_status_check', sql`${t.status} in ('IMPORTING', 'READY', 'FAILED')`),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type SourceVideoRow = typeof sourceVideos.$inferSelect;
export type NewSourceVideoRow = typeof sourceVideos.$inferInsert;
