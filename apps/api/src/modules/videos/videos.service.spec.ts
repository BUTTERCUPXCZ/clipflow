import { readFile, stat } from 'node:fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TEXT_HEADER } from '../../../test/fixtures/containers.js';
import { VideosHarness } from '../../../test/videos-harness.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { MediaCopier } from './import/media-copier.js';

const OTHER_USER = '00000000-0000-4000-8000-00000000beef';

describe('VideosService: import, list, get (clipforge_test)', () => {
  const h = new VideosHarness();

  beforeEach(() => h.setUp());
  afterEach(() => h.tearDown());
  afterAll(() => h.database.close());

  it('returns IMPORTING at once, then completes the copy in the background', async () => {
    const service = h.service();
    const projectId = await h.project();
    const source = await h.sourceFile('Episode 12.mp4');

    const started = await service.startImport(LOCAL_USER_ID, projectId, source);

    expect(started).toMatchObject({ projectId, filename: 'Episode 12.mp4', status: 'IMPORTING', mimeType: 'video/mp4' });
    expect(started).not.toHaveProperty('storagePath');
    expect(started).not.toHaveProperty('userId');

    await service.drain();
    const done = await service.get(LOCAL_USER_ID, started.id);
    expect(done).toMatchObject({ status: 'READY', bytesCopied: done.fileSize, errorMessage: null });

    const stored = h.storage.absolute(h.storage.sourceVideoPath(LOCAL_USER_ID, projectId, started.id, 'mp4'));
    expect((await readFile(stored)).equals(await readFile(source))).toBe(true);
  });

  it('rejects an invalid file with 400 and creates nothing', async () => {
    const service = h.service();
    const projectId = await h.project();

    const attempt = service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile('fake.mp4', TEXT_HEADER));

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/not a valid/);
    expect(await service.list(LOCAL_USER_ID, projectId)).toEqual([]);
    await expect(stat(h.storage.projectDir(LOCAL_USER_ID, projectId))).rejects.toThrow();
  });

  it('404s for a project that is unknown or belongs to someone else', async () => {
    const service = h.service();
    await h.database.createUser(OTHER_USER);
    const theirs = await h.project(OTHER_USER);
    const source = await h.sourceFile();

    await expect(service.startImport(LOCAL_USER_ID, theirs, source)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(LOCAL_USER_ID, theirs)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists a project\'s videos newest first and hides other users\' videos', async () => {
    const service = h.service();
    const projectId = await h.project();
    const first = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile('a.mp4'));
    const second = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile('b.mp4'));
    await service.drain();

    expect((await service.list(LOCAL_USER_ID, projectId)).map((v) => v.id)).toEqual([second.id, first.id]);
    await expect(service.get(OTHER_USER, first.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks the video FAILED with the reason and removes its files when the copy fails', async () => {
    class FailingCopier extends MediaCopier {
      override copy(): Promise<void> {
        return Promise.reject(new Error('disk on fire'));
      }
    }
    const service = h.service(new FailingCopier());
    const projectId = await h.project();

    const started = await service.startImport(LOCAL_USER_ID, projectId, await h.sourceFile());
    await service.drain();

    expect(await service.get(LOCAL_USER_ID, started.id)).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Import failed: disk on fire',
    });
    await expect(stat(h.storage.videoDir(LOCAL_USER_ID, projectId, started.id))).rejects.toThrow();
  });
});
