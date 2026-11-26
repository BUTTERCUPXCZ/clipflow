import { FIXTURE_HEADERS, TEXT_HEADER } from '../../../../test/fixtures/containers.js';
import { CONTAINER_FORMATS, formatForExtension, SUPPORTED_EXTENSIONS } from './container-signatures.js';

describe('container signatures', () => {
  it.each(Object.entries(FIXTURE_HEADERS))('recognises a %s header by its extension family', (ext, header) => {
    expect(formatForExtension(ext)!.matches(header)).toBe(true);
  });

  it.each(Object.keys(FIXTURE_HEADERS))('rejects a text file renamed to .%s', (ext) => {
    expect(formatForExtension(ext)!.matches(TEXT_HEADER)).toBe(false);
  });

  it('never lets one family accept another family\'s header', () => {
    for (const format of CONTAINER_FORMATS) {
      const foreign = Object.entries(FIXTURE_HEADERS).filter(([ext]) => formatForExtension(ext) !== format);
      for (const [ext, header] of foreign) {
        expect({ format: format.name, ext, matched: format.matches(header) }).toMatchObject({ matched: false });
      }
    }
  });

  it('requires both sync bytes for a transport stream', () => {
    const oneSync = Buffer.alloc(200);
    oneSync[0] = 0x47;

    expect(formatForExtension('ts')!.matches(oneSync)).toBe(false);
  });

  it('does not read past a truncated header', () => {
    expect(formatForExtension('wmv')!.matches(Buffer.from([0x30, 0x26]))).toBe(false);
    expect(formatForExtension('m2ts')!.matches(Buffer.alloc(10))).toBe(false);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not treat the inherited name "%s" as a supported extension',
    (ext) => {
      expect(formatForExtension(ext)).toBeUndefined();
    },
  );

  it('matches extensions case-insensitively and lists every supported extension once', () => {
    expect(formatForExtension('MP4')).toBe(formatForExtension('mp4'));
    expect(formatForExtension('txt')).toBeUndefined();
    expect(new Set(SUPPORTED_EXTENSIONS).size).toBe(SUPPORTED_EXTENSIONS.length);
    expect(SUPPORTED_EXTENSIONS).toEqual(
      expect.arrayContaining(['mp4', 'mov', 'mkv', 'webm', 'avi', 'ts', 'mts', 'm2ts', 'mpg', 'wmv', 'flv', 'ogv', 'mxf']),
    );
  });
});
