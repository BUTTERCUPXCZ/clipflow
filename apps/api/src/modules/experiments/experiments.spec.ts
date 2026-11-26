import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import type { Env } from '../../config/env.js';
import type { EventsGateway } from '../jobs/events.gateway.js';
import { ExperimentEventsHandler } from './experiment-events.js';
import { ExperimentsRepository } from './experiments.repository.js';
import { ExperimentsService } from './experiments.service.js';

const config = { get: (key: string) => ({ VISION_MAX_FRAMES: 60, VISION_BATCH_SIZE: 4 })[key] } as unknown as ConfigService<Env, true>;

describe('experiments (clipforge_test)', () => {
  const h = new JobsHarness();
  const repo = new ExperimentsRepository(h.database.db);

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  const service = () =>
    new ExperimentsService(repo, h.videos, h.jobs, h.storage, h.runner, h.gateway as unknown as EventsGateway, config);
  const handler = () => new ExperimentEventsHandler(repo, h.gateway as unknown as EventsGateway, h.storage);

  /** A READY video whose latest job completed with frames. */
  async function processedVideo() {
    const { videoId, projectId } = await h.video();
    const job = await h.service().process(LOCAL_USER_ID, videoId);
    await h.jobs.applyCompletion(job.id, 1, {
      hasAudio: false, audioPath: null, audioDurationSeconds: null, frameCount: 10, frameIntervalSeconds: 1,
      framesPath: 'analysis/x/frames', transcriptPath: null, visualPath: 'analysis/x/visual.json', validBatches: 1, totalBatches: 1,
    });
    return { videoId, projectId, jobId: job.id };
  }

  it('lists only installed models that accept images, marking the default', async () => {
    expect(await service().models()).toEqual([{ name: 'qwen3-vl:8b-instruct', sizeBytes: 6e9, isDefault: true }]);
  });

  it('queues an experiment on the processed frames with the given settings', async () => {
    const { videoId, projectId, jobId } = await processedVideo();

    const experiment = await service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct', batchSize: 1 });

    expect(experiment).toMatchObject({ status: 'PENDING', modelName: 'qwen3-vl:8b-instruct', settings: { maxFrames: 60, batchSize: 1 } });
    expect(h.runner.experiments).toEqual([
      {
        experimentId: experiment.id,
        framesPath: 'analysis/x/frames',
        outputPath: `analysis/${LOCAL_USER_ID}/${projectId}/${videoId}/${jobId}/experiments/${experiment.id}`,
        model: 'qwen3-vl:8b-instruct',
        maxFrames: 60,
        batchSize: 1,
      },
    ]);
  });

  it('refuses a video that has not been processed, and a model that is not an installed vision model', async () => {
    const { videoId } = await h.video();
    await expect(service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' })).rejects.toBeInstanceOf(BadRequestException);

    const processed = await processedVideo();
    await expect(service().create(LOCAL_USER_ID, { videoId: processed.videoId, model: 'gemma3:1b' })).rejects.toThrow(
      /not an installed vision model/,
    );
  });

  it('fails the experiment and answers 503 when the AI service cannot take it', async () => {
    const { videoId } = await processedVideo();
    h.runner.startResult = new Error('14 UNAVAILABLE');

    await expect(service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect((await service().listForVideo(LOCAL_USER_ID, videoId))[0]).toMatchObject({ status: 'FAILED' });
  });

  it('applies progress and completion (reading the output file) and pushes them live', async () => {
    const { videoId } = await processedVideo();
    const { id } = await service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' });
    const outputPath = 'analysis/x/experiments/e/visual.json';
    await mkdir(dirname(h.storage.absolute(outputPath)), { recursive: true });
    await writeFile(h.storage.absolute(outputPath), JSON.stringify({ scenes: [{ description: 'x' }] }));

    expect(await handler().progress({ experimentId: id, sequence: 1, progress: 150, message: '' })).toEqual({ applied: true, stop: false });
    await handler().completion({
      experimentId: id,
      sequence: 2,
      outputPath,
      metrics: { loadMs: 1, inferenceMs: 2, totalMs: 3, peakVramMib: -1, framesAnalysed: 4, validBatches: 1, totalBatches: 1 },
    });

    const done = await service().get(LOCAL_USER_ID, id);
    expect(done).toMatchObject({ status: 'COMPLETED', progress: 100, output: { scenes: [{ description: 'x' }] } });
    expect(done.metrics).toMatchObject({ peakVramMiB: null, framesAnalysed: 4 });
    expect(h.gateway.experiments.map((e) => e.status)).toEqual(['RUNNING', 'COMPLETED'])
  });

  it('ignores stale progress, acks a retried completion, and stops the worker on unreadable output', async () => {
    const { videoId } = await processedVideo();
    const { id } = await service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' });
    const outputPath = 'analysis/x/experiments/r/visual.json';
    await mkdir(dirname(h.storage.absolute(outputPath)), { recursive: true });
    await writeFile(h.storage.absolute(outputPath), JSON.stringify({ scenes: [] }));
    const metrics = { loadMs: 1, inferenceMs: 2, totalMs: 3, peakVramMib: 10, framesAnalysed: 1, validBatches: 1, totalBatches: 1 };

    await handler().progress({ experimentId: id, sequence: 5, progress: 50, message: '' });
    expect(await handler().progress({ experimentId: id, sequence: 5, progress: 60, message: '' })).toEqual({ applied: false, stop: false });
    expect((await service().get(LOCAL_USER_ID, id)).progress).toBe(50);

    const completion = { experimentId: id, sequence: 6, outputPath, metrics };
    await handler().completion(completion);
    expect(await handler().completion(completion)).toEqual({ applied: true, stop: false });

    const other = await service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' });
    expect(await handler().completion({ ...completion, experimentId: other.id, outputPath: 'analysis/x/missing.json' })).toEqual({
      applied: true,
      stop: true,
    });
    expect(await service().get(LOCAL_USER_ID, other.id)).toMatchObject({ status: 'FAILED' });
  });

  it('cancels once, then refuses, and tells the worker to stop', async () => {
    const { videoId } = await processedVideo();
    const { id } = await service().create(LOCAL_USER_ID, { videoId, model: 'qwen3-vl:8b-instruct' });

    expect(await service().cancel(LOCAL_USER_ID, id)).toMatchObject({ status: 'CANCELLED' });
    await expect(service().cancel(LOCAL_USER_ID, id)).rejects.toBeInstanceOf(ConflictException);
    expect(await handler().progress({ experimentId: id, sequence: 9, progress: 5, message: '' })).toEqual({ applied: false, stop: true });
    expect(h.runner.cancelled).toContain(id);
  });
});
