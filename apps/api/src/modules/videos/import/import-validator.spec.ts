import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURE_HEADERS, TEXT_HEADER } from '../../../../test/fixtures/containers.js';
import { MediaStorage } from '../../../infrastructure/storage/media-storage.js';
import { formatBytes, ImportRejectedError, ImportValidator, type ImportStorage } from './import-validator.js';

describe('ImportValidator', () => {
  let dir: string;
  let storage: MediaStorage;
  let validator: ImportValidator;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clipforge-validate-'));
    storage = new MediaStorage(join(dir, 'media'));
    validator = new ImportValidator(storage);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const file = async (name: string, content: Buffer | string) => {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  };
  const rejection = (path: string, v = validator) =>
    v.validate(path).then(
      () => 'accepted',
      (e: unknown) => (e instanceof ImportRejectedError ? e.message : `unexpected: ${String(e)}`),
    );

  it('accepts a real mp4 and reports its size and MIME type', async () => {
    const path = await file('Episode 12.MP4', FIXTURE_HEADERS.mp4);

    expect(await validator.validate(path)).toEqual({
      absolutePath: path,
      filename: 'Episode 12.MP4',
      size: FIXTURE_HEADERS.mp4.length,
      extension: 'mp4',
      mime: 'video/mp4',
    });
  });

  it('accepts every supported container family', async () => {
    for (const [ext, header] of Object.entries(FIXTURE_HEADERS)) {
      expect(await rejection(await file(`clip.${ext}`, header))).toBe('accepted');
    }
  });

  it('rejects a relative path', async () => {
    expect(await rejection('videos/clip.mp4')).toMatch(/must be absolute/);
  });

  it('rejects a missing file', async () => {
    expect(await rejection(join(dir, 'nope.mp4'))).toBe('File not found: nope.mp4');
  });

  it('rejects a folder', async () => {
    await mkdir(join(dir, 'clips.mp4'));
    expect(await rejection(join(dir, 'clips.mp4'))).toMatch(/is a folder/);
  });

  it('rejects a symlink even when it points at a valid video', async () => {
    const target = await file('real.mp4', FIXTURE_HEADERS.mp4);
    await symlink(target, join(dir, 'link.mp4'));

    expect(await rejection(join(dir, 'link.mp4'))).toMatch(/symbolic link/);
  });

  it('rejects an unsupported extension and lists the supported ones', async () => {
    expect(await rejection(await file('notes.txt', TEXT_HEADER))).toMatch(/Unsupported file type "\.txt".*mp4, m4v/);
  });

  it('rejects a text file renamed to .mp4', async () => {
    expect(await rejection(await file('fake.mp4', TEXT_HEADER))).toMatch(/not a valid ISO base media/);
  });

  it('rejects an empty file', async () => {
    expect(await rejection(await file('empty.mp4', ''))).toBe('empty.mp4 is empty');
  });

  it('rejects a file over the size limit', async () => {
    const small = new ImportValidator(storage, { maxBytes: 100, freeSpaceMarginBytes: 0 });

    expect(await rejection(await file('big.mp4', FIXTURE_HEADERS.mp4), small)).toMatch(/larger than the 100 B limit/);
  });

  it('rejects a file that is already inside MEDIA_ROOT', async () => {
    await mkdir(storage.root, { recursive: true });
    const path = join(storage.root, 'source.mp4');
    await writeFile(path, FIXTURE_HEADERS.mp4);

    expect(await rejection(path)).toMatch(/already inside ClipForge's media folder/);
  });

  it('rejects when the media disk lacks space for the file plus the margin', async () => {
    const fullDisk: ImportStorage = { isInside: async () => false, freeBytes: async () => 1024 };
    const v = new ImportValidator(fullDisk, { maxBytes: 1e12, freeSpaceMarginBytes: 1024 });

    expect(await rejection(await file('clip.mp4', FIXTURE_HEADERS.mp4), v)).toMatch(/Not enough free disk space/);
  });

  it('formats byte counts for messages', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(50 * 1024 ** 3)).toBe('50.0 GB');
  });
});
