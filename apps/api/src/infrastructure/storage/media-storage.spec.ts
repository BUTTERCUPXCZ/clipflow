import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorage } from './media-storage.js';

describe('MediaStorage', () => {
  let base: string;
  let storage: MediaStorage;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'clipforge-storage-'));
    storage = new MediaStorage(join(base, 'media'));
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  it('lays out source videos per user, project and video', () => {
    expect(storage.sourceVideoPath('u', 'p', 'v', 'mp4')).toBe('original-videos/u/p/v/source.mp4');
    expect(storage.videoDir('u', 'p', 'v')).toBe(join(base, 'media/original-videos/u/p/v'));
  });

  it('refuses relative paths that escape MEDIA_ROOT', () => {
    expect(() => storage.absolute('../outside')).toThrow(/escapes MEDIA_ROOT/);
    expect(() => storage.absolute('/etc/passwd')).toThrow(/escapes MEDIA_ROOT/);
  });

  it('removes a project directory and everything below it', async () => {
    const dir = storage.videoDir('u', 'p', 'v');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'source.mp4'), 'x');

    await storage.removeProjectDir('u', 'p');

    await expect(stat(storage.projectDir('u', 'p'))).rejects.toThrow();
  });

  it('detects paths inside MEDIA_ROOT, including through a symlink', async () => {
    const inside = join(storage.root, 'a.mp4');
    const outside = join(base, 'b.mp4');
    const link = join(base, 'link.mp4');
    await mkdir(storage.root, { recursive: true });
    await writeFile(inside, 'x');
    await writeFile(outside, 'x');
    await symlink(inside, link);

    expect(await storage.isInside(inside)).toBe(true);
    expect(await storage.isInside(link)).toBe(true);
    expect(await storage.isInside(outside)).toBe(false);
  });

  it('does not treat a sibling directory with a shared prefix as inside', async () => {
    const sibling = join(base, 'media-other');
    await mkdir(sibling);

    expect(await storage.isInside(sibling)).toBe(false);
  });

  it('reports free space as a positive number of bytes', async () => {
    expect(await storage.freeBytes()).toBeGreaterThan(0);
  });
});
