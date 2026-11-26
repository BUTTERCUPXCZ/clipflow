import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { type PlannedClipRow, plannedClips } from '../../infrastructure/database/schema.js';

@Injectable()
export class ClipsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listForPlan(planId: string): Promise<PlannedClipRow[]> {
    return this.db.select().from(plannedClips).where(eq(plannedClips.planId, planId)).orderBy(asc(plannedClips.startSeconds));
  }

  async findInPlan(planId: string, clipId: string): Promise<PlannedClipRow | undefined> {
    const [row] = await this.db
      .select()
      .from(plannedClips)
      .where(and(eq(plannedClips.id, clipId), eq(plannedClips.planId, planId)))
      .limit(1);
    return row;
  }

  async updateTimes(clipId: string, startSeconds: number, endSeconds: number): Promise<PlannedClipRow> {
    const [row] = await this.db
      .update(plannedClips)
      .set({ startSeconds, endSeconds, updatedAt: sql`now()` })
      .where(eq(plannedClips.id, clipId))
      .returning();
    return row;
  }

  async remove(clipId: string): Promise<void> {
    await this.db
      .update(plannedClips)
      .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(plannedClips.id, clipId), isNull(plannedClips.removedAt)));
  }
}
