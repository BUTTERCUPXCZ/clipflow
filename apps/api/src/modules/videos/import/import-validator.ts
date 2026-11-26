import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import type { MediaStorage } from '../../../infrastructure/storage/media-storage.js';
import { formatForExtension, HEADER_BYTES, SUPPORTED_EXTENSIONS } from './container-signatures.js';

/** A file that may not be imported. The message is shown to the user as is (mapped to HTTP 400). */
export class ImportRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRejectedError';
  }
}

export interface ValidatedFile {
  absolutePath: string;
  filename: string;
  size: number;
  extension: string;
  mime: string;
}

export interface ImportLimits {
  maxBytes: number;
  /** free space that must remain on the media disk after the copy */
  freeSpaceMarginBytes: number;
}

const GiB = 1024 ** 3;
export const DEFAULT_IMPORT_LIMITS: ImportLimits = { maxBytes: 50 * GiB, freeSpaceMarginBytes: GiB };

/** Only what the validator needs from storage (interface segregation; easy to fake). */
export type ImportStorage = Pick<MediaStorage, 'isInside' | 'freeBytes'>;

/**
 * Trust boundary for imports (spec Phase 2, "Import validation"): every check runs before anything is written.
 * Cheap metadata checks come first, so the reason shown is the most specific one.
 */
export class ImportValidator {
  constructor(
    private readonly storage: ImportStorage,
    private readonly limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
  ) {}

  async validate(path: string): Promise<ValidatedFile> {
    if (!isAbsolute(path)) throw new ImportRejectedError('The file path must be absolute');
    const filename = basename(path);

    const stats = await lstat(path).catch((e: NodeJS.ErrnoException) => {
      throw new ImportRejectedError(e.code === 'ENOENT' ? `File not found: ${filename}` : `Cannot read ${filename}`);
    });
    if (stats.isSymbolicLink()) {
      throw new ImportRejectedError(`${filename} is a shortcut (symbolic link). Pick the original file instead`);
    }
    if (stats.isDirectory()) throw new ImportRejectedError(`${filename} is a folder. Pick a video file`);
    if (!stats.isFile()) throw new ImportRejectedError(`${filename} is not a regular file`);

    const extension = extname(path).slice(1).toLowerCase();
    const format = formatForExtension(extension);
    if (!format) {
      throw new ImportRejectedError(
        `Unsupported file type "${extension ? `.${extension}` : filename}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      );
    }

    if (stats.size === 0) throw new ImportRejectedError(`${filename} is empty`);
    if (stats.size > this.limits.maxBytes) {
      throw new ImportRejectedError(`${filename} is larger than the ${formatBytes(this.limits.maxBytes)} limit`);
    }

    if (await this.storage.isInside(path)) {
      throw new ImportRejectedError(`${filename} is already inside ClipForge's media folder`);
    }

    if (!format.matches(await readHeader(path))) {
      throw new ImportRejectedError(`${filename} is not a valid ${format.name} file`);
    }

    const free = await this.storage.freeBytes();
    if (free < stats.size + this.limits.freeSpaceMarginBytes) {
      throw new ImportRejectedError(
        `Not enough free disk space to import ${filename}: needs ${formatBytes(stats.size)}, ${formatBytes(free)} available`,
      );
    }

    return { absolutePath: path, filename, size: stats.size, extension, mime: format.mimeByExtension[extension] };
  }
}

/** O_NOFOLLOW: refuses a path swapped for a symlink after lstat. */
async function readHeader(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
