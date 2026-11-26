import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { LOCAL_USER_ID } from '../src/common/current-user.js';
import type { Env } from '../src/config/env.js';
import { sourceVideos, type VideoStatus } from '../src/infrastructure/database/schema.js';
import type {
  AnalysisRunner,
  AnalysisState,
  StartAnalysisRequest,
  StartAnalysisResult,
} from '../src/infrastructure/grpc/ai-service.client.js';
import { MediaStorage } from '../src/infrastructure/storage/media-storage.js';
import type { EventsGateway } from '../src/modules/jobs/events.gateway.js';
import { JobEventsHandler } from '../src/modules/jobs/job-events.handler.js';
import { type Job, JobsRepository } from '../src/modules/jobs/jobs.repository.js';
import { JobsService } from '../src/modules/jobs/jobs.service.js';
import { ProjectsRepository } from '../src/modules/projects/projects.repository.js';
import { VideosRepository } from '../src/modules/videos/videos.repository.js';
import { TestDatabase } from './test-database.js';

/** Records what the API asked the AI service to do; answers are configurable. */
export class FakeRunner implements AnalysisRunner {
  started: StartAnalysisRequest[] = [];
  cancelled: string[] = [];
  startResult: StartAnalysisResult | Error = { accepted: true, errorCode: 'ERROR_CODE_UNSPECIFIED', errorMessage: '' };
  state: AnalysisState | Error = 'RUNNING';

  startAnalysis(request: StartAnalysisRequest): Promise<StartAnalysisResult> {
    this.started.push(request);
    return this.startResult instanceof Error ? Promise.reject(this.startResult) : Promise.resolve(this.startResult);
  }

  cancelAnalysis(jobId: string): Promise<boolean> {
    this.cancelled.push(jobId);
    return Promise.resolve(true);
  }

  getAnalysisStatus(): Promise<AnalysisState> {
    return this.state instanceof Error ? Promise.reject(this.state) : Promise.resolve(this.state);
  }
}

/** Collects what would have been pushed to the desktop over the WebSocket. */
export class RecordingGateway {
  pushed: Job[] = [];

  jobUpdated(job: Job): void {
    this.pushed.push(job);
  }
}

const config = { get: (key: keyof Env) => ({ FRAME_SAMPLE_INTERVAL: 1, FRAME_MAX_WIDTH: 768 })[key as string] };

export class JobsHarness {
  readonly database = new TestDatabase();
  readonly jobs = new JobsRepository(this.database.db);
  readonly videos = new VideosRepository(this.database.db);
  readonly projects = new ProjectsRepository(this.database.db);
  runner = new FakeRunner();
  gateway = new RecordingGateway();
  storage!: MediaStorage;
  dir = '';

  async setUp(): Promise<void> {
    await this.database.reset();
    this.dir = await mkdtemp(join(tmpdir(), 'clipforge-jobs-'));
    this.storage = new MediaStorage(join(this.dir, 'media'));
    this.runner = new FakeRunner();
    this.gateway = new RecordingGateway();
  }

  async tearDown(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  service(): JobsService {
    return new JobsService(
      this.jobs,
      this.videos,
      this.storage,
      this.runner,
      this.gateway as unknown as EventsGateway,
      config as unknown as ConfigService<Env, true>,
    );
  }

  handler(): JobEventsHandler {
    return new JobEventsHandler(this.jobs, this.gateway as unknown as EventsGateway);
  }

  /** A video row in the given status (READY by default), owned by `userId`. */
  async video(status: VideoStatus = 'READY', userId = LOCAL_USER_ID): Promise<{ videoId: string; projectId: string }> {
    const project = await this.projects.create(userId, { name: 'p', description: null });
    const videoId = randomUUID();
    await this.database.db.insert(sourceVideos).values({
      id: videoId,
      userId,
      projectId: project.id,
      filename: 'a.mp4',
      storagePath: `original-videos/${userId}/${project.id}/${videoId}/source.mp4`,
      fileSize: 1,
      mimeType: 'video/mp4',
      status,
    });
    return { videoId, projectId: project.id };
  }

  /** Writes frame files + frames.json where a completed job's artifacts say they are. */
  async writeFrames(framesPath: string, count: number): Promise<void> {
    const dir = this.storage.absolute(framesPath);
    await mkdir(dir, { recursive: true });
    const index = [];
    for (let i = 0; i < count; i++) {
      const file = `frame-${String(i + 1).padStart(6, '0')}.jpg`;
      await writeFile(join(dir, file), Buffer.from([0xff, 0xd8, 0xff, i]));
      index.push({ index: i, file, timestampSeconds: i });
    }
    await writeFile(join(dir, 'frames.json'), JSON.stringify(index));
  }
}
