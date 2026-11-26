import { buildCues, CUE_MAX_CHARS, CUE_MAX_SECONDS, transcriptWords } from './subtitles.js';

const w = (start: number, end: number, word: string) => ({ start, end, word });

describe('buildCues', () => {
  it('keeps only words inside the clip and times them from the clip start', () => {
    const cues = buildCues([w(1, 1.5, 'Before'), w(10, 10.4, 'Hi'), w(10.5, 11, 'you.'), w(31, 31.5, 'after')], 9.7, 30);

    expect(cues).toEqual([{ start: 0.3, end: 1.3, text: 'Hi you.' }]);
  });

  it('splits long speech into short cues by length and duration', () => {
    const many = Array.from({ length: 20 }, (_, i) => w(i * 0.4, i * 0.4 + 0.3, `word${i}`));

    const cues = buildCues(many, 0, 10);

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.every((c) => c.text.length <= CUE_MAX_CHARS && c.end - c.start <= CUE_MAX_SECONDS)).toBe(true);
    expect(cues.map((c) => c.text).join(' ')).toBe(many.map((x) => x.word).join(' '));
  });

  it('reads the words of every transcript segment and tolerates no transcript', () => {
    expect(transcriptWords({ segments: [{ words: [w(0, 1, 'a')] }, {}, { words: [w(2, 3, 'b')] }] })).toHaveLength(2);
    expect(transcriptWords(null)).toEqual([]);
  });
});
