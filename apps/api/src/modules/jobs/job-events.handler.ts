import { Injectable } from '@nestjs/common';
import type { ProcessingJobRow } from '../../infrastructure/database/schema.js';
import { EventsGateway } from './events.gateway.js';
import { type ActiveStatus, JobsRepository, toJob } from './jobs.repository.js';

/** Decoded JobEventsService requests (proto-loader: camelCase, enums as strings, longs as numbers). */
export interface ProgressEvent {
  jobId: string;
  sequence: number;
  status: 'JOB_STATUS_VALIDATING' | 'JOB_STATUS_EXTRACTING_MEDIA' | 'JOB_STATUS_UNSPECIFIED';
  stage: string;
  progress: number;
  message: string;
}

export interface CompletionEvent {
  jobId: string;
  sequence: number;
  artifacts: {
    hasAudio: boolean;
    audioPath: string;
    audioDurationSeconds: number;
    frameCount: number;
    frameIntervalSeconds: number;
    framesPath: string;
  };
}

export interface FailureEvent {
  jobId: string;
  sequence: number;
  errorCode: string; // JOB_ERROR_CODE_*
  errorMessage: string;
}

export interface Ack {
  applied: boolean;
  /** Tells the worker to stop: the job was deleted (e.g. with its video) or already ended. */
  stop: boolean;
}

const STATUS: Record<string, ActiveStatus> = {
  JOB_STATUS_VALIDATING: 'VALIDATING',
  JOB_STATUS_EXTRACTING_MEDIA: 'EXTRACTING_MEDIA',
};

/** Applies worker events (NestJS is the only DB writer) and forwards every applied change to the desktop. */
@Injectable()
export class JobEventsHandler {
  constructor(
    private readonly jobs: JobsRepository,
    private readonly gateway: EventsGateway,
  ) {}

  async progress(event: ProgressEvent): Promise<Ack> {
    const status = STATUS[event.status];
    if (!status) return { applied: false, stop: false };
    const progress = Math.max(0, Math.min(100, Math.round(event.progress)));
    return this.ack(
      event.jobId,
      await this.jobs.applyProgress(event.jobId, event.sequence, {
        status,
        stage: event.stage,
        progress,
        message: event.message || null,
      }),
    );
  }

  async completion(event: CompletionEvent): Promise<Ack> {
    const a = event.artifacts;
    return this.ack(
      event.jobId,
      await this.jobs.applyCompletion(event.jobId, event.sequence, {
        hasAudio: a.hasAudio,
        audioPath: a.hasAudio ? a.audioPath : null,
        audioDurationSeconds: a.hasAudio ? a.audioDurationSeconds : null,
        frameCount: a.frameCount,
        frameIntervalSeconds: a.frameIntervalSeconds,
        framesPath: a.framesPath,
      }),
    );
  }

  async failure(event: FailureEvent): Promise<Ack> {
    const code = event.errorCode.replace('JOB_ERROR_CODE_', '');
    return this.ack(
      event.jobId,
      await this.jobs.applyFailure(event.jobId, event.sequence, {
        status: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        errorCode: code,
        errorMessage: event.errorMessage,
      }),
    );
  }

  private async ack(jobId: string, row: ProcessingJobRow | undefined): Promise<Ack> {
    if (row) {
      this.gateway.jobUpdated(toJob(row));
      return { applied: true, stop: false };
    }
    return { applied: false, stop: await this.jobs.isGoneOrFinished(jobId) };
  }
}
