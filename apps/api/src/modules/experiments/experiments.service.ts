import { randomUUID } from 'node:crypto';
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
import { join } from 'node:path';
import type { Env } from '../../config/env.js';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { type Experiment, ExperimentsRepository, toExperiment } from './experiments.repository.js';
import type { CreateExperiment } from './experiments.schemas.js';

export const PROMPT_VERSION = 'visual-v2'; // keep equal to apps/ai-service/app/analysis/schemas.py

export interface VisionModel {
  name: string;
  sizeBytes: number;
  isDefault: boolean;
}

/** Model experiments (system-design §10): same frames and analyzer as processing, a chosen model. */
@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    private readonly experiments: ExperimentsRepository,
    private readonly videos: VideosRepository,
    private readonly jobs: JobsRepository,
    private readonly storage: MediaStorage,
    @Inject(ANALYSIS_RUNNER) private readonly runner: AnalysisRunner,
    private readonly gateway: EventsGateway,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Installed Ollama models that accept images. */
  async models(): Promise<VisionModel[]> {
    const status = await this.runner.getModelStatus().catch(() => {
      throw new ServiceUnavailableException('The AI service is unavailable');
    });
    if (!status.runtimeReachable) throw new ServiceUnavailableException('Ollama is not running');
    return status.installedModels
      .filter((m) => m.vision)
      .map((m) => ({ name: m.name, sizeBytes: m.sizeBytes, isDefault: m.name === status.configuredVisionModel }));
  }

  async create(userId: string, input: CreateExperiment): Promise<Experiment> {
    const video = await this.videos.findOwned(userId, input.videoId);
    if (!video) throw new NotFoundException('Video not found');
    const source = (await this.jobs.listForVideo(userId, input.videoId)).find((j) => j.status === 'COMPLETED' && j.artifacts);
    if (!source?.artifacts) throw new BadRequestException('Process this video first: experiments use its extracted frames');
    if (!(await this.models()).some((m) => m.name === input.model)) {
      throw new BadRequestException(`${input.model} is not an installed vision model`);
    }

    const id = randomUUID();
    const settings = {
      maxFrames: input.maxFrames ?? this.config.get('VISION_MAX_FRAMES', { infer: true }),
      batchSize: input.batchSize ?? this.config.get('VISION_BATCH_SIZE', { infer: true }),
    };
    const row = await this.experiments.create({
      id,
      sourceVideoId: video.id,
      processingJobId: source.id,
      userId,
      modelName: input.model,
      promptVersion: PROMPT_VERSION,
      settings,
    });
    const outputPath = join(this.storage.jobArtifactsPath(userId, video.projectId, video.id, source.id), 'experiments', id);
    const started = await this.runner
      .startExperiment({ experimentId: id, framesPath: source.artifacts.framesPath, outputPath, model: input.model, ...settings })
      .catch((error: unknown) => ({ accepted: false, errorCode: 'UNREACHABLE', errorMessage: String(error) }));
    if (!started.accepted) {
      this.logger.error(`could not start experiment ${id}: ${started.errorCode} ${started.errorMessage}`);
      const failed = await this.experiments.finish(id, {
        status: 'FAILED',
        errorCode: 'INTERNAL',
        errorMessage: 'Could not start: the AI service or its queue is unavailable',
      });
      if (failed) this.gateway.experimentUpdated(toExperiment(failed));
      throw new ServiceUnavailableException('Could not start: the AI service or its queue is unavailable');
    }
    return toExperiment(row);
  }

  async listForVideo(userId: string, videoId: string): Promise<Experiment[]> {
    if (!(await this.videos.findOwned(userId, videoId))) throw new NotFoundException('Video not found');
    return (await this.experiments.listForVideo(userId, videoId)).map(toExperiment);
  }

  async get(userId: string, id: string): Promise<Experiment> {
    const row = await this.experiments.findOwned(userId, id);
    if (!row) throw new NotFoundException('Experiment not found');
    return toExperiment(row);
  }

  async cancel(userId: string, id: string): Promise<Experiment> {
    await this.get(userId, id);
    const row = await this.experiments.finish(id, { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled by the user' });
    if (!row) throw new ConflictException('This experiment has already finished');
    this.gateway.experimentUpdated(toExperiment(row));
    await this.runner.cancelAnalysis(id).catch((error: unknown) => {
      this.logger.warn(`cancel of experiment ${id} not delivered: ${String(error)}`);
    });
    return toExperiment(row);
  }
}
