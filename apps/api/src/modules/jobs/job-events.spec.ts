import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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

  const artifacts = (overrides = {}) => ({
    hasAudio: false,
    audioPath: '',
    audioDurationSeconds: 0,
    frameCount: 9,
    frameIntervalSeconds: 1,
    framesPath: 'analysis/j/frames',
    transcriptPath: '',
    visualPath: 'analysis/j/visual.json',
    validBatches: 2,
    totalBatches: 3,
    ...overrides,
  });
  const writeResult = async (path: string, value: unknown) => {
    await mkdir(dirname(h.storage.absolute(path)), { recursive: true });
    await writeFile(h.storage.absolute(path), JSON.stringify(value));
  };
  const VISUAL = { model: 'qwen3-vl:8b-instruct', promptVersion: 'visual-v1', scenes: [], metrics: { validBatches: 2 } };

  it('stores the artifacts and the analysis of a completed job', async () => {
    const { id, sourceVideoId } = await job();
    await writeResult('analysis/j/visual.json', VISUAL);
    await writeResult('analysis/j/transcript.json', { language: 'en', segments: [] });

    await h.handler().completion({ jobId: id, sequence: 4, artifacts: artifacts({ transcriptPath: 'analysis/j/transcript.json' }) });

    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({
      status: 'COMPLETED',
      progress: 100,
      artifacts: { hasAudio: false, audioPath: null, frameCount: 9, validBatches: 2, totalBatches: 3 },
    });
    expect(await h.service().analysis(LOCAL_USER_ID, sourceVideoId)).toMatchObject({
      processingJobId: id,
      transcript: { language: 'en' },
      visualAnalysis: VISUAL,
      modelMetadata: { visionModel: 'qwen3-vl:8b-instruct', promptVersion: 'visual-v1' },
    });
  });

  it('fails the job instead of completing it without readable results', async () => {
    const { id } = await job();

    const ack = await h.handler().completion({ jobId: id, sequence: 4, artifacts: artifacts() });

    expect(ack).toEqual({ applied: true, stop: true }); // the worker removes the failed job's files
    expect(await h.service().get(LOCAL_USER_ID, id)).toMatchObject({ status: 'FAILED', errorCode: 'INTERNAL' });
  });

  it('acks a retried completion as applied, so the worker keeps the files', async () => {
    const { id, sourceVideoId } = await job();
    await writeResult('analysis/j/visual.json', VISUAL);
    const event = { jobId: id, sequence: 4, artifacts: artifacts() };

    await h.handler().completion(event);
    expect(await h.handler().completion(event)).toEqual({ applied: true, stop: false });
    expect(await h.handler().completion({ ...event, sequence: 3 })).toEqual({ applied: false, stop: true });
    expect(await h.service().analysis(LOCAL_USER_ID, sourceVideoId)).toMatchObject({ processingJobId: id });
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
