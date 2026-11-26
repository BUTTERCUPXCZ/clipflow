/** Subtitle cues for a clip, built from Whisper word timestamps (no model involved, so edits always match). */

export interface Word {
  start: number;
  end: number;
  word: string;
}

export interface Cue {
  start: number; // seconds from the clip start
  end: number;
  text: string;
}

export const CUE_MAX_CHARS = 32;
export const CUE_MAX_SECONDS = 3;

const round = (n: number) => Math.round(n * 100) / 100;

/** Words fully inside [start, end], grouped into cues of at most CUE_MAX_CHARS characters and CUE_MAX_SECONDS. */
export function buildCues(words: Word[], start: number, end: number): Cue[] {
  const inside = words.filter((w) => w.start >= start - 1e-6 && w.end <= end + 1e-6 && w.word.trim());
  const cues: Cue[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({
      start: round(current[0].start - start),
      end: round(current[current.length - 1].end - start),
      text: current.map((w) => w.word.trim()).join(' '),
    });
    current = [];
  };
  for (const word of inside) {
    const text = [...current, word].map((w) => w.word.trim()).join(' ');
    if (current.length && (text.length > CUE_MAX_CHARS || word.end - current[0].start > CUE_MAX_SECONDS)) flush();
    current.push(word);
    if (/[.!?]$/.test(word.word.trim())) flush();
  }
  flush();
  return cues;
}

/** All words of a transcript (segments → words), in time order. */
export function transcriptWords(transcript: unknown): Word[] {
  const segments = (transcript as { segments?: { words?: Word[] }[] } | null)?.segments ?? [];
  return segments.flatMap((s) => s.words ?? []);
}
