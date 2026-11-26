import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { isUniqueViolation } from '../../common/database-errors.js';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { AnalysesRepository } from '../jobs/analyses.repository.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { ClipsRepository } from '../plans/clips.repository.js';
import { PlansRepository } from '../plans/plans.repository.js';
import { buildCues, transcriptWords } from '../plans/subtitles.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { type Render, RendersRepository, toRender } from './renders.repository.js';

const UNAVAILABLE = 'Could not start: the AI service or its queue is unavailable';

/** Rendering a completed plan's kept clips (system-design §4.11–4.13). */
@Injectable()
export class RendersService {
  private readonly logger = new Logger(RendersService.name);

  constructor(
    private readonly renders: RendersRepository,
    private readonly plans: PlansRepository,
    private readonly clips: ClipsRepository,
    private readonly videos: VideosRepository,
    private readonly jobs: JobsRepository,
    private readonly analyses: AnalysesRepository,
    private readonly storage: MediaStorage,
    @Inject(ANALYSIS_RUNNER) private readonly runner: AnalysisRunner,
    private readonly gateway: EventsGateway,
  ) {}

  async create(userId: string, planId: string, settings: { subtitles: boolean }): Promise<Render> {
    const plan = await this.plans.findOwned(userId, planId);
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== 'COMPLETED') throw new BadRequestException('Only a completed plan can be rendered');
    const kept = (await this.clips.listForPlan(planId)).filter((c) => !c.removedAt);
    if (!kept.length) throw new BadRequestException('Every clip of this plan was removed: nothing to render');
    const video = await this.videos.findOwned(userId, plan.sourceVideoId);
    const job = await this.jobs.findOwned(userId, plan.processingJobId);
    if (!video || !job) throw new NotFoundException('The video of this plan no longer exists');

    const id = randomUUID();
    let row;
    try {
      const snapshot = kept.map((c) => ({ id: c.id, title: c.title, startSeconds: c.startSeconds, endSeconds: c.endSeconds }));
      row = await this.renders.create({
        id,
        planId,
        sourceVideoId: video.id,
        userId,
        settings: { subtitles: settings.subtitles, clips: snapshot },
        clipCount: kept.length,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Clips of this video are already being rendered');
      throw error;
    }
    // Cues are built here, by the same function the subtitles endpoint uses: one rule for what is shown.
    const words = transcriptWords((await this.analyses.findByJob(job.id))?.transcript ?? null);
    const started = await this.runner
      .startRendering({
        renderId: id,
        sourcePath: video.storagePath,
        outputPath: join(this.storage.jobArtifactsPath(userId, video.projectId, video.id, job.id), 'renders', id),
        subtitles: settings.subtitles,
        clips: kept.map((c) => ({
          clipId: c.id,
          start: c.startSeconds,
          end: c.endSeconds,
          cues: settings.subtitles ? buildCues(words, c.startSeconds, c.endSeconds) : [],
        })),
      })
      .catch((error: unknown) => ({ accepted: false, errorCode: 'UNREACHABLE', errorMessage: String(error) }));
    if (!started.accepted) {
      this.logger.error(`could not start render ${id}: ${started.errorCode} ${started.errorMessage}`);
      const failed = await this.renders.finish(id, { status: 'FAILED', errorCode: 'INTERNAL', errorMessage: UNAVAILABLE });
      if (failed) this.gateway.renderUpdated(toRender(failed));
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
    return toRender(row);
  }

  async listForPlan(userId: string, planId: string): Promise<Render[]> {
    if (!(await this.plans.findOwned(userId, planId))) throw new NotFoundException('Plan not found');
    return (await this.renders.listForPlan(userId, planId)).map(toRender);
  }

  async get(userId: string, id: string) {
    const row = await this.renders.findOwned(userId, id);
    if (!row) throw new NotFoundException('Render not found');
    return { ...toRender(row), clips: (await this.renders.clipsOf(id)).map(publicClip) };
  }

  async cancel(userId: string, id: string): Promise<Render> {
    if (!(await this.renders.findOwned(userId, id))) throw new NotFoundException('Render not found');
    const row = await this.renders.finish(id, { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'Cancelled by the user' });
    if (!row) throw new ConflictException('This render has already finished');
    this.gateway.renderUpdated(toRender(row));
    await this.runner.cancelAnalysis(id).catch((error: unknown) => this.logger.warn(`cancel of render ${id} not delivered: ${String(error)}`));
    return toRender(row);
  }

  /** All rendered clips of the user (the Clips page). */
  async gallery(userId: string) {
    return (await this.renders.listClips(userId)).map(({ clip, videoId, videoName, projectId }) => ({
      ...publicClip(clip),
      videoId,
      videoName,
      projectId,
    }));
  }
}

/** Storage paths stay server-side; the desktop uses the file and thumbnail endpoints. */
export function publicClip<T extends { filePath: string; thumbnailPath: string }>(clip: T): Omit<T, 'filePath' | 'thumbnailPath'> {
  const { filePath: _f, thumbnailPath: _t, ...rest } = clip;
  return rest;
}
