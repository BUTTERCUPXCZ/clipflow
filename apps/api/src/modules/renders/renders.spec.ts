import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { JobsHarness } from '../../../test/jobs-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { sourceVideos } from '../../infrastructure/database/schema.js';
import type { EventsGateway } from '../jobs/events.gateway.js';
import { ClipsRepository } from '../plans/clips.repository.js';
import { PlanEventsHandler } from '../plans/plan-events.js';
import { PlansRepository } from '../plans/plans.repository.js';
import { PlansService } from '../plans/plans.service.js';
import { ExportService, exportName } from './export.service.js';
import { RenderEventsHandler } from './render-events.js';
import { RendersRepository } from './renders.repository.js';
import { RendersService } from './renders.service.js';

describe('renders (clipforge_test)', () => {
  const h = new JobsHarness();
  const plansRepo = new PlansRepository(h.database.db);
  const clipsRepo = new ClipsRepository(h.database.db);
  const rendersRepo = new RendersRepository(h.database.db);

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  const gateway = () => h.gateway as unknown as EventsGateway;
  const plans = () => new PlansService(plansRepo, clipsRepo, h.videos, h.jobs, h.analyses, h.storage, h.runner, gateway());
  const service = () => new RendersService(rendersRepo, plansRepo, clipsRepo, h.videos, h.jobs, h.analyses, h.storage, h.runner, gateway());
  const handler = () => new RenderEventsHandler(rendersRepo, gateway(), h.storage);
  const exports = () => new ExportService(rendersRepo, h.storage);
  const write = async (path: string, content: string | object) => {
    await mkdir(dirname(h.storage.absolute(path)), { recursive: true });
    await writeFile(h.storage.absolute(path), typeof content === 'string' ? content : JSON.stringify(content));
  };

  /** A completed plan with two kept clips on a 600 s video with a transcript. */
  async function completedPlan() {
    const { videoId } = await h.video();
    await h.database.db.update(sourceVideos).set({ duration: 600 }).where(eq(sourceVideos.id, videoId));
    const job = await h.service().process(LOCAL_USER_ID, videoId);
    await h.jobs.applyCompletion(job.id, 1, {
      hasAudio: true, audioPath: 'a.wav', audioDurationSeconds: 600, frameCount: 600, frameIntervalSeconds: 1, framesPath: 'analysis/x/frames',
      transcriptPath: 'analysis/x/transcript.json', visualPath: 'analysis/x/visual.json', validBatches: 1, totalBatches: 1,
    });
    const words = [{ start: 10, end: 10.4, word: 'Hello.', probability: 1 }];
    await h.analyses.insert({
      sourceVideoId: videoId, processingJobId: job.id, userId: LOCAL_USER_ID, modelMetadata: {}, visualAnalysis: {},
      transcript: { language: 'en', segments: [{ start: 10, end: 11, text: 'Hello.', words }] },
    });
    const plan = await plans().create(LOCAL_USER_ID, videoId, {});
    const clip = (s: number, e: number, title: string) => ({ startSeconds: s, endSeconds: e, score: 7, reason: 'r', title, hook: 'h', caption: 'c' });
    const planPath = `analysis/x/plans/${plan.id}/plan.json`;
    await write(planPath, { schemaVersion: 'plan-v1', language: 'en', skippedWindows: [], clips: [clip(9.7, 30, 'First: one?'), clip(100, 130, 'Second')] });
    await new PlanEventsHandler(plansRepo, gateway(), h.storage).completion({
      planId: plan.id, sequence: 1, outputPath: planPath, metrics: { llmCalls: 1, elapsedMs: 1, windows: 1, skippedWindows: 0, clipCount: 2 },
    });
    return { videoId, planId: plan.id, clips: await clipsRepo.listForPlan(plan.id) };
  }

  /** Renders a plan through the worker events with one output file per clip. */
  async function completedRender() {
    const planned = await completedPlan();
    const render = await service().create(LOCAL_USER_ID, planned.planId, { subtitles: true });
    const dir = `analysis/x/renders/${render.id}`;
    const outputs = [];
    for (const clip of planned.clips) {
      await write(`${dir}/${clip.id}.mp4`, `video of ${clip.title}`);
      await write(`${dir}/${clip.id}.jpg`, 'jpg');
      outputs.push({ clipId: clip.id, file: `${dir}/${clip.id}.mp4`, thumbnail: `${dir}/${clip.id}.jpg`, durationSeconds: 20, width: 1080, height: 1920, sizeBytes: 12 });
    }
    await write(`${dir}/render.json`, { clips: outputs, failures: [] });
    const metrics = { rendered: 2, failed: 0, elapsedMs: 5000, encoder: 'h264_nvenc' };
    const ack = await handler().completion({ renderId: render.id, sequence: 2, outputPath: `${dir}/render.json`, metrics });
    return { ...planned, renderId: render.id, dir, metrics, ack, detail: await service().get(LOCAL_USER_ID, render.id) };
  }

  it('renders only completed plans with kept clips, one at a time per video, sending cues for each clip', async () => {
    const { planId, clips, videoId } = await completedPlan();

    const render = await service().create(LOCAL_USER_ID, planId, { subtitles: true });

    expect(render).toMatchObject({ status: 'PENDING', clipCount: 2, settings: { subtitles: true } });
    const sent = h.runner.renders[0];
    expect(sent.outputPath).toMatch(new RegExp(`/renders/${render.id}$`));
    expect(sent.sourcePath).toContain(videoId);
    expect(sent.clips[0]).toMatchObject({ clipId: clips[0].id, start: 9.7, end: 30, cues: [{ start: 0.3, end: 0.7, text: 'Hello.' }] });
    await expect(service().create(LOCAL_USER_ID, planId, { subtitles: false })).rejects.toBeInstanceOf(ConflictException);

    for (const c of clips) await clipsRepo.remove(c.id);
    await service().cancel(LOCAL_USER_ID, render.id);
    await expect(service().create(LOCAL_USER_ID, planId, { subtitles: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('labels outputs with what was rendered, even if the plan was edited during the render', async () => {
    const { planId, clips } = await completedPlan();
    const render = await service().create(LOCAL_USER_ID, planId, { subtitles: false });
    await clipsRepo.updateTimes(clips[0].id, 12, 40); // adjusted while rendering
    const dir = `analysis/x/renders/${render.id}`;
    const out = { clipId: clips[0].id, file: `${dir}/${clips[0].id}.mp4`, thumbnail: `${dir}/${clips[0].id}.jpg`, durationSeconds: 20.3, width: 1080, height: 1920, sizeBytes: 1 };
    await write(`${dir}/render.json`, { clips: [out], failures: [] });

    await handler().completion({ renderId: render.id, sequence: 1, outputPath: `${dir}/render.json`, metrics: { rendered: 1, failed: 0, elapsedMs: 1, encoder: 'x' } });

    expect((await service().get(LOCAL_USER_ID, render.id)).clips[0]).toMatchObject({ startSeconds: 9.7, endSeconds: 30 });
  });

  it('stores verified outputs with the clip titles, acks a retry and hides storage paths', async () => {
    const { ack, detail, renderId, dir, metrics } = await completedRender();

    expect(ack).toEqual({ applied: true, stop: false });
    expect(detail).toMatchObject({ status: 'COMPLETED', metrics: { encoder: 'h264_nvenc' } });
    expect(detail.clips.map((c) => c.title)).toEqual(['First: one?', 'Second']);
    expect(detail.clips[0]).not.toHaveProperty('filePath');
    expect(await handler().completion({ renderId, sequence: 2, outputPath: `${dir}/render.json`, metrics })).toEqual({ applied: true, stop: false });
    expect((await service().gallery(LOCAL_USER_ID)).map((c) => c.videoName)).toEqual(['a.mp4', 'a.mp4']);
  });

  it('fails a render whose output points outside its own directory', async () => {
    const { planId, clips } = await completedPlan();
    const render = await service().create(LOCAL_USER_ID, planId, { subtitles: true });
    const dir = `analysis/x/renders/${render.id}`;
    const escape = { clipId: clips[0].id, file: 'original-videos/x/source.mp4', thumbnail: `${dir}/t.jpg`, durationSeconds: 1, width: 1080, height: 1920, sizeBytes: 1 };
    await write(`${dir}/render.json`, { clips: [escape], failures: [] });

    const ack = await handler().completion({ renderId: render.id, sequence: 1, outputPath: `${dir}/render.json`, metrics: { rendered: 1, failed: 0, elapsedMs: 1, encoder: 'x' } });

    expect(ack).toEqual({ applied: true, stop: true });
    expect(await service().get(LOCAL_USER_ID, render.id)).toMatchObject({ status: 'FAILED', clips: [] });
  });

  it('exports a clip without ever overwriting, and refuses unsafe destinations', async () => {
    const { detail } = await completedRender();
    const folder = await mkdtemp(join(tmpdir(), 'clipforge-export-'));
    const clipId = detail.clips[0].id;

    const first = await exports().exportClip(LOCAL_USER_ID, clipId, join(folder, 'mine.mp4'));
    const second = await exports().exportClip(LOCAL_USER_ID, clipId, join(folder, 'mine'));

    expect([first.path, second.path]).toEqual([join(folder, 'mine.mp4'), join(folder, 'mine (1).mp4')]);
    expect(await readFile(first.path, 'utf8')).toBe('video of First: one?');
    await expect(exports().exportClip(LOCAL_USER_ID, clipId, 'relative.mp4')).rejects.toThrow(/absolute/);
    await expect(exports().exportClip(LOCAL_USER_ID, clipId, join(folder, 'missing', 'x.mp4'))).rejects.toThrow(/does not exist/);
    await expect(exports().exportClip(LOCAL_USER_ID, clipId, h.storage.absolute('analysis/x.mp4'))).rejects.toThrow(/media folder/);
    await symlink(h.storage.absolute('analysis'), join(folder, 'library-link'));
    await expect(exports().exportClip(LOCAL_USER_ID, clipId, join(folder, 'library-link', 'sneaky.mp4'))).rejects.toThrow(/media folder/);
    await expect(exports().exportClip(LOCAL_USER_ID, clipId, `${folder}/`)).rejects.toThrow(/file name/);
  });

  it('exports a whole render with safe, numbered names', async () => {
    const { renderId } = await completedRender();
    const folder = await mkdtemp(join(tmpdir(), 'clipforge-export-'));

    await exports().exportRender(LOCAL_USER_ID, renderId, folder);

    expect((await readdir(folder)).sort()).toEqual(['01 - First one.mp4', '02 - Second.mp4']);
    expect(exportName(9, 'a/b\\c<>d\u0007. ')).toBe('10 - a b c d.mp4');
  });
});
