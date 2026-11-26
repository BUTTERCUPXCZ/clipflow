import { LOCAL_USER_ID } from '../../common/current-user.js';
import { eq, sql } from 'drizzle-orm';
import { projects, sourceVideos } from '../../infrastructure/database/schema.js';
import { TestDatabase } from '../../../test/test-database.js';
import { ProjectsRepository } from './projects.repository.js';

const OTHER_USER = '00000000-0000-4000-8000-00000000beef';

describe('ProjectsRepository (clipforge_test)', () => {
  const database = new TestDatabase();
  const repo = new ProjectsRepository(database.db);

  beforeEach(() => database.reset());
  afterAll(() => database.close());

  const create = (name: string, userId = LOCAL_USER_ID) => repo.create(userId, { name, description: null });

  /** Back-dates a project so ordering and "bumped" assertions never depend on clock resolution. */
  const backdate = (id: string, minutes: number) =>
    database.db
      .update(projects)
      .set({ updatedAt: sql`now() - make_interval(mins => ${minutes})` })
      .where(eq(projects.id, id));

  it('creates a project and returns it without exposing user_id', async () => {
    const project = await repo.create(LOCAL_USER_ID, { name: 'Podcast #12', description: 'raw cut' });

    expect(project).toMatchObject({ name: 'Podcast #12', description: 'raw cut' });
    expect(project).not.toHaveProperty('userId');
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lists only the user\'s projects, most recently updated first, with video counts', async () => {
    await database.createUser(OTHER_USER);
    const older = await create('older');
    const newer = await create('newer');
    await backdate(older.id, 10);
    await create('not mine', OTHER_USER);
    await database.db.insert(sourceVideos).values({
      projectId: older.id,
      userId: LOCAL_USER_ID,
      filename: 'a.mp4',
      storagePath: 'x',
      fileSize: 1,
      mimeType: 'video/mp4',
      status: 'READY',
    });

    const list = await repo.listWithVideoCount(LOCAL_USER_ID);

    expect(list.map((p) => [p.name, p.videoCount])).toEqual([
      ['newer', 0],
      ['older', 1],
    ]);
    expect(list[0].id).toBe(newer.id);
  });

  it('updates fields and bumps updated_at', async () => {
    const created = await create('draft');
    await backdate(created.id, 10);
    const project = (await repo.findOwned(LOCAL_USER_ID, created.id))!;

    const updated = await repo.update(LOCAL_USER_ID, project.id, { name: 'final', description: 'done' });

    expect(updated).toMatchObject({ name: 'final', description: 'done' });
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(project.updatedAt.getTime());
  });

  it('deletes an owned project and cascades its videos', async () => {
    const project = await create('gone');
    await database.db.insert(sourceVideos).values({
      projectId: project.id,
      userId: LOCAL_USER_ID,
      filename: 'a.mp4',
      storagePath: 'x',
      fileSize: 1,
      mimeType: 'video/mp4',
      status: 'READY',
    });

    expect(await repo.deleteOwned(LOCAL_USER_ID, project.id)).toBe(true);
    expect(await repo.findOwned(LOCAL_USER_ID, project.id)).toBeUndefined();
    expect(await database.db.select().from(sourceVideos)).toEqual([]);
  });

  it('treats another user\'s project as not found for every operation', async () => {
    await database.createUser(OTHER_USER);
    const theirs = await create('theirs', OTHER_USER);

    expect(await repo.findOwned(LOCAL_USER_ID, theirs.id)).toBeUndefined();
    expect(await repo.update(LOCAL_USER_ID, theirs.id, { name: 'hijack' })).toBeUndefined();
    expect(await repo.deleteOwned(LOCAL_USER_ID, theirs.id)).toBe(false);
    expect(await repo.findOwned(OTHER_USER, theirs.id)).toMatchObject({ name: 'theirs' });
  });
});
