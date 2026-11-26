import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { MediaProbe } from '../../infrastructure/grpc/ai-service.client.js';
import { MEDIA_PROBE } from '../../infrastructure/grpc/grpc.module.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { ImportRegistry } from './import/import-registry.js';
import { ImportRejectedError, ImportValidator, type ValidatedFile } from './import/import-validator.js';
import { MediaCopier } from './import/media-copier.js';
import { toVideo, type Video, type VideoMetadata, type VideoRecord, VideosRepository } from './videos.repository.js';

type ProbeOutcome = { kind: 'ok'; metadata: VideoMetadata } | { kind: 'undecodable'; reason: string } | { kind: 'unknown' };

export const INTERRUPTED_MESSAGE = 'Import interrupted. Import the file again';

/**
 * Video use cases. An import is: validate → insert IMPORTING → copy in the background → READY or FAILED.
 * A copy stops on its own when its row disappears (video or project deleted), so deletes need no coupling.
 */
@Injectable()
export class VideosService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideosService.name);
  private readonly copies = new Set<Promise<void>>();

  constructor(
    private readonly videos: VideosRepository,
    private readonly projects: ProjectsRepository,
    private readonly storage: MediaStorage,
    private readonly validator: ImportValidator,
    private readonly copier: MediaCopier,
    private readonly registry: ImportRegistry,
    @Inject(MEDIA_PROBE) private readonly mediaProbe: MediaProbe,
  ) {}

  async startImport(userId: string, projectId: string, path: string): Promise<Video> {
    await this.ensureProject(userId, projectId);
    const file = await this.validator.validate(path).catch((error: unknown) => {
      throw error instanceof ImportRejectedError ? new BadRequestException(error.message) : error;
    });

    const id = randomUUID();
    const record = await this.videos.insertImporting({
      id,
      userId,
      projectId,
      filename: file.filename,
      storagePath: this.storage.sourceVideoPath(userId, projectId, id, file.extension),
      fileSize: file.size,
      mimeType: file.mime,
    });

    const copy = this.runCopy(record, file)
      // Never let a background copy reject unobserved: Node treats that as fatal and would exit the API.
      .catch((error: unknown) => this.logger.error(`import ${record.id} could not record its outcome: ${String(error)}`))
      .finally(() => this.copies.delete(copy));
    this.copies.add(copy);
    return toVideo(record);
  }

  async list(userId: string, projectId: string): Promise<Video[]> {
    await this.ensureProject(userId, projectId);
    return (await this.videos.listForProject(userId, projectId)).map(toVideo);
  }

  async get(userId: string, id: string): Promise<Video> {
    const record = await this.videos.findOwned(userId, id);
    if (!record) throw videoNotFound();
    return toVideo(record);
  }

  /** Deletes the row first (so a running copy sees it gone), then cancels the copy and removes the files. */
  async delete(userId: string, id: string): Promise<void> {
    const record = await this.videos.deleteOwned(userId, id);
    if (!record) throw videoNotFound();
    this.registry.abort(id);
    await this.removeFiles(record);
  }

  /** Imports still IMPORTING at boot belonged to a process that died: fail them and clear their files. */
  async onApplicationBootstrap(): Promise<void> {
    const stale = await this.videos.findByStatus('IMPORTING');
    for (const record of stale) {
      await this.videos.markFailed(record.id, INTERRUPTED_MESSAGE);
      await this.removeFiles(record);
    }
    if (stale.length) this.logger.warn(`marked ${stale.length} interrupted import(s) as failed`);
  }

  /** Resolves when every background copy has settled (used by tests). */
  async drain(): Promise<void> {
    await Promise.allSettled(this.copies);
  }

  private async runCopy(record: VideoRecord, file: ValidatedFile): Promise<void> {
    const signal = this.registry.start(record.id);
    try {
      await this.copier.copy(file.absolutePath, this.storage.absolute(record.storagePath), {
        expectedSize: file.size,
        signal,
        onProgress: (bytes) => this.reportProgress(record.id, bytes),
      });
      await this.finishImport(record, file);
    } catch (error) {
      if (!signal.aborted) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`import ${record.id} failed: ${reason}`);
        await this.videos.markFailed(record.id, `Import failed: ${reason}`);
      }
      await this.removeFiles(record);
    } finally {
      this.registry.finish(record.id);
    }
  }

  /** Probe before READY, so the video appears with its metadata or is rejected as unplayable. */
  private async finishImport(record: VideoRecord, file: ValidatedFile): Promise<void> {
    const probe = await this.probe(record);
    if (probe.kind === 'undecodable') {
      await this.videos.markFailed(record.id, `Not a playable video: ${probe.reason}`);
      await this.removeFiles(record);
      return;
    }
    const metadata = probe.kind === 'ok' ? probe.metadata : {};
    // false: the video was deleted while the last bytes were written or probed.
    if (!(await this.videos.markReady(record.id, file.size, metadata))) await this.removeFiles(record);
  }

  /** An unreachable AI service is not the file's fault: the video becomes READY without metadata. */
  private async probe(record: VideoRecord): Promise<ProbeOutcome> {
    try {
      const result = await this.mediaProbe.probeVideo(record.storagePath);
      if (result.decodable) {
        return {
          kind: 'ok',
          metadata: {
            duration: result.durationSeconds,
            width: result.width,
            height: result.height,
            frameRate: result.frameRate,
            videoCodec: result.videoCodec,
            audioCodec: result.audioCodec || null,
            hasAudio: result.hasAudio,
            container: result.container,
          },
        };
      }
      if (result.errorCode === 'ERROR_CODE_MEDIA_UNDECODABLE') return { kind: 'undecodable', reason: result.errorMessage };
      this.logger.error(`probe of ${record.id} failed: ${result.errorCode} ${result.errorMessage}`);
    } catch (error) {
      this.logger.warn(`AI service unavailable, ${record.id} stays without metadata: ${String(error)}`);
    }
    return { kind: 'unknown' };
  }

  private async reportProgress(id: string, bytes: number): Promise<void> {
    if (!(await this.videos.updateProgress(id, bytes))) this.registry.abort(id);
  }

  private async ensureProject(userId: string, projectId: string): Promise<void> {
    if (!(await this.projects.findOwned(userId, projectId))) throw new NotFoundException('Project not found');
  }

  private async removeFiles(record: VideoRecord): Promise<void> {
    await this.storage.removeVideoDir(record.userId, record.projectId, record.id).catch((error: unknown) => {
      this.logger.warn(`could not remove files of video ${record.id}: ${String(error)}`);
    });
  }
}

const videoNotFound = () => new NotFoundException('Video not found');
