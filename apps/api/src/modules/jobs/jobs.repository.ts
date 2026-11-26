import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import {
  type JobArtifacts,
  type JobStatus,
  processingJobs,
  type ProcessingJobRow,
  TERMINAL_JOB_STATUSES,
} from '../../infrastructure/database/schema.js';

export type Job = Omit<ProcessingJobRow, 'userId' | 'lastSequence'>;
export type ActiveStatus = Exclude<JobStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>;

export const ACTIVE_JOB_STATUSES: readonly ActiveStatus[] = [
  'PENDING',
  'VALIDATING',
  'EXTRACTING_MEDIA',
  'TRANSCRIBING',
  'ANALYZING_VISUALS',
];

export function toJob(row: ProcessingJobRow): Job {
  const { userId: _userId, lastSequence: _lastSequence, ...job } = row;
  return job;
}

/**
 * Persistence for processing jobs. Worker events go through `apply*`, which update only when the event's
 * sequence is newer than the last one applied AND the job is not finished, in one guarded UPDATE, so
 * duplicate, out-of-order and late events are dropped by the database itself.
 */
@Injectable()
export class JobsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(job: Pick<ProcessingJobRow, 'id' | 'sourceVideoId' | 'projectId' | 'userId'>): Promise<ProcessingJobRow> {
    const [row] = await this.db
      .insert(processingJobs)
      .values({ ...job, status: 'PENDING', stage: 'Waiting to start' })
      .returning();
    return row;
  }

  async findOwned(userId: string, id: string): Promise<ProcessingJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.id, id), eq(processingJobs.userId, userId)))
      .limit(1);
    return row;
  }

  listForVideo(userId: string, videoId: string): Promise<ProcessingJobRow[]> {
    return this.db
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.sourceVideoId, videoId), eq(processingJobs.userId, userId)))
      .orderBy(desc(processingJobs.createdAt));
  }

  async findActiveForVideo(videoId: string): Promise<ProcessingJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.sourceVideoId, videoId), inArray(processingJobs.status, [...ACTIVE_JOB_STATUSES])))
      .limit(1);
    return row;
  }

  /** Non-terminal jobs not updated for `seconds`: candidates for reconciliation. */
  findStale(seconds: number): Promise<ProcessingJobRow[]> {
    return this.db
      .select()
      .from(processingJobs)
      .where(
        and(
          inArray(processingJobs.status, [...ACTIVE_JOB_STATUSES]),
          lt(processingJobs.updatedAt, sql`now() - make_interval(secs => ${seconds})`),
        ),
      );
  }

  applyProgress(
    id: string,
    sequence: number,
    change: { status: ActiveStatus; stage: string; progress: number; message: string | null },
  ): Promise<ProcessingJobRow | undefined> {
    return this.applyEvent(id, sequence, { ...change, startedAt: sql`coalesce(${processingJobs.startedAt}, now())` });
  }

  applyCompletion(id: string, sequence: number, artifacts: JobArtifacts): Promise<ProcessingJobRow | undefined> {
    return this.applyEvent(id, sequence, {
      status: 'COMPLETED',
      stage: 'Completed',
      progress: 100,
      message: null,
      artifacts,
      completedAt: sql`now()`,
    });
  }

  applyFailure(
    id: string,
    sequence: number,
    failure: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string },
  ): Promise<ProcessingJobRow | undefined> {
    return this.applyEvent(id, sequence, { ...failure, stage: failure.status === 'CANCELLED' ? 'Cancelled' : 'Failed', completedAt: sql`now()` });
  }

  /** Ends a job from the NestJS side (user cancel, reconciliation). Later worker events are then ignored. */
  async finish(
    id: string,
    outcome: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorMessage: string },
  ): Promise<ProcessingJobRow | undefined> {
    const [row] = await this.db
      .update(processingJobs)
      .set({ ...outcome, stage: outcome.status === 'CANCELLED' ? 'Cancelled' : 'Failed', completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(processingJobs.id, id), notInArray(processingJobs.status, [...TERMINAL_JOB_STATUSES])))
      .returning();
    return row;
  }

  /** The job if this exact completion event was already applied: a worker retry (e.g. after an ack timeout). */
  async completedWith(id: string, sequence: number): Promise<ProcessingJobRow | undefined> {
    const [row] = await this.db
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'COMPLETED'), eq(processingJobs.lastSequence, sequence)))
      .limit(1);
    return row;
  }

  /** True when the worker should stop: the job was deleted (e.g. with its video) or already ended. */
  async isGoneOrFinished(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ status: processingJobs.status })
      .from(processingJobs)
      .where(eq(processingJobs.id, id))
      .limit(1);
    return !row || TERMINAL_JOB_STATUSES.includes(row.status);
  }

  private async applyEvent(
    id: string,
    sequence: number,
    changes: PgUpdateSetSource<typeof processingJobs>,
  ): Promise<ProcessingJobRow | undefined> {
    const [row] = await this.db
      .update(processingJobs)
      .set({ ...changes, lastSequence: sequence, updatedAt: sql`now()` })
      .where(
        and(
          eq(processingJobs.id, id),
          lt(processingJobs.lastSequence, sequence),
          notInArray(processingJobs.status, [...TERMINAL_JOB_STATUSES]),
        ),
      )
      .returning();
    return row;
  }
}
