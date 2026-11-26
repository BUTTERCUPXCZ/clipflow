import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LOCAL_USER_ID } from '../src/common/current-user.js';
import { MediaStorage } from '../src/infrastructure/storage/media-storage.js';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { ImportRegistry } from '../src/modules/videos/import/import-registry.js';
import { ImportValidator } from '../src/modules/videos/import/import-validator.js';
import { type CopyOptions, MediaCopier } from '../src/modules/videos/import/media-copier.js';
import { VideosRepository } from '../src/modules/videos/videos.repository.js';
import { VideosService } from '../src/modules/videos/videos.service.js';
import type { MediaProbe, ProbeResult } from '../src/infrastructure/grpc/ai-service.client.js';
import { FIXTURE_HEADERS } from './fixtures/containers.js';
import { TestDatabase } from './test-database.js';

/**
 * A copier the test drives: it waits for `open()`, then reports one progress tick, then copies.
 * It honours the abort signal like the real one, which makes delete-during-import deterministic.
 */
export class GatedCopier extends MediaCopier {
  private gate = Promise.withResolvers<void>();
  readonly started = Promise.withResolvers<void>();
  /** true only if the copy ran to the end (i.e. it was not cut short by an abort) */
  completed = false;
  signal: AbortSignal | undefined;

  open(): void {
    this.gate.resolve();
  }

  override async copy(source: string, destination: string, options: CopyOptions): Promise<void> {
    this.signal = options.signal;
    this.started.resolve();
    await this.gate.promise;
    await options.onProgress?.(1);
    await new Promise((resolve) => setTimeout(resolve, 10)); // let a progress-triggered abort land
    if (options.signal?.aborted) throw new Error('The operation was aborted');
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    this.completed = true;
  }
}

export const PLAYABLE: ProbeResult = {
  decodable: true,
  durationSeconds: 761.4,
  width: 1920,
  height: 1080,
  frameRate: 29.97,
  videoCodec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  errorCode: 'ERROR_CODE_UNSPECIFIED',
  errorMessage: '',
};

/** A MediaProbe whose answer the test sets (or a thrown error, to simulate the AI service being down). */
export class FakeProbe implements MediaProbe {
  answer: ProbeResult | Error = PLAYABLE;

  probeVideo(): Promise<ProbeResult> {
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer);
  }
}

/** Real repositories (clipforge_test), real validator and storage on a temp MEDIA_ROOT. */
export class VideosHarness {
  readonly database = new TestDatabase();
  readonly projects = new ProjectsRepository(this.database.db);
  readonly videos = new VideosRepository(this.database.db);
  dir = '';
  storage!: MediaStorage;
  registry!: ImportRegistry;
  probe = new FakeProbe();

  async setUp(): Promise<void> {
    await this.database.reset();
    this.dir = await mkdtemp(join(tmpdir(), 'clipforge-videos-'));
    this.storage = new MediaStorage(join(this.dir, 'media'));
    this.registry = new ImportRegistry();
    this.probe = new FakeProbe();
  }

  async tearDown(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  service(copier: MediaCopier = new MediaCopier(0)): VideosService {
    return new VideosService(
      this.videos,
      this.projects,
      this.storage,
      new ImportValidator(this.storage),
      copier,
      this.registry,
      this.probe,
    );
  }

  async project(userId = LOCAL_USER_ID): Promise<string> {
    return (await this.projects.create(userId, { name: 'Podcast', description: null })).id;
  }

  /** A small valid mp4 outside MEDIA_ROOT. */
  async sourceFile(name = 'episode.mp4', bytes: Buffer = FIXTURE_HEADERS.mp4): Promise<string> {
    const path = join(this.dir, name);
    await writeFile(path, bytes);
    return path;
  }
}
