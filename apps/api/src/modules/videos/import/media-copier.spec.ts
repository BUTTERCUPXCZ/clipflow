import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImportRegistry } from './import-registry.js';
import { MediaCopier } from './media-copier.js';

describe('MediaCopier', () => {
  let dir: string;
  let source: string;
  let content: Buffer;
  const destination = () => join(dir, 'media', 'video-1', 'source.mp4');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipforge-copy-'));
    content = randomBytes(8 * 1024 * 1024);
    source = join(dir, 'original.mp4');
    await writeFile(source, content);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const filesIn = async (path: string) => readdir(path).catch(() => [] as string[]);

  it('copies byte-for-byte, creating the directory, and reports the final count', async () => {
    const progress: number[] = [];

    await new MediaCopier(0).copy(source, destination(), { expectedSize: content.length, onProgress: (b) => progress.push(b) });

    expect((await readFile(destination())).equals(content)).toBe(true);
    expect(progress.at(-1)).toBe(content.length);
    expect(progress.length).toBeGreaterThan(1);
    expect(await filesIn(join(dir, 'media', 'video-1'))).toEqual(['source.mp4']);
  });

  it('leaves the original untouched', async () => {
    const before = await stat(source);

    await new MediaCopier().copy(source, destination(), { expectedSize: content.length });

    expect((await stat(source)).mtimeMs).toBe(before.mtimeMs);
  });

  it('throttles progress to the interval', async () => {
    const progress: number[] = [];

    await new MediaCopier(60_000).copy(source, destination(), { expectedSize: content.length, onProgress: (b) => progress.push(b) });

    expect(progress).toEqual([content.length]); // only the final report
  });

  it('removes the partial file when aborted', async () => {
    const registry = new ImportRegistry();
    const signal = registry.start('video-1');
    const copy = new MediaCopier(0).copy(source, destination(), {
      expectedSize: content.length,
      signal,
      onProgress: () => registry.abort('video-1'),
    });

    await expect(copy).rejects.toThrow(/abort/i);
    expect(await filesIn(join(dir, 'media', 'video-1'))).toEqual([]);
  });

  it('fails and cleans up when the size no longer matches', async () => {
    await expect(new MediaCopier().copy(source, destination(), { expectedSize: 1 })).rejects.toThrow(/changed while/);
    expect(await filesIn(join(dir, 'media', 'video-1'))).toEqual([]);
  });

  it('fails and cleans up when the source cannot be read', async () => {
    await expect(new MediaCopier().copy(join(dir, 'missing.mp4'), destination(), { expectedSize: 1 })).rejects.toThrow();
    expect(await filesIn(join(dir, 'media', 'video-1'))).toEqual([]);
  });

  it('refuses a source that is a symlink', async () => {
    const link = join(dir, 'link.mp4');
    await symlink(source, link);

    await expect(new MediaCopier().copy(link, destination(), { expectedSize: content.length })).rejects.toThrow(/ELOOP/);
  });

  it('keeps copying when the progress callback throws', async () => {
    await new MediaCopier(0).copy(source, destination(), {
      expectedSize: content.length,
      onProgress: () => {
        throw new Error('db down');
      },
    });

    expect((await stat(destination())).size).toBe(content.length);
  });
});

describe('ImportRegistry', () => {
  it('aborts a running import and forgets finished ones', () => {
    const registry = new ImportRegistry();
    const signal = registry.start('v1');

    expect(registry.abort('v1')).toBe(true);
    expect(signal.aborted).toBe(true);
    registry.finish('v1');
    expect(registry.isRunning('v1')).toBe(false);
    expect(registry.abort('v1')).toBe(false);
  });
});
