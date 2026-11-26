import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { NotFoundException, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/** One `bytes=` range (players ask for one at a time); null = no or malformed header → send the whole file. */
export function parseRange(header: string | undefined, size: number): ByteRange {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2])); // suffix range: the last N bytes
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/** Streams a file with HTTP Range support (206 / 416), so video players can seek. */
export async function sendFile(path: string, type: string, rangeHeader: string | undefined, res: Response): Promise<StreamableFile> {
  const size = await stat(path).then(
    (s) => s.size,
    () => {
      throw new NotFoundException('File not found');
    },
  );
  res.setHeader('Accept-Ranges', 'bytes');
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    return new StreamableFile(Buffer.alloc(0));
  }
  if (range === null) return new StreamableFile(createReadStream(path), { type, length: size });
  res.status(206).setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  return new StreamableFile(createReadStream(path, range), { type, length: range.end - range.start + 1 });
}
