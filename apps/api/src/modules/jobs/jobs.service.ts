import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { AnalysesRepository } from './analyses.repository.js';
import { EventsGateway } from './events.gateway.js';
import { ACTIVE_JOB_STATUSES, type Job, JobsRepository, toJob } from './jobs.repository.js';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

export interface FrameInfo {
  index: number;
  file: string;
  timestampSeconds: number;
}

/** User-facing job use cases: start, read, cancel, and the extracted frames of a completed job. */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly videos: VideosRepository,
    private readonly storage: MediaStorage,
    @Inject(ANALYSIS_RUNNER) private readonly runner: AnalysisRunner,
    private readonly gateway: EventsGateway,
    private readonly config: ConfigService<Env, true>,
    private readonly analyses: AnalysesRepository,
  ) {}

  /** 202 path: creates the job and hands it to the AI service's queue; the worker does the rest. */
  async process(userId: string, videoId: string): Promise<Job> {
    const video = await this.videos.findOwned(userId, videoId);
    if (!video) throw new NotFoundException('Video not found');
    if (video.status !== 'READY') throw new BadRequestException('Only a fully imported video can be processed');
    if (await this.jobs.findActiveForVideo(videoId)) {
      throw new ConflictException('This video is already being processed');
    }

    const id = randomUUID();
    const row = await this.jobs
      .create({ id, sourceVideoId: videoId, projectId: video.projectId, userId })
      .catch((error: unknown) => {
        // Lost a race with a concurrent request: the unique index allows one active job per video.
        if (isUniqueViolation(error)) throw new ConflictException('This video is already being processed');
        throw error;
      });
    const started = await this.runner
      .startAnalysis({
        jobId: id,
        storagePath: video.storagePath,
        artifactsPath: this.storage.jobArtifactsPath(userId, video.projectId, videoId, id),
        settings: {
          frameIntervalSeconds: this.config.get('FRAME_SAMPLE_INTERVAL', { infer: true }),
          frameMaxWidth: this.config.get('FRAME_MAX_WIDTH', { infer: true }),
        },
      })
      .catch((error: unknown) => ({ accepted: false, errorCode: 'UNREACHABLE', errorMessage: String(error) }));

    if (!started.accepted) {
      this.logger.error(`could not start job ${id}: ${started.errorCode} ${started.errorMessage}`);
      const failed = await this.jobs.finish(id, {
        status: 'FAILED',
        errorCode: 'INTERNAL',
        errorMessage: 'Could not start processing: the AI service or its queue is unavailable',
      });
      if (failed) this.gateway.jobUpdated(toJob(failed));
      throw new ServiceUnavailableException('Could not start processing: the AI service or its queue is unavailable');
    }
    return toJob(row);
  }

  async listForVideo(userId: string, videoId: string): Promise<Job[]> {
    if (!(await this.videos.findOwned(userId, videoId))) throw new NotFoundException('Video not found');
    return (await this.jobs.listForVideo(userId, videoId)).map(toJob);
  }

  /** The latest completed job's transcript and visual analysis for a video. */
  async analysis(userId: string, videoId: string) {
    if (!(await this.videos.findOwned(userId, videoId))) throw new NotFoundException('Video not found');
    const row = await this.analyses.latestForVideo(userId, videoId);
    if (!row) throw new NotFoundException('This video has not been analysed yet');
    const { userId: _userId, ...analysis } = row;
    return analysis;
  }

  async get(userId: string, id: string): Promise<Job> {
    return toJob(await this.owned(userId, id));
  }

  /** Ends the job at once (the UI updates immediately), then tells the worker; its late events are ignored. */
  async cancel(userId: string, id: string): Promise<Job> {
    const job = await this.owned(userId, id);
    if (!ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number])) {
      throw new ConflictException('This job has already finished');
    }
    const cancelled = await this.jobs.finish(id, {
      status: 'CANCELLED',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled by the user',
    });
    if (!cancelled) throw new ConflictException('This job has already finished');
    this.gateway.jobUpdated(toJob(cancelled));
    // Best effort: if the AI service is down, the worker still stops at its next progress report (ack.stop).
    await this.runner.cancelAnalysis(id).catch((error: unknown) => {
      this.logger.warn(`cancel of ${id} not delivered to the AI service: ${String(error)}`);
    });
    return toJob(cancelled);
  }

  async frames(userId: string, id: string): Promise<FrameInfo[]> {
    const framesDir = await this.framesDir(userId, id);
    const index = JSON.parse(await readFile(join(framesDir, 'frames.json'), 'utf8')) as FrameInfo[];
    return index.map(({ index: i, file, timestampSeconds }) => ({ index: i, file, timestampSeconds }));
  }

  /** Absolute path of one frame image, after checking ownership and that the index exists. */
  async framePath(userId: string, id: string, index: number): Promise<string> {
    const frame = (await this.frames(userId, id)).find((f) => f.index === index);
    if (!frame) throw new NotFoundException('Frame not found');
    // The file name comes from frames.json written by the worker; resolve it inside MEDIA_ROOT regardless.
    return this.storage.absolute(join((await this.owned(userId, id)).artifacts!.framesPath, frame.file));
  }

  private async framesDir(userId: string, id: string): Promise<string> {
    const job = await this.owned(userId, id);
    if (job.status !== 'COMPLETED' || !job.artifacts) throw new NotFoundException('This job has no frames');
    return this.storage.absolute(job.artifacts.framesPath);
  }

  private async owned(userId: string, id: string) {
    const job = await this.jobs.findOwned(userId, id);
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
