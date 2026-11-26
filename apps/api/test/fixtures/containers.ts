// Test-only: minimal file headers per container family (also used by the validator and service specs).
import { HEADER_BYTES } from '../../src/modules/videos/import/container-signatures.js';

const header = (write: (b: Buffer) => void): Buffer => {
  const b = Buffer.alloc(HEADER_BYTES);
  write(b);
  return b;
};

export const FIXTURE_HEADERS = {
  mp4: header((b) => b.write('ftypisom', 4, 'latin1')),
  mov: header((b) => b.write('moov', 4, 'latin1')),
  mkv: header((b) => b.set([0x1a, 0x45, 0xdf, 0xa3], 0)),
  avi: header((b) => {
    b.write('RIFF', 0, 'latin1');
    b.write('AVI ', 8, 'latin1');
  }),
  ts: header((b) => {
    b[0] = 0x47;
    b[188] = 0x47;
  }),
  mts: header((b) => {
    b[4] = 0x47;
    b[196] = 0x47;
  }),
  mpg: header((b) => b.set([0x00, 0x00, 0x01, 0xba], 0)),
  wmv: header((b) => b.set([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11], 0)),
  flv: header((b) => b.write('FLV', 0, 'latin1')),
  ogv: header((b) => b.write('OggS', 0, 'latin1')),
  mxf: header((b) => b.set([0x06, 0x0e, 0x2b, 0x34], 0)),
} as const;

export const TEXT_HEADER = Buffer.from('just some notes, definitely not a video\n'.repeat(8), 'latin1');
