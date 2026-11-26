import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { sourceVideos, type SourceVideoRow, type VideoStatus } from '../../infrastructure/database/schema.js';

/** What the API returns for a video. Internal paths and owner ids stay server-side. */
export interface Video {
  id: string;
  projectId: string;
  filename: string;
  fileSize: number;
  bytesCopied: number;
  mimeType: string;
  status: VideoStatus;
  errorMessage: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Full row, for the service's own use (paths, ownership). */
export type VideoRecord = SourceVideoRow;

export type NewImport = Pick<
  VideoRecord,
  'id' | 'userId' | 'projectId' | 'filename' | 'storagePath' | 'fileSize' | 'mimeType'
>;

/** What FFprobe tells us about an imported video (all NULL when the probe could not run). */
export type VideoMetadata = Partial<
  Pick<
    VideoRecord,
    'duration' | 'width' | 'height' | 'frameRate' | 'videoCodec' | 'audioCodec' | 'hasAudio' | 'container'
  >
>;

export function toVideo(record: VideoRecord): Video {
  const { userId: _userId, storagePath: _storagePath, ...video } = record;
  return video;
}

/**
 * Persistence for source videos. User-facing reads are scoped to `userId`.
 * Status transitions only apply to rows still IMPORTING and report whether the row was there:
 * `false` means the video was deleted (or already finished) meanwhile, which tells a running copy to stop.
 */
@Injectable()
export class VideosRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertImporting(video: NewImport): Promise<VideoRecord> {
    const [row] = await this.db
      .insert(sourceVideos)
      .values({ ...video, status: 'IMPORTING' })
      .returning();
    return row;
  }

  listForProject(userId: string, projectId: string): Promise<VideoRecord[]> {
    return this.db
      .select()
      .from(sourceVideos)
      .where(and(eq(sourceVideos.projectId, projectId), eq(sourceVideos.userId, userId)))
      .orderBy(desc(sourceVideos.createdAt));
  }

  async findOwned(userId: string, id: string): Promise<VideoRecord | undefined> {
    const [row] = await this.db.select().from(sourceVideos).where(this.owned(userId, id)).limit(1);
    return row;
  }

  updateProgress(id: string, bytesCopied: number): Promise<boolean> {
    return this.transition(id, { bytesCopied });
  }

  markReady(id: string, bytesCopied: number, metadata: VideoMetadata = {}): Promise<boolean> {
    return this.transition(id, { status: 'READY', bytesCopied, ...metadata });
  }

  markFailed(id: string, errorMessage: string): Promise<boolean> {
    return this.transition(id, { status: 'FAILED', errorMessage });
  }

  async deleteOwned(userId: string, id: string): Promise<VideoRecord | undefined> {
    const [row] = await this.db.delete(sourceVideos).where(this.owned(userId, id)).returning();
    return row;
  }

  findByStatus(status: VideoStatus): Promise<VideoRecord[]> {
    return this.db.select().from(sourceVideos).where(eq(sourceVideos.status, status));
  }

  private async transition(id: string, changes: Partial<VideoRecord>): Promise<boolean> {
    const updated = await this.db
      .update(sourceVideos)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(and(eq(sourceVideos.id, id), eq(sourceVideos.status, 'IMPORTING')))
      .returning({ id: sourceVideos.id });
    return updated.length > 0;
  }

  private owned(userId: string, id: string) {
    return and(eq(sourceVideos.id, id), eq(sourceVideos.userId, userId));
  }
}
