import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { type ExperimentMetrics, type ExperimentRow, experiments } from '../../infrastructure/database/schema.js';

export type Experiment = Omit<ExperimentRow, 'userId' | 'lastSequence' | 'outputPath'>;

const FINISHED = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
const ACTIVE = ['PENDING', 'RUNNING'] as const;

export function toExperiment(row: ExperimentRow): Experiment {
  const { userId: _u, lastSequence: _s, outputPath: _o, ...experiment } = row;
  return experiment;
}

/** Same guarded-update rules as JobsRepository: newer sequence only, never once finished. */
@Injectable()
export class ExperimentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    experiment: Pick<ExperimentRow, 'id' | 'sourceVideoId' | 'processingJobId' | 'userId' | 'modelName' | 'promptVersion' | 'settings'>,
  ): Promise<ExperimentRow> {
    const [row] = await this.db.insert(experiments).values({ ...experiment, status: 'PENDING' }).returning();
    return row;
  }

  async findOwned(userId: string, id: string): Promise<ExperimentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(experiments)
      .where(and(eq(experiments.id, id), eq(experiments.userId, userId)))
      .limit(1);
    return row;
  }

  listForVideo(userId: string, videoId: string): Promise<ExperimentRow[]> {
    return this.db
      .select()
      .from(experiments)
      .where(and(eq(experiments.sourceVideoId, videoId), eq(experiments.userId, userId)))
      .orderBy(desc(experiments.createdAt));
  }

  findStale(seconds: number): Promise<ExperimentRow[]> {
    return this.db
      .select()
      .from(experiments)
      .where(
        and(
          inArray(experiments.status, [...ACTIVE]),
          lt(experiments.updatedAt, sql`now() - make_interval(secs => ${seconds})`),
        ),
      );
  }

  applyProgress(id: string, sequence: number, progress: number) {
    return this.applyEvent(id, sequence, { status: 'RUNNING', progress });
  }

  applyCompletion(id: string, sequence: number, result: { outputPath: string; output: unknown; metrics: ExperimentMetrics }) {
    return this.applyEvent(id, sequence, { ...result, status: 'COMPLETED', progress: 100, completedAt: sql`now()` });
  }

  applyFailure(id: string, sequence: number, failure: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    return this.applyEvent(id, sequence, { ...failure, completedAt: sql`now()` });
  }

  /** Ends an experiment from the NestJS side (user cancel, reconciliation). */
  async finish(id: string, outcome: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string }) {
    const [row] = await this.db
      .update(experiments)
      .set({ ...outcome, completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(experiments.id, id), notInArray(experiments.status, [...FINISHED])))
      .returning();
    return row;
  }

  /** The experiment if this exact completion event was already applied (a worker retry). */
  async completedWith(id: string, sequence: number): Promise<ExperimentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(experiments)
      .where(and(eq(experiments.id, id), eq(experiments.status, 'COMPLETED'), eq(experiments.lastSequence, sequence)))
      .limit(1);
    return row;
  }

  async isGoneOrFinished(id: string): Promise<boolean> {
    const [row] = await this.db.select({ status: experiments.status }).from(experiments).where(eq(experiments.id, id)).limit(1);
    return !row || (FINISHED as readonly string[]).includes(row.status);
  }

  private async applyEvent(id: string, sequence: number, changes: PgUpdateSetSource<typeof experiments>) {
    const [row] = await this.db
      .update(experiments)
      .set({ ...changes, lastSequence: sequence, updatedAt: sql`now()` })
      .where(and(eq(experiments.id, id), lt(experiments.lastSequence, sequence), notInArray(experiments.status, [...FINISHED])))
      .returning();
    return row;
  }
}
