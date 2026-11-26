import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import {
  type RenderedClipRow,
  type RenderJobRow,
  type RenderMetrics,
  renderedClips,
  renderJobs,
  sourceVideos,
} from '../../infrastructure/database/schema.js';

const FINISHED = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
const ACTIVE = ['PENDING', 'RUNNING'] as const;

export type Render = Omit<RenderJobRow, 'userId' | 'lastSequence'>;
export type NewRenderedClip = Omit<RenderedClipRow, 'id' | 'renderId' | 'createdAt'>;

export function toRender(row: RenderJobRow): Render {
  const { userId: _u, lastSequence: _s, ...render } = row;
  return render;
}

/** Same guarded-update rules as jobs, experiments and plans. */
@Injectable()
export class RendersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(render: Pick<RenderJobRow, 'id' | 'planId' | 'sourceVideoId' | 'userId' | 'settings' | 'clipCount'>) {
    const [row] = await this.db.insert(renderJobs).values({ ...render, status: 'PENDING' }).returning();
    return row;
  }

  async findOwned(userId: string, id: string): Promise<RenderJobRow | undefined> {
    const [row] = await this.db.select().from(renderJobs).where(and(eq(renderJobs.id, id), eq(renderJobs.userId, userId))).limit(1);
    return row;
  }

  async findAny(id: string): Promise<RenderJobRow | undefined> {
    const [row] = await this.db.select().from(renderJobs).where(eq(renderJobs.id, id)).limit(1);
    return row;
  }

  listForPlan(userId: string, planId: string): Promise<RenderJobRow[]> {
    return this.db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.planId, planId), eq(renderJobs.userId, userId)))
      .orderBy(desc(renderJobs.createdAt));
  }

  clipsOf(renderId: string): Promise<RenderedClipRow[]> {
    return this.db.select().from(renderedClips).where(eq(renderedClips.renderId, renderId)).orderBy(asc(renderedClips.position));
  }

  /** A rendered clip with its render's owner check, for file access and export. */
  async findClipOwned(userId: string, clipId: string): Promise<RenderedClipRow | undefined> {
    const [row] = await this.db
      .select({ clip: renderedClips })
      .from(renderedClips)
      .innerJoin(renderJobs, eq(renderJobs.id, renderedClips.renderId))
      .where(and(eq(renderedClips.id, clipId), eq(renderJobs.userId, userId)))
      .limit(1);
    return row?.clip;
  }

  /** Every rendered clip of the user, newest first, with its video's name (the Clips gallery). */
  listClips(userId: string, limit = 200) {
    return this.db
      .select({ clip: renderedClips, videoId: sourceVideos.id, videoName: sourceVideos.filename, projectId: sourceVideos.projectId })
      .from(renderedClips)
      .innerJoin(renderJobs, eq(renderJobs.id, renderedClips.renderId))
      .innerJoin(sourceVideos, eq(sourceVideos.id, renderJobs.sourceVideoId))
      .where(eq(renderJobs.userId, userId))
      .orderBy(desc(renderedClips.createdAt), asc(renderedClips.position))
      .limit(limit);
  }

  findStale(seconds: number): Promise<RenderJobRow[]> {
    return this.db
      .select()
      .from(renderJobs)
      .where(and(inArray(renderJobs.status, [...ACTIVE]), lt(renderJobs.updatedAt, sql`now() - make_interval(secs => ${seconds})`)));
  }

  applyProgress(id: string, sequence: number, progress: number) {
    return this.applyEvent(this.db, id, sequence, { status: 'RUNNING', progress });
  }

  /** Status and clips in one transaction: a COMPLETED render always has its clips. */
  completeWithClips(id: string, sequence: number, result: { metrics: RenderMetrics; failures: RenderJobRow['failures']; clips: NewRenderedClip[] }) {
    return this.db.transaction(async (tx) => {
      const { clips, ...fields } = result;
      const row = await this.applyEvent(tx, id, sequence, { ...fields, status: 'COMPLETED', progress: 100, completedAt: sql`now()` });
      if (row && clips.length) await tx.insert(renderedClips).values(clips.map((c) => ({ ...c, renderId: id })));
      return row;
    });
  }

  applyFailure(id: string, sequence: number, failure: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    return this.applyEvent(this.db, id, sequence, { ...failure, completedAt: sql`now()` });
  }

  async finish(id: string, outcome: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    const [row] = await this.db
      .update(renderJobs)
      .set({ ...outcome, completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(renderJobs.id, id), notInArray(renderJobs.status, [...FINISHED])))
      .returning();
    return row;
  }

  async completedWith(id: string, sequence: number): Promise<RenderJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, id), eq(renderJobs.status, 'COMPLETED'), eq(renderJobs.lastSequence, sequence)))
      .limit(1);
    return row;
  }

  async isGoneOrFinished(id: string): Promise<boolean> {
    const [row] = await this.db.select({ status: renderJobs.status }).from(renderJobs).where(eq(renderJobs.id, id)).limit(1);
    return !row || (FINISHED as readonly string[]).includes(row.status);
  }

  private async applyEvent(db: Pick<Database, 'update'>, id: string, sequence: number, changes: PgUpdateSetSource<typeof renderJobs>) {
    const [row] = await db
      .update(renderJobs)
      .set({ ...changes, lastSequence: sequence, updatedAt: sql`now()` })
      .where(and(eq(renderJobs.id, id), lt(renderJobs.lastSequence, sequence), notInArray(renderJobs.status, [...FINISHED])))
      .returning();
    return row;
  }
}
