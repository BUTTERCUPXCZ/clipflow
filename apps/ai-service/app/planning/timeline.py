"""Pure timeline functions: what the planner shows the model, and how proposed times become exact clip boundaries.
Times are seconds in the source video; segments are transcript segments ({start, end, text})."""

from dataclasses import dataclass

PAD_SECONDS = 0.3  # breathing room so a clip does not start or stop on the first/last syllable


@dataclass(frozen=True)
class Window:
    start: float
    end: float
    segments: list[dict]
    scenes: list[dict]

    def prompt_text(self) -> str:
        lines = [f"[{s['start']:.1f}-{s['end']:.1f}] {s['text'].strip()}" for s in self.segments]
        visuals = [f"[{s['timestampSeconds']:.1f}] {s['description']}" for s in self.scenes]
        return "TRANSCRIPT:\n" + "\n".join(lines) + ("\nVISIBLE:\n" + "\n".join(visuals) if visuals else "")


UNIT_MAX_SECONDS = 12.0
UNIT_PAUSE_SECONDS = 0.7


def units(segments: list[dict]) -> list[dict]:
    """Sentence-like units from word timestamps. Whisper segments can be minutes long on unpunctuated speech
    (game casting: one 111 s segment held 13 words around a 60 s silence), which no clip length can snap to.
    A unit ends at . ! ?, before a pause of UNIT_PAUSE_SECONDS, or at UNIT_MAX_SECONDS."""
    result: list[dict] = []
    for segment in segments:
        words = [w for w in segment.get("words") or [] if w["end"] > w["start"] and w["word"].strip()]
        if not words:
            result.append({"start": segment["start"], "end": segment["end"], "text": segment["text"].strip()})
            continue
        current: list[dict] = []
        for word in words:
            if current and (
                word["start"] - current[-1]["end"] >= UNIT_PAUSE_SECONDS
                or word["end"] - current[0]["start"] > UNIT_MAX_SECONDS
            ):
                result.append(_unit(current))
                current = []
            current.append(word)
            if word["word"].strip().endswith((".", "!", "?", "。", "！", "？")):
                result.append(_unit(current))
                current = []
        if current:
            result.append(_unit(current))
    return result


def _unit(words: list[dict]) -> dict:
    return {"start": words[0]["start"], "end": words[-1]["end"], "text": " ".join(w["word"].strip() for w in words)}


def spoken(segments: list[dict]) -> list[dict]:
    return [s for s in segments if s["text"].strip() and s["end"] > s["start"]]


def word_count(segments: list[dict]) -> int:
    return sum(len(s["text"].split()) for s in segments)


def windows(segments: list[dict], scenes: list[dict], length: float = 240.0, overlap: float = 20.0) -> list[Window]:
    """Consecutive stretches of about `length` seconds; neighbours share `overlap` seconds so a moment on a border
    is seen whole in one of them. A window always holds whole segments."""
    if not segments:
        return []
    result: list[Window] = []
    start = segments[0]["start"]
    last_end = segments[-1]["end"]
    while True:
        end = start + length
        inside = [s for s in segments if s["start"] >= start and s["start"] < end]
        if inside:
            w_end = max(s["end"] for s in inside)
            seen = [s for s in scenes if start <= s["timestampSeconds"] <= w_end]
            result.append(Window(start, w_end, inside, seen))
        if end >= last_end:
            return result
        later = [s["start"] for s in segments if s["start"] >= end - overlap]
        # Jump over silence to the next speech: the loop is bounded by the segments, not by the time span.
        start = max(end - overlap, min(later)) if later else last_end


def snap(start: float, end: float, segments: list[dict], duration: float) -> tuple[float, float] | None:
    """Start at the beginning of the sentence holding `start` (or the next one), end at the end of the sentence
    holding `end` (or the previous one). None when nothing spoken lies between."""
    first = next((s for s in segments if s["end"] > start), None)
    last = next((s for s in reversed(segments) if s["start"] < end), None)
    if first is None or last is None or last["end"] <= first["start"]:
        return None
    return max(0.0, first["start"] - PAD_SECONDS), min(duration, last["end"] + PAD_SECONDS)


def fit_length(
    start: float, end: float, segments: list[dict], duration: float, minimum: float, maximum: float
) -> tuple[float, float] | None:
    """Shorten (drop trailing sentences) or lengthen (add following sentences) a snapped clip until its length is
    within [minimum, maximum]. None if no whole-sentence range works."""
    ends = [min(duration, s["end"] + PAD_SECONDS) for s in segments if s["end"] + PAD_SECONDS > start]
    for candidate in sorted(set(ends), key=lambda e: abs(e - end)):
        if minimum <= candidate - start <= maximum:
            return start, candidate
    return None


def resolve_overlaps(clips: list[dict], limit: int) -> list[dict]:
    """Highest score wins an overlap; keeps at most `limit`; returns them in time order."""
    kept: list[dict] = []
    for clip in sorted(clips, key=lambda c: (-c["score"], c["startSeconds"])):
        if len(kept) == limit:
            break
        if all(clip["endSeconds"] <= k["startSeconds"] or clip["startSeconds"] >= k["endSeconds"] for k in kept):
            kept.append(clip)
    return sorted(kept, key=lambda c: c["startSeconds"])


def excerpt(segments: list[dict], start: float, end: float) -> str:
    return " ".join(s["text"].strip() for s in segments if s["start"] >= start - 1e-6 and s["end"] <= end + 1e-6)
