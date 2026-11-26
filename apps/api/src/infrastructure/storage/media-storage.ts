import { mkdir, realpath, rm, rmdir, statfs } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Owns the MEDIA_ROOT layout (architecture §9.2) and every filesystem operation on it.
 * Paths stored in the database are relative to MEDIA_ROOT.
 */
export class MediaStorage {
  static readonly ORIGINALS = 'original-videos';
  /** Extracted audio + frames per processing job (Phase 3; replaces the docs' temporary /tmp idea). */
  static readonly ANALYSIS = 'analysis';
  private static readonly TREES = [MediaStorage.ORIGINALS, MediaStorage.ANALYSIS];

  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** original-videos/{user}/{project}/{video}/source.{ext} — relative, for the storage_path column. */
  sourceVideoPath(userId: string, projectId: string, videoId: string, extension: string): string {
    return join(MediaStorage.ORIGINALS, userId, projectId, videoId, `source.${extension}`);
  }

  /** analysis/{user}/{project}/{video}/{job} — relative; where the worker writes audio.wav and frames/. */
  jobArtifactsPath(userId: string, projectId: string, videoId: string, jobId: string): string {
    return join(MediaStorage.ANALYSIS, userId, projectId, videoId, jobId);
  }

  /** Absolute path for a stored relative path. Refuses anything that would escape MEDIA_ROOT. */
  absolute(relativePath: string): string {
    const full = resolve(this.root, relativePath);
    if (!this.contains(full)) throw new Error(`path escapes MEDIA_ROOT: ${relativePath}`);
    return full;
  }

  projectDir(userId: string, projectId: string): string {
    return this.absolute(join(MediaStorage.ORIGINALS, userId, projectId));
  }

  videoDir(userId: string, projectId: string, videoId: string): string {
    return this.absolute(join(MediaStorage.ORIGINALS, userId, projectId, videoId));
  }

  /** Removes everything ClipForge stored for the project: its originals and its analysis artifacts. */
  async removeProjectDir(userId: string, projectId: string): Promise<void> {
    for (const tree of MediaStorage.TREES) {
      await rm(this.absolute(join(tree, userId, projectId)), { recursive: true, force: true });
    }
  }

  /**
   * Removes the video's original and analysis artifacts, then any project directory this left empty
   * (e.g. a copy racing a project delete).
   */
  async removeVideoDir(userId: string, projectId: string, videoId: string): Promise<void> {
    for (const tree of MediaStorage.TREES) {
      await rm(this.absolute(join(tree, userId, projectId, videoId)), { recursive: true, force: true });
      await rmdir(this.absolute(join(tree, userId, projectId))).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error;
      });
    }
  }

  async freeBytes(): Promise<number> {
    await this.ensureRoot();
    const stats = await statfs(this.root);
    return stats.bavail * stats.bsize;
  }

  /** True when `path` (after resolving symlinks) is MEDIA_ROOT or lies inside it. */
  async isInside(path: string): Promise<boolean> {
    await this.ensureRoot();
    const [realRoot, realPath] = await Promise.all([realpath(this.root), realpath(path)]);
    return realPath === realRoot || realPath.startsWith(realRoot + sep);
  }

  private contains(full: string): boolean {
    const rel = relative(this.root, full);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
}
