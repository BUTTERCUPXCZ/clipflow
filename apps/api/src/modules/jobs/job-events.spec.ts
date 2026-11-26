import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { processingJobs } from '../../infrastructure/database/schema.js';
import { INTERRUPTED_MESSAGE, JobsReconciler } from './jobs.reconciler.js';

describe('JobEventsHandler and JobsReconciler (clipforge_test)', () => {
  const h = new JobsHarness();

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  async function job() {
    const { videoId } = await h.video();
    return h.service().process(LOCAL_USER_ID, videoId);
  }
  const progress = (jobId: string, sequence: number, pct: number) => ({
    jobId,
    sequence,
    status: 'JOB_STATUS_EXTRACTING_MEDIA' as const,
    stage: 'Extracting audio and frames',
    progress: pct,
    message: '',
  });

  it('applies progress and pushes it to the desktop', async () => {
    const { id } = await job();

    expect(await h.handler().progress(progress(id, 1, 42))).toEqual({ applied: true, stop: false });
    expect(h.gateway.pushed.at(-1)).toMatchObject({ id, status: 'EXTRACTING_MEDIA', progress: 42 });
  });

  it('clamps out-of-range progress instead of failing the event', async () => {
    const { id } = await job();

    expect(await h.handler().progress(progress(id, 1, 150))).toEqual({ applied: true, stop: false });
    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({ progress: 100 });
    expect(await h.handler().progress(progress(id, 2, -5))).toEqual({ applied: true, stop: false });
    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({ progress: 0 });
  });

  it('ignores an event with an unknown status without using up its sequence', async () => {
    const { id } = await job();

    const unknown = { ...progress(id, 5, 50), status: 'JOB_STATUS_UNSPECIFIED' as const };
    expect(await h.handler().progress(unknown)).toEqual({ applied: false, stop: false });
    expect(await h.handler().progress(progress(id, 1, 10))).toEqual({ applied: true, stop: false });
    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({ status: 'EXTRACTING_MEDIA', progress: 10 });
  });

  it('drops a stale event without telling the worker to stop', async () => {
    const { id } = await job();
    await h.handler().progress(progress(id, 2, 50));

    expect(await h.handler().progress(progress(id, 1, 10))).toEqual({ applied: false, stop: false });
    expect(h.gateway.pushed).toHaveLength(1);
  });

  it('tells the worker to stop once the job is gone or finished', async () => {
    const { id } = await job();
    await h.service().cancel(LOCAL_USER_ID, id);

    expect(await h.handler().progress(progress(id, 3, 60))).toEqual({ applied: false, stop: true });
    expect(await h.handler().progress(progress(randomUUID(), 1, 1))).toEqual({ applied: false, stop: true });
  });

  it('stores the artifacts of a completed job', async () => {
    const { id } = await job();

    await h.handler().completion({
      jobId: id,
      sequence: 4,
      artifacts: { hasAudio: false, audioPath: '', audioDurationSeconds: 0, frameCount: 9, frameIntervalSeconds: 1, framesPath: 'a/f' },
    });

    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
      artifacts: { hasAudio: false, audioPath: null, audioDurationSeconds: null, frameCount: 9, framesPath: 'a/f' },
    });
  });

  it('records a worker-side cancellation as CANCELLED and other errors as FAILED', async () => {
    const cancelled = await job();
    const broken = await job();

    await h.handler().failure({ jobId: cancelled.id, sequence: 1, errorCode: 'JOB_ERROR_CODE_CANCELLED', errorMessage: 'Cancelled by the user' });
    await h.handler().failure({ jobId: broken.id, sequence: 1, errorCode: 'JOB_ERROR_CODE_MEDIA_UNDECODABLE', errorMessage: 'Not a playable video: x' });

    expect(await h.service().get(LOCAL_USER_ID, cancelled.id)).toMatchObject({ status: 'CANCELLED', errorCode: 'CANCELLED' });
    expect(await h.service().get(LOCAL_USER_ID, broken.id)).toMatchObject({ status: 'FAILED', errorCode: 'MEDIA_UNDECODABLE' });
  });

  describe('reconciler', () => {
    const backdate = () =>
      h.database.db.update(processingJobs).set({ updatedAt: sql`now() - interval '5 minutes'` });
    const reconciler = () => new JobsReconciler(h.jobs, h.runner, h.gateway as never);

    it('fails a stale job the AI service no longer knows', async () => {
      const { id } = await job();
      await backdate();
      h.runner.state = 'UNKNOWN';

      expect(await reconciler().reconcile()).toBe(1);
      expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'INTERRUPTED',
        errorMessage: INTERRUPTED_MESSAGE,
      });
    });

    it('leaves queued or running jobs alone, and does nothing while the AI service is down', async () => {
      const { id } = await job();
      await backdate();

      h.runner.state = 'QUEUED';
      expect(await reconciler().reconcile()).toBe(0);
      h.runner.state = new Error('14 UNAVAILABLE');
      expect(await reconciler().reconcile()).toBe(0);
      expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({ status: 'PENDING' });
    });
  });
});
