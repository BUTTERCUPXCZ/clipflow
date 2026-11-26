import { readFile } from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { AnalysesRepository } from './analyses.repository.js';
import type { ProcessingJobRow } from '../../infrastructure/database/schema.js';
import { EventsGateway } from './events.gateway.js';
import { type ActiveStatus, JobsRepository, toJob } from './jobs.repository.js';

/** Decoded JobEventsService requests (proto-loader: camelCase, enums as strings, longs as numbers). */
export interface ProgressEvent {
  jobId: string;
  sequence: number;
  status:
    | 'JOB_STATUS_VALIDATING'
    | 'JOB_STATUS_EXTRACTING_MEDIA'
    | 'JOB_STATUS_TRANSCRIBING'
    | 'JOB_STATUS_ANALYZING_VISUALS'
    | 'JOB_STATUS_UNSPECIFIED';
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
    transcriptPath: string;
    visualPath: string;
    validBatches: number;
    totalBatches: number;
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
  JOB_STATUS_TRANSCRIBING: 'TRANSCRIBING',
  JOB_STATUS_ANALYZING_VISUALS: 'ANALYZING_VISUALS',
};

/** Applies worker events (NestJS is the only DB writer) and forwards every applied change to the desktop. */
@Injectable()
export class JobEventsHandler {
  private readonly logger = new Logger(JobEventsHandler.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly gateway: EventsGateway,
    private readonly analyses: AnalysesRepository,
    private readonly storage: MediaStorage,
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

  /** Reads the worker's result files first: a completed job always has its analysis stored with it. */
  async completion(event: CompletionEvent): Promise<Ack> {
    const a = event.artifacts;
    let results: { transcript: unknown; visual: Record<string, unknown> };
    try {
      results = {
        transcript: a.transcriptPath ? await this.readJson(a.transcriptPath) : null,
        visual: (await this.readJson(a.visualPath)) as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(`job ${event.jobId}: unreadable analysis files: ${String(error)}`);
      // stop: the job is now FAILED, so the worker must remove its files.
      const ack = await this.failure({
        jobId: event.jobId,
        sequence: event.sequence,
        errorCode: 'JOB_ERROR_CODE_INTERNAL',
        errorMessage: 'The analysis results could not be read',
      });
      return { ...ack, stop: true };
    }
    const applied = await this.jobs.applyCompletion(event.jobId, event.sequence, {
        hasAudio: a.hasAudio,
        audioPath: a.hasAudio ? a.audioPath : null,
        audioDurationSeconds: a.hasAudio ? a.audioDurationSeconds : null,
        frameCount: a.frameCount,
        frameIntervalSeconds: a.frameIntervalSeconds,
        framesPath: a.framesPath,
        transcriptPath: a.transcriptPath || null,
        visualPath: a.visualPath,
        validBatches: a.validBatches,
        totalBatches: a.totalBatches,
    });
    // A retried completion is a success, not a refusal: answering stop would make the worker delete
    // a completed job's files. The insert is idempotent, so a retry also heals a failed insert.
    const row = applied ?? (await this.jobs.completedWith(event.jobId, event.sequence));
    if (row) {
      await this.analyses.insert({
        sourceVideoId: row.sourceVideoId,
        processingJobId: row.id,
        userId: row.userId,
        transcript: results.transcript,
        visualAnalysis: results.visual,
        modelMetadata: {
          visionModel: results.visual.model,
          promptVersion: results.visual.promptVersion,
          metrics: results.visual.metrics,
        },
      });
    }
    return this.ack(event.jobId, row);
  }

  private async readJson(relativePath: string): Promise<unknown> {
    return JSON.parse(await readFile(this.storage.absolute(relativePath), 'utf8')) as unknown;
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
