import { constants, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface CopyOptions {
  /** Size validated before the copy; a different result means the source changed mid-copy. */
  expectedSize: number;
  signal?: AbortSignal;
  /** Called at most once per interval while copying, and once with the final count. Must not throw. */
  onProgress?: (bytesCopied: number) => unknown;
}

/**
 * Streams one file into place without ever holding it in memory.
 * Writes to `<destination>.part` and renames only after a complete, size-checked copy,
 * so a crash or abort never leaves something that looks like a finished file.
 */
export class MediaCopier {
  constructor(private readonly progressIntervalMs = 1000) {}

  async copy(source: string, destination: string, options: CopyOptions): Promise<void> {
    const part = `${destination}.part`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });

    let copied = 0;
    let lastReport = Date.now();
    const report = (bytes: number) => {
      try {
        void Promise.resolve(options.onProgress?.(bytes)).catch(() => undefined);
      } catch {
        // progress reporting must never break the copy
      }
    };
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        copied += chunk.length;
        if (Date.now() - lastReport >= this.progressIntervalMs) {
          lastReport = Date.now();
          report(copied);
        }
        callback(null, chunk);
      },
    });

    try {
      // O_NOFOLLOW: refuse a source swapped for a symlink after validation. The stream closes the handle.
      const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      await pipeline(
        input.createReadStream(),
        counter,
        createWriteStream(part, { mode: 0o600 }),
        { signal: options.signal },
      );
      const { size } = await stat(part);
      if (size !== options.expectedSize) {
        throw new Error(`the file changed while it was being imported (${size} of ${options.expectedSize} bytes)`);
      }
      await rename(part, destination);
      report(copied);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
  }
}
