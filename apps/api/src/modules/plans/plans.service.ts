import { randomUUID } from 'node:crypto';
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
import { isUniqueViolation } from '../../common/database-errors.js';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { AnalysesRepository } from '../jobs/analyses.repository.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { ClipsRepository } from './clips.repository.js';
import { type Plan, PlansRepository, toPlan } from './plans.repository.js';
import { type CreatePlan, DEFAULT_MAX_SECONDS, DEFAULT_MIN_SECONDS, defaultMaxClips } from './plans.schemas.js';
import { buildCues, transcriptWords } from './subtitles.js';

const UNAVAILABLE = 'Could not start: the AI service or its queue is unavailable';

/** Clip planning (system-design §4.7–4.10) on the latest completed analysis of a video. */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly plans: PlansRepository,
    private readonly clips: ClipsRepository,
    private readonly videos: VideosRepository,
    private readonly jobs: JobsRepository,
    private readonly analyses: AnalysesRepository,
    private readonly storage: MediaStorage,
    @Inject(ANALYSIS_RUNNER) private readonly runner: AnalysisRunner,
    private readonly gateway: EventsGateway,
  ) {}

  async create(userId: string, videoId: string, input: CreatePlan): Promise<Plan> {
    const video = await this.videos.findOwned(userId, videoId);
    if (!video) throw new NotFoundException('Video not found');
    const analysis = await this.analyses.latestForVideo(userId, videoId);
    const job = analysis && (await this.jobs.findOwned(userId, analysis.processingJobId));
    if (!job?.artifacts || !video.duration) throw new BadRequestException('Process this video first: planning uses its analysis');
    if (!job.artifacts.transcriptPath) throw new BadRequestException('Clip planning needs speech, and this video has no audio');
    const settings = {
      minSeconds: input.minSeconds ?? DEFAULT_MIN_SECONDS,
      maxSeconds: input.maxSeconds ?? DEFAULT_MAX_SECONDS,
      maxClips: input.maxClips ?? defaultMaxClips(video.duration),
    };
    if (settings.minSeconds > settings.maxSeconds) throw new BadRequestException('minSeconds must not be greater than maxSeconds');
    if (settings.minSeconds > video.duration) throw new BadRequestException('The video is shorter than the minimum clip length');
    const model = await this.plannerModel();

    const id = randomUUID();
    let row;
    try {
      row = await this.plans.create({
        id,
        sourceVideoId: video.id,
        processingJobId: job.id,
        userId,
        modelName: model,
        durationSeconds: video.duration,
        settings,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Clips are already being planned for this video');
      throw error;
    }
    const outputPath = join(this.storage.jobArtifactsPath(userId, video.projectId, video.id, job.id), 'plans', id);
    const started = await this.runner
      .startPlanning({
        planId: id,
        transcriptPath: job.artifacts.transcriptPath,
        visualPath: job.artifacts.visualPath,
        outputPath,
        durationSeconds: video.duration,
        model,
        ...settings,
      })
      .catch((error: unknown) => ({ accepted: false, errorCode: 'UNREACHABLE', errorMessage: String(error) }));
    if (!started.accepted) {
      this.logger.error(`could not start plan ${id}: ${started.errorCode} ${started.errorMessage}`);
      const failed = await this.plans.finish(id, { status: 'FAILED', errorCode: 'INTERNAL', errorMessage: UNAVAILABLE });
      if (failed) this.gateway.planUpdated(toPlan(failed));
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    return toPlan(row);
  }

  async listForVideo(userId: string, videoId: string): Promise<Plan[]> {
    if (!(await this.videos.findOwned(userId, videoId))) throw new NotFoundException('Video not found');
    return (await this.plans.listForVideo(userId, videoId)).map(toPlan);
  }

  async get(userId: string, id: string) {
    const row = await this.plans.findOwned(userId, id);
    if (!row) throw new NotFoundException('Plan not found');
    // The excerpt comes from the plan's own job (not the video's latest analysis) and from words inside the
    // clip's range (Whisper segments can be minutes long), by the same rule as its subtitles.
    const words = transcriptWords((await this.analyses.findByJob(row.processingJobId))?.transcript ?? null);
    const clips = (await this.clips.listForPlan(id)).map((clip) => ({
      ...clip,
      excerpt: buildCues(words, clip.startSeconds, clip.endSeconds)
        .map((cue) => cue.text)
        .join(' '),
    }));
    return { ...toPlan(row), clips };
  }

  async cancel(userId: string, id: string): Promise<Plan> {
    if (!(await this.plans.findOwned(userId, id))) throw new NotFoundException('Plan not found');
    const row = await this.plans.finish(id, { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled by the user' });
    if (!row) throw new ConflictException('This plan has already finished');
    this.gateway.planUpdated(toPlan(row));
    await this.runner.cancelAnalysis(id).catch((error: unknown) => {
      this.logger.warn(`cancel of plan ${id} not delivered: ${String(error)}`);
    });
    return toPlan(row);
  }

  /** The configured vision model, which also plans (spec decision: one model in VRAM). */
  private async plannerModel(): Promise<string> {
    const status = await this.runner.getModelStatus().catch(() => {
      throw new ServiceUnavailableException('The AI service is unavailable');
    });
    if (!status.runtimeReachable) throw new ServiceUnavailableException('Ollama is not running');
    if (!status.configuredVisionModelInstalled) {
      throw new BadRequestException(`${status.configuredVisionModel} is not installed. Run: ollama pull ${status.configuredVisionModel}`);
    }
    return status.configuredVisionModel;
  }
}
