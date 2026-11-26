/**
 * Video container formats ClipForge accepts, each recognised by its file signature (spec Phase 2, rule 4).
 * Open/closed: supporting a new container means adding one entry here, nothing else.
 * This only proves the file *is* that container; whether its codecs decode is FFprobe's job in Phase 3.
 */
export interface ContainerFormat {
  readonly name: string;
  /** lower-case extension (without dot) → MIME type stored with the video */
  readonly mimeByExtension: Readonly<Record<string, string>>;
  matches(header: Buffer): boolean;
}

/** Enough bytes for the deepest check (M2TS sync byte at offset 196). */
export const HEADER_BYTES = 200;

const ascii = (header: Buffer, offset: number, text: string) =>
  header.subarray(offset, offset + text.length).toString('latin1') === text;

const bytes = (header: Buffer, offset: number, expected: readonly number[]) =>
  header.length >= offset + expected.length && expected.every((value, i) => header[offset + i] === value);

const ISO_BMFF_LEADING_ATOMS = ['ftyp', 'moov', 'mdat', 'wide', 'free'];
const TS_SYNC = 0x47;

export const CONTAINER_FORMATS: readonly ContainerFormat[] = [
  {
    name: 'ISO base media (MP4 / QuickTime / 3GP)',
    mimeByExtension: {
      mp4: 'video/mp4',
      m4v: 'video/x-m4v',
      mov: 'video/quicktime',
      '3gp': 'video/3gpp',
      '3g2': 'video/3gpp2',
    },
    // Box type at offset 4; very old QuickTime files may start with moov/mdat/wide/free instead of ftyp.
    matches: (h) => ISO_BMFF_LEADING_ATOMS.some((atom) => ascii(h, 4, atom)),
  },
  {
    name: 'Matroska / WebM',
    mimeByExtension: { mkv: 'video/x-matroska', webm: 'video/webm' },
    matches: (h) => bytes(h, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    name: 'AVI',
    mimeByExtension: { avi: 'video/x-msvideo' },
    matches: (h) => ascii(h, 0, 'RIFF') && ascii(h, 8, 'AVI '),
  },
  {
    name: 'MPEG transport stream',
    mimeByExtension: { ts: 'video/mp2t' },
    matches: (h) => h[0] === TS_SYNC && h[188] === TS_SYNC, // 188-byte packets
  },
  {
    name: 'MPEG-2 transport stream (AVCHD / Blu-ray)',
    mimeByExtension: { mts: 'video/mp2t', m2ts: 'video/mp2t' },
    matches: (h) => h[4] === TS_SYNC && h[196] === TS_SYNC, // 192-byte packets with a 4-byte timecode
  },
  {
    name: 'MPEG program stream',
    mimeByExtension: { mpg: 'video/mpeg', mpeg: 'video/mpeg', vob: 'video/mpeg' },
    matches: (h) => bytes(h, 0, [0x00, 0x00, 0x01, 0xba]),
  },
  {
    name: 'ASF / Windows Media',
    mimeByExtension: { wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf' },
    matches: (h) => bytes(h, 0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]),
  },
  {
    name: 'Flash video',
    mimeByExtension: { flv: 'video/x-flv' },
    matches: (h) => ascii(h, 0, 'FLV'),
  },
  {
    name: 'Ogg',
    mimeByExtension: { ogv: 'video/ogg' },
    matches: (h) => ascii(h, 0, 'OggS'),
  },
  {
    name: 'MXF',
    mimeByExtension: { mxf: 'application/mxf' },
    matches: (h) => bytes(h, 0, [0x06, 0x0e, 0x2b, 0x34]),
  },
];

export const SUPPORTED_EXTENSIONS: readonly string[] = CONTAINER_FORMATS.flatMap((f) => Object.keys(f.mimeByExtension));

export function formatForExtension(extension: string): ContainerFormat | undefined {
  const ext = extension.toLowerCase();
  // Own keys only: `in` would also match inherited names like "constructor" or "__proto__".
  return CONTAINER_FORMATS.find((format) => Object.hasOwn(format.mimeByExtension, ext));
}
