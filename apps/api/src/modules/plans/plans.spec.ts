import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { sourceVideos } from '../../infrastructure/database/schema.js';
import type { EventsGateway } from '../jobs/events.gateway.js';
import { ClipsRepository } from './clips.repository.js';
import { ClipsService } from './clips.service.js';
import { PlanEventsHandler } from './plan-events.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';

const words = (start: number, text: string) =>
  text.split(' ').map((word, i) => ({ start: start + i * 0.5, end: start + i * 0.5 + 0.4, word, probability: 1 }));

describe('plans (clipforge_test)', () => {
  const h = new JobsHarness();
  const plansRepo = new PlansRepository(h.database.db);
  const clipsRepo = new ClipsRepository(h.database.db);

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  const gateway = () => h.gateway as unknown as EventsGateway;
  const service = () => new PlansService(plansRepo, clipsRepo, h.videos, h.jobs, h.analyses, h.storage, h.runner, gateway());
  const clips = () => new ClipsService(plansRepo, clipsRepo, h.analyses);
  const handler = () => new PlanEventsHandler(plansRepo, gateway(), h.storage);

  /** A READY 600 s video whose latest job completed with a transcript. */
  async function analysedVideo({ transcript = true } = {}) {
    const { videoId, projectId } = await h.video();
    await h.database.db.update(sourceVideos).set({ duration: 600 }).where(eq(sourceVideos.id, videoId));
    const job = await h.service().process(LOCAL_USER_ID, videoId);
    const row = await h.jobs.applyCompletion(job.id, 1, {
      hasAudio: transcript, audioPath: null, audioDurationSeconds: null, frameCount: 600, frameIntervalSeconds: 1,
      framesPath: 'analysis/x/frames', transcriptPath: transcript ? 'analysis/x/transcript.json' : null,
      visualPath: 'analysis/x/visual.json', validBatches: 1, totalBatches: 1,
    });
    await h.analyses.insert({
      sourceVideoId: videoId, processingJobId: job.id, userId: LOCAL_USER_ID, modelMetadata: {}, visualAnalysis: { scenes: [] },
      transcript: transcript ? { language: 'en', segments: [{ start: 10, end: 14, text: 'x', words: words(10, 'Hello there. This is a clip that keeps on going.') }] } : null,
    });
    return { videoId, projectId, jobId: row!.id };
  }

  /** Runs a plan to COMPLETED through the worker events, with two clips. */
  async function completedPlan() {
    const { videoId } = await analysedVideo();
    const plan = await service().create(LOCAL_USER_ID, videoId, {});
    const outputPath = `analysis/x/plans/${plan.id}/plan.json`;
    await mkdir(dirname(h.storage.absolute(outputPath)), { recursive: true });
    const clip = (startSeconds: number, endSeconds: number) => ({
      startSeconds, endSeconds, score: 7, reason: 'r', title: 't', hook: 'h', caption: 'c', cropMode: 'center',
    });
    await writeFile(
      h.storage.absolute(outputPath),
      JSON.stringify({ schemaVersion: 'plan-v1', language: 'en', skippedWindows: [], clips: [clip(9.7, 30), clip(100, 130)] }),
    );
    const metrics = { llmCalls: 4, elapsedMs: 9000, windows: 3, skippedWindows: 0, clipCount: 2 };
    const ack = await handler().completion({ planId: plan.id, sequence: 2, outputPath, metrics });
    return { plan, outputPath, metrics, ack, detail: await service().get(LOCAL_USER_ID, plan.id) };
  }

  it('queues a plan with defaults from the video length and the configured model', async () => {
    const { videoId, jobId } = await analysedVideo();

    const plan = await service().create(LOCAL_USER_ID, videoId, { maxSeconds: 45 });

    expect(plan).toMatchObject({ status: 'PENDING', modelName: 'qwen3-vl:8b-instruct', settings: { minSeconds: 15, maxSeconds: 45, maxClips: 3 } });
    expect(h.runner.plans[0]).toMatchObject({
      planId: plan.id, transcriptPath: 'analysis/x/transcript.json', durationSeconds: 600, maxClips: 3, model: 'qwen3-vl:8b-instruct',
    });
    expect(h.runner.plans[0].outputPath).toMatch(new RegExp(`/${jobId}/plans/${plan.id}$`));
  });

  it('refuses unprocessed or silent videos, impossible settings and a second running plan', async () => {
    const { videoId: fresh } = await h.video();
    await expect(service().create(LOCAL_USER_ID, fresh, {})).rejects.toThrow(/Process this video first/);
    const { videoId: silent } = await analysedVideo({ transcript: false });
    await expect(service().create(LOCAL_USER_ID, silent, {})).rejects.toThrow(/needs speech/);

    const { videoId } = await analysedVideo();
    await expect(service().create(LOCAL_USER_ID, videoId, { minSeconds: 60, maxSeconds: 30 })).rejects.toBeInstanceOf(BadRequestException);
    await service().create(LOCAL_USER_ID, videoId, {});
    await expect(service().create(LOCAL_USER_ID, videoId, {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails the plan and answers 503 when the AI service cannot take it', async () => {
    const { videoId } = await analysedVideo();
    h.runner.startResult = new Error('14 UNAVAILABLE');

    await expect(service().create(LOCAL_USER_ID, videoId, {})).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((await service().listForVideo(LOCAL_USER_ID, videoId))[0]).toMatchObject({ status: 'FAILED' });
  });

  it('stores the clips with the completion, acks a retry, and pushes the change live', async () => {
    const { plan, outputPath, metrics, ack, detail } = await completedPlan();

    expect(ack).toEqual({ applied: true, stop: false });
    expect(detail).toMatchObject({ status: 'COMPLETED', progress: 100, language: 'en', metrics: { llmCalls: 4 } });
    expect(detail.clips.map((c) => [c.startSeconds, c.endSeconds])).toEqual([[9.7, 30], [100, 130]]);
    expect(detail.clips[0].excerpt).toBe('Hello there. This is a clip that keeps on going.'); // words inside the range only
    expect(detail.clips[1].excerpt).toBe('');
    expect(await handler().completion({ planId: plan.id, sequence: 2, outputPath, metrics })).toEqual({ applied: true, stop: false });
    expect((await service().get(LOCAL_USER_ID, plan.id)).clips).toHaveLength(2); // the retry added no duplicates
    expect(h.gateway.plans.map((p) => p.status)).toContain('COMPLETED');
  });

  it('fails a plan whose output cannot be read and tells the worker to remove it', async () => {
    const { videoId } = await analysedVideo();
    const plan = await service().create(LOCAL_USER_ID, videoId, {});
    const metrics = { llmCalls: 1, elapsedMs: 1, windows: 1, skippedWindows: 0, clipCount: 1 };

    const ack = await handler().completion({ planId: plan.id, sequence: 1, outputPath: 'analysis/x/missing.json', metrics });

    expect(ack).toEqual({ applied: true, stop: true });
    expect(await service().get(LOCAL_USER_ID, plan.id)).toMatchObject({ status: 'FAILED', errorCode: 'INTERNAL' });
  });

  it('fails a plan whose plan.json breaks the contract, instead of breaking the insert on every retry', async () => {
    const { videoId } = await analysedVideo();
    const plan = await service().create(LOCAL_USER_ID, videoId, {});
    const outputPath = `analysis/x/plans/${plan.id}/plan.json`;
    await mkdir(dirname(h.storage.absolute(outputPath)), { recursive: true });
    const bad = { startSeconds: 30, endSeconds: 10, score: 7, reason: 'r', title: 't', hook: 'h', caption: 'c' };
    await writeFile(h.storage.absolute(outputPath), JSON.stringify({ schemaVersion: 'plan-v1', language: 'en', skippedWindows: [], clips: [bad] }));
    const metrics = { llmCalls: 1, elapsedMs: 1, windows: 1, skippedWindows: 0, clipCount: 1 };

    expect(await handler().completion({ planId: plan.id, sequence: 1, outputPath, metrics })).toEqual({ applied: true, stop: true });
    expect(await service().get(LOCAL_USER_ID, plan.id)).toMatchObject({ status: 'FAILED', clips: [] });
  });

  it('ignores stale progress and stops the worker after a cancel', async () => {
    const { videoId } = await analysedVideo();
    const plan = await service().create(LOCAL_USER_ID, videoId, {});
    await handler().progress({ planId: plan.id, sequence: 5, progress: 40, message: '' });

    expect(await handler().progress({ planId: plan.id, sequence: 4, progress: 90, message: '' })).toEqual({ applied: false, stop: false });
    expect((await service().get(LOCAL_USER_ID, plan.id)).progress).toBe(40);
    await service().cancel(LOCAL_USER_ID, plan.id);
    await expect(service().cancel(LOCAL_USER_ID, plan.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await handler().progress({ planId: plan.id, sequence: 6, progress: 50, message: '' })).toEqual({ applied: false, stop: true });
    expect(h.runner.cancelled).toContain(plan.id);
  });

  it('adjusts clip times only within the video, the length limits and without overlap', async () => {
    const { plan, detail } = await completedPlan();
    const [first] = detail.clips;

    await expect(clips().adjust(LOCAL_USER_ID, plan.id, first.id, { endSeconds: 20 })).rejects.toThrow(/15–60 s long/);
    await expect(clips().adjust(LOCAL_USER_ID, plan.id, first.id, { startSeconds: 95, endSeconds: 120 })).rejects.toThrow(/overlap/);
    await expect(clips().adjust(LOCAL_USER_ID, plan.id, first.id, { startSeconds: 580, endSeconds: 610 })).rejects.toThrow(/end of the video/);

    expect(await clips().adjust(LOCAL_USER_ID, plan.id, first.id, { startSeconds: 5 })).toMatchObject({ startSeconds: 5, endSeconds: 30 });
  });

  it('removes a clip softly, which frees its time range', async () => {
    const { plan, detail } = await completedPlan();
    const [first, second] = detail.clips;

    await clips().remove(LOCAL_USER_ID, plan.id, second.id);

    expect((await service().get(LOCAL_USER_ID, plan.id)).clips.find((c) => c.id === second.id)?.removedAt).not.toBeNull();
    await expect(clips().adjust(LOCAL_USER_ID, plan.id, second.id, { startSeconds: 99 })).rejects.toBeInstanceOf(ConflictException);
    expect(await clips().adjust(LOCAL_USER_ID, plan.id, first.id, { endSeconds: 69.7 })).toMatchObject({ endSeconds: 69.7 });
  });

  it('builds subtitle cues from the transcript words inside the clip, relative to its start', async () => {
    const { plan, detail } = await completedPlan();

    const cues = await clips().subtitles(LOCAL_USER_ID, plan.id, detail.clips[0].id);

    expect(cues[0]).toEqual({ start: 0.3, end: 1.2, text: 'Hello there.' });
    expect(cues.every((c) => c.text.length <= 32 && c.end - c.start <= 3)).toBe(true);
  });
});
