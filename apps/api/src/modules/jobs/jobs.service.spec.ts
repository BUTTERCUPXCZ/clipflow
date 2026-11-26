import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';

const OTHER_USER = '00000000-0000-4000-8000-00000000beef';

describe('JobsService (clipforge_test)', () => {
  const h = new JobsHarness();

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  it('creates a PENDING job and hands it to the AI service with relative paths and frame settings', async () => {
    const { videoId, projectId } = await h.video();

    const job = await h.service().process(LOCAL_USER_ID, videoId);

    expect(job).toMatchObject({ status: 'PENDING', sourceVideoId: videoId });
    expect(job).not.toHaveProperty('userId');
    expect(h.runner.started).toEqual([
      {
        jobId: job.id,
        storagePath: `original-videos/${LOCAL_USER_ID}/${projectId}/${videoId}/source.mp4`,
        artifactsPath: `analysis/${LOCAL_USER_ID}/${projectId}/${videoId}/${job.id}`,
        settings: { frameIntervalSeconds: 1, frameMaxWidth: 768 },
      },
    ]);
  });

  it('refuses a video that is not fully imported', async () => {
    const { videoId } = await h.video('IMPORTING');

    await expect(h.service().process(LOCAL_USER_ID, videoId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second job while one is active, and allows one after it ends', async () => {
    const { videoId } = await h.video();
    const service = h.service();
    const first = await service.process(LOCAL_USER_ID, videoId);

    await expect(service.process(LOCAL_USER_ID, videoId)).rejects.toBeInstanceOf(ConflictException);
    await service.cancel(LOCAL_USER_ID, first.id);
    await expect(service.process(LOCAL_USER_ID, videoId)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('lets only one of two concurrent requests start a job (database unique index)', async () => {
    const { videoId } = await h.video();
    const service = h.service();

    const results = await Promise.allSettled([service.process(LOCAL_USER_ID, videoId), service.process(LOCAL_USER_ID, videoId)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(await service.listForVideo(LOCAL_USER_ID, videoId)).toHaveLength(1);
  });

  it('404s for another user\'s video or job', async () => {
    await h.database.createUser(OTHER_USER);
    const { videoId } = await h.video('READY', OTHER_USER);
    const theirs = await h.jobs.create({ id: randomUUID(), sourceVideoId: videoId, projectId: randomUUID(), userId: OTHER_USER });

    await expect(h.service().process(LOCAL_USER_ID, videoId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service().get(LOCAL_USER_ID, theirs.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service().cancel(LOCAL_USER_ID, theirs.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails the job and answers 503 when the AI service cannot take it', async () => {
    const { videoId } = await h.video();
    h.runner.startResult = new Error('14 UNAVAILABLE');

    await expect(h.service().process(LOCAL_USER_ID, videoId)).rejects.toBeInstanceOf(ServiceUnavailableException);

    const [job] = await h.service().listForVideo(LOCAL_USER_ID, videoId);
    expect(job).toMatchObject({ status: 'FAILED', errorCode: 'INTERNAL' });
    expect(h.gateway.pushed.at(-1)?.status).toBe('FAILED');
  });

  it('cancels at once, pushes the change, and tells the worker', async () => {
    const { videoId } = await h.video();
    const service = h.service();
    const job = await service.process(LOCAL_USER_ID, videoId);

    const cancelled = await service.cancel(LOCAL_USER_ID, job.id);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', errorMessage: 'Cancelled by the user' });
    expect(h.gateway.pushed.map((j) => j.status)).toEqual(['CANCELLED']);
    expect(h.runner.cancelled).toEqual([job.id]);
    await expect(service.cancel(LOCAL_USER_ID, job.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('serves the frame list and frame files of a completed job only', async () => {
    const { videoId } = await h.video();
    const service = h.service();
    const job = await service.process(LOCAL_USER_ID, videoId);
    await expect(service.frames(LOCAL_USER_ID, job.id)).rejects.toBeInstanceOf(NotFoundException);

    const framesPath = `analysis/x/${job.id}/frames`;
    await h.writeFrames(framesPath, 3);
    await h.jobs.applyCompletion(job.id, 1, {
      hasAudio: false,
      audioPath: null,
      audioDurationSeconds: null,
      frameCount: 3,
      frameIntervalSeconds: 1,
      framesPath,
      transcriptPath: null,
      visualPath: 'x/visual.json',
      validBatches: 1,
      totalBatches: 1,
    });

    expect(await service.frames(LOCAL_USER_ID, job.id)).toEqual([
      { index: 0, file: 'frame-000001.jpg', timestampSeconds: 0 },
      { index: 1, file: 'frame-000002.jpg', timestampSeconds: 1 },
      { index: 2, file: 'frame-000003.jpg', timestampSeconds: 2 },
    ]);
    expect(await service.framePath(LOCAL_USER_ID, job.id, 2)).toBe(h.storage.absolute(`${framesPath}/frame-000003.jpg`));
    await expect(service.framePath(LOCAL_USER_ID, job.id, 3)).rejects.toBeInstanceOf(NotFoundException);
  });
});
