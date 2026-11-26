import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import {
  type EditingPlanRow,
  editingPlans,
  type PlanMetrics,
  type PlannedClipRow,
  plannedClips,
} from '../../infrastructure/database/schema.js';

const FINISHED = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
const ACTIVE = ['PENDING', 'RUNNING'] as const;

export type Plan = Omit<EditingPlanRow, 'userId' | 'lastSequence'>;
export type NewClip = Pick<
  PlannedClipRow,
  'position' | 'startSeconds' | 'endSeconds' | 'title' | 'hook' | 'caption' | 'reason' | 'score' | 'cropMode'
>;
export interface PlanResult {
  schemaVersion: string;
  language: string;
  metrics: PlanMetrics;
  skipped: EditingPlanRow['skipped'];
  clips: NewClip[];
}

export function toPlan(row: EditingPlanRow): Plan {
  const { userId: _u, lastSequence: _s, ...plan } = row;
  return plan;
}

/** Same guarded-update rules as jobs and experiments: newer sequence only, never once finished. */
@Injectable()
export class PlansRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    plan: Pick<EditingPlanRow, 'id' | 'sourceVideoId' | 'processingJobId' | 'userId' | 'modelName' | 'durationSeconds' | 'settings'>,
  ): Promise<EditingPlanRow> {
    const [row] = await this.db.insert(editingPlans).values({ ...plan, status: 'PENDING' }).returning();
    return row;
  }

  async findOwned(userId: string, id: string): Promise<EditingPlanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(editingPlans)
      .where(and(eq(editingPlans.id, id), eq(editingPlans.userId, userId)))
      .limit(1);
    return row;
  }

  listForVideo(userId: string, videoId: string): Promise<EditingPlanRow[]> {
    return this.db
      .select()
      .from(editingPlans)
      .where(and(eq(editingPlans.sourceVideoId, videoId), eq(editingPlans.userId, userId)))
      .orderBy(desc(editingPlans.createdAt));
  }

  findStale(seconds: number): Promise<EditingPlanRow[]> {
    return this.db
      .select()
      .from(editingPlans)
      .where(and(inArray(editingPlans.status, [...ACTIVE]), lt(editingPlans.updatedAt, sql`now() - make_interval(secs => ${seconds})`)));
  }

  applyProgress(id: string, sequence: number, progress: number) {
    return this.applyEvent(this.db, id, sequence, { status: 'RUNNING', progress });
  }

  /** Status and clips in one transaction: a COMPLETED plan always has its clips. */
  completeWithClips(id: string, sequence: number, result: PlanResult): Promise<EditingPlanRow | undefined> {
    return this.db.transaction(async (tx) => {
      const { clips, ...fields } = result;
      const row = await this.applyEvent(tx, id, sequence, {
        ...fields,
        status: 'COMPLETED',
        progress: 100,
        completedAt: sql`now()`,
      });
      if (row && clips.length) await tx.insert(plannedClips).values(clips.map((c) => ({ ...c, planId: id })));
      return row;
    });
  }

  applyFailure(id: string, sequence: number, failure: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    return this.applyEvent(this.db, id, sequence, { ...failure, completedAt: sql`now()` });
  }

  /** Ends a plan from the NestJS side (user cancel, reconciliation, a start that failed). */
  async finish(id: string, outcome: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    const [row] = await this.db
      .update(editingPlans)
      .set({ ...outcome, completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(editingPlans.id, id), notInArray(editingPlans.status, [...FINISHED])))
      .returning();
    return row;
  }

  /** The plan if this exact completion event was already applied (a worker retry). */
  async completedWith(id: string, sequence: number): Promise<EditingPlanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(editingPlans)
      .where(and(eq(editingPlans.id, id), eq(editingPlans.status, 'COMPLETED'), eq(editingPlans.lastSequence, sequence)))
      .limit(1);
    return row;
  }

  async isGoneOrFinished(id: string): Promise<boolean> {
    const [row] = await this.db.select({ status: editingPlans.status }).from(editingPlans).where(eq(editingPlans.id, id)).limit(1);
    return !row || (FINISHED as readonly string[]).includes(row.status);
  }

  private async applyEvent(db: Pick<Database, 'update'>, id: string, sequence: number, changes: PgUpdateSetSource<typeof editingPlans>) {
    const [row] = await db
      .update(editingPlans)
      .set({ ...changes, lastSequence: sequence, updatedAt: sql`now()` })
      .where(and(eq(editingPlans.id, id), lt(editingPlans.lastSequence, sequence), notInArray(editingPlans.status, [...FINISHED])))
      .returning();
    return row;
  }
}
