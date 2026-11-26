import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { GatedCopier, VideosHarness } from '../../../test/videos-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { sourceVideos } from '../../infrastructure/database/schema.js';
import { ImportValidator } from './import/import-validator.js';
import { MediaCopier } from './import/media-copier.js';
import { VideosRepository } from './videos.repository.js';
import { INTERRUPTED_MESSAGE, VideosService } from './videos.service.js';

const exists = (path: string) => stat(path).then(() => true, () => false);

describe('VideosService: delete, abort, recovery (clipforge_test)', () => {
  const h = new VideosHarness();

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  it('deletes a READY video: row and directory are gone', async () => {
    const service = h.service();
    const projectId = await h.project();
    const video = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile());
    await service.drain();

    await service.delete(LOCAL_USER_ID, video.id);

    await expect(service.get(LOCAL_USER_ID, video.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await exists(h.storage.videoDir(LOCAL_USER_ID, projectId, video.id))).toBe(false);
  });

  it('cancels a copy in progress when its video is deleted', async () => {
    const copier = new GatedCopier();
    const service = h.service(copier);
    const projectId = await h.project();
    const video = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile());
    await copier.started.promise;

    await service.delete(LOCAL_USER_ID, video.id);

    expect(copier.signal?.aborted).toBe(true); // immediately, not at the next progress tick
    copier.open();
    await service.drain();

    expect(copier.completed).toBe(false);
    expect(h.registry.isRunning(video.id)).toBe(false);
    expect(await exists(h.storage.videoDir(LOCAL_USER_ID, projectId, video.id))).toBe(false);
  });

  it('stops a copy on its next progress tick when the whole project is deleted', async () => {
    const copier = new GatedCopier();
    const service = h.service(copier);
    const projectId = await h.project();
    const video = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile());
    await copier.started.promise;

    await h.projects.deleteOwned(LOCAL_USER_ID, projectId); // cascades the video row, like ProjectsService does
    copier.open();
    await service.drain();

    expect(copier.completed).toBe(false); // cut short, not copied to the end and then discarded
    expect(await exists(h.storage.videoDir(LOCAL_USER_ID, projectId, video.id))).toBe(false);
  });

  it('survives a database outage while recording the outcome (no unhandled rejection)', async () => {
    class BrokenRepository extends VideosRepository {
      override markReady(): Promise<boolean> {
        return Promise.reject(new Error('connection terminated'));
      }
      override markFailed(): Promise<boolean> {
        return Promise.reject(new Error('connection terminated'));
      }
    }
    const service = new VideosService(
      new BrokenRepository(h.database.db),
      h.projects,
      h.storage,
      new ImportValidator(h.storage),
      new MediaCopier(0),
      h.registry,
    );
    const projectId = await h.project();

    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const video = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile());
      // No drain(): awaiting the copy would itself observe the rejection and hide the bug.
      await vi.waitFor(() => expect(h.registry.isRunning(video.id)).toBe(false));
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off('unhandledRejection', record);
    }

    expect(unhandled).toEqual([]);
  });

  it('404s when deleting an unknown video', async () => {
    await expect(h.service().delete(LOCAL_USER_ID, '6f1b8c5e-3d2a-4c1b-9e8f-0a1b2c3d4e5f')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails imports left IMPORTING by a crash and clears their partial files at startup', async () => {
    const projectId = await h.project();
    const [stale] = await h.database.db
      .insert(sourceVideos)
      .values({
        userId: LOCAL_USER_ID,
        projectId,
        filename: 'big.mp4',
        storagePath: 'unused',
        fileSize: 10,
        mimeType: 'video/mp4',
        status: 'IMPORTING',
      })
      .returning();
    const dir = h.storage.videoDir(LOCAL_USER_ID, projectId, stale.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'source.mp4.part'), 'half');

    await h.service().onApplicationBootstrap();

    expect(await h.service().get(LOCAL_USER_ID, stale.id)).toMatchObject({
      status: 'FAILED',
      errorMessage: INTERRUPTED_MESSAGE,
    });
    expect(await exists(dir)).toBe(false);
  });
});
