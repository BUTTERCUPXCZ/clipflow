import { mergeActivity } from '../modules/activity/activity.js';
import { parseRange } from './range-file.js';

describe('parseRange', () => {
  it('reads the byte ranges players send', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('sends the whole file for no or malformed headers, and 416 past the end', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=500-100', 1000)).toBe('unsatisfiable');
  });
});

describe('mergeActivity', () => {
  it('merges the three kinds, newest first', () => {
    const item = (id: string, at: number) => ({
      id, status: 'RUNNING', progress: 1, errorMessage: null, videoId: 'v', videoName: 'a.mp4', projectId: 'p', updatedAt: new Date(at),
    });

    const merged = mergeActivity({ processing: [item('j', 1)], planning: [item('p', 3)], rendering: [item('r', 2)] });

    expect(merged.map((m) => [m.id, m.kind])).toEqual([['p', 'planning'], ['r', 'rendering'], ['j', 'processing']]);
  });
});
