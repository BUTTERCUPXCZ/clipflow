import { randomUUID } from 'node:crypto';
import { TestDatabase } from '../../../test/test-database.js';
import { LOCAL_USER_ID } from '../../common/current-user.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { VideosRepository } from './videos.repository.js';

describe('VideosRepository (clipforge_test)', () => {
  const database = new TestDatabase();
  const videos = new VideosRepository(database.db);
  const projects = new ProjectsRepository(database.db);

  beforeEach(() => database.reset());
  afterAll(() => database.close());

  async function importing() {
    const project = await projects.create(LOCAL_USER_ID, { name: 'p', description: null });
    return videos.insertImporting({
      id: randomUUID(),
      userId: LOCAL_USER_ID,
      projectId: project.id,
      filename: 'a.mp4',
      storagePath: 'x',
      fileSize: 100,
      mimeType: 'video/mp4',
    });
  }

  it('moves IMPORTING to READY with the final byte count', async () => {
    const video = await importing();

    expect(await videos.markReady(video.id, 100)).toBe(true);
    expect(await videos.findOwned(LOCAL_USER_ID, video.id)).toMatchObject({ status: 'READY', bytesCopied: 100 });
  });

  it('ignores a late progress tick or failure once the video is READY', async () => {
    const video = await importing();
    await videos.markReady(video.id, 100);

    expect(await videos.updateProgress(video.id, 40)).toBe(false);
    expect(await videos.markFailed(video.id, 'late')).toBe(false);
    expect(await videos.findOwned(LOCAL_USER_ID, video.id)).toMatchObject({
      status: 'READY',
      bytesCopied: 100,
      errorMessage: null,
    });
  });

  it('reports false for transitions on a deleted row', async () => {
    const video = await importing();
    await videos.deleteOwned(LOCAL_USER_ID, video.id);

    expect(await videos.updateProgress(video.id, 10)).toBe(false);
  });
});
