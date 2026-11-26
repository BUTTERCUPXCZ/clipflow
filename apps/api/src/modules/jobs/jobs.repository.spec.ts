import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { processingJobs, sourceVideos } from '../../infrastructure/database/schema.js';

const ARTIFACTS = {
  hasAudio: true,
  audioPath: 'analysis/a.wav',
  audioDurationSeconds: 3,
  frameCount: 3,
  frameIntervalSeconds: 1,
  framesPath: 'analysis/frames',
};

describe('JobsRepository (clipforge_test)', () => {
  const h = new JobsHarness();

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  async function job() {
    const { videoId, projectId } = await h.video();
    return h.jobs.create({ id: randomUUID(), sourceVideoId: videoId, projectId, userId: LOCAL_USER_ID });
  }
  const progress = (status: 'VALIDATING' | 'EXTRACTING_MEDIA', pct: number) => ({
    status,
    stage: status,
    progress: pct,
    message: null,
  });

  it('starts PENDING and records progress with a start time', async () => {
    const created = await job();
    expect(created).toMatchObject({ status: 'PENDING', progress: 0, startedAt: null });

    const row = await h.jobs.applyProgress(created.id, 1, progress('VALIDATING', 3));

    expect(row).toMatchObject({ status: 'VALIDATING', progress: 3, lastSequence: 1 });
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  it('ignores duplicate and out-of-order events', async () => {
    const created = await job();
    await h.jobs.applyProgress(created.id, 5, progress('EXTRACTING_MEDIA', 50));

    expect(await h.jobs.applyProgress(created.id, 5, progress('EXTRACTING_MEDIA', 51))).toBeUndefined();
    expect(await h.jobs.applyProgress(created.id, 4, progress('VALIDATING', 1))).toBeUndefined();
    expect(await h.jobs.findOwned(LOCAL_USER_ID, created.id)).toMatchObject({ status: 'EXTRACTING_MEDIA', progress: 50 });
  });

  it('never changes a finished job, whatever the sequence', async () => {
    const created = await job();
    await h.jobs.applyCompletion(created.id, 2, ARTIFACTS);

    expect(await h.jobs.applyProgress(created.id, 99, progress('EXTRACTING_MEDIA', 10))).toBeUndefined();
    expect(await h.jobs.applyFailure(created.id, 100, { status: 'FAILED', errorCode: 'X', errorMessage: 'late' })).toBeUndefined();
    expect(await h.jobs.finish(created.id, { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'x' })).toBeUndefined();
    expect(await h.jobs.findOwned(LOCAL_USER_ID, created.id)).toMatchObject({ status: 'COMPLETED', artifacts: ARTIFACTS });
  });

  it('knows when the worker should stop', async () => {
    const created = await job();
    expect(await h.jobs.isGoneOrFinished(created.id)).toBe(false);

    await h.jobs.finish(created.id, { status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: 'x' });
    expect(await h.jobs.isGoneOrFinished(created.id)).toBe(true);
    expect(await h.jobs.isGoneOrFinished(randomUUID())).toBe(true);
  });

  it('is deleted with its video', async () => {
    const created = await job();

    await h.database.db.delete(sourceVideos).where(eq(sourceVideos.id, created.sourceVideoId));

    expect(await h.jobs.findOwned(LOCAL_USER_ID, created.id)).toBeUndefined();
  });

  it('finds only active jobs that have not moved for a while', async () => {
    const stale = await job();
    const fresh = await job();
    const done = await job();
    await h.jobs.applyCompletion(done.id, 1, ARTIFACTS);
    await h.database.db
      .update(processingJobs)
      .set({ updatedAt: sql`now() - interval '2 minutes'` })
      .where(sql`${processingJobs.id} in (${stale.id}, ${done.id})`);

    expect((await h.jobs.findStale(30)).map((j) => j.id)).toEqual([stale.id]);
    expect((await h.jobs.findActiveForVideo(fresh.sourceVideoId))?.id).toBe(fresh.id);
  });
});
