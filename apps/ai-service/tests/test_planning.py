import json
import re

import pytest

from app.analysis.ollama_vision import ModelNotInstalled, VisionReply
from app.media.ffmpeg_runner import FfmpegCancelled
from app.planning import timeline
from app.planning.graph import max_llm_calls
from app.planning.planner import ClipPlanner, PlanFailure
from app.planning.schemas import PlanSettings

SETTINGS = PlanSettings(minSeconds=15, maxSeconds=60, maxClips=4)


def transcript(seconds: int = 600, step: int = 5) -> dict:
    """A sentence every `step` seconds, each ending 0.5 s before the next starts."""
    segments = [{"start": float(t), "end": t + step - 0.5, "text": f"Sentence at {t} has six words."} for t in range(0, seconds, step)]
    return {"language": "en", "segments": segments}


class FakeLlm:
    """Answers candidate prompts with `moments(window_start, window_end)` and copy prompts with valid copy."""

    def __init__(self, moments=None, copy=None, error: Exception | None = None) -> None:
        self.moments = moments or (lambda s, e: [{"startSeconds": s + 12, "endSeconds": s + 41, "score": 7, "reason": "Good."}])
        self.copy = copy
        self.error = error
        self.prompts: list[str] = []

    def close(self) -> None:
        pass

    def chat(self, model, prompt, images, schema, max_tokens):
        self.prompts.append(prompt)
        if self.error:
            raise self.error
        if "Pick the best" in prompt:
            s, e = map(float, re.search(r"lie between (\d+\.\d) and (\d+\.\d)", prompt).groups())
            return VisionReply(json.dumps({"candidates": self.moments(s, e)}), 0, 0)
        count = len(re.findall(r"^Clip \d+ ", prompt, re.M))
        clips = [{"index": i, "title": "A title", "hook": "A hook", "caption": "A caption."} for i in range(count)]
        return VisionReply(self.copy(count) if self.copy else json.dumps({"clips": clips}), 0, 0)


def plan(llm, data=None, duration=600.0, settings=SETTINGS, **kw):
    return ClipPlanner(llm, "m").plan(data or transcript(), {"scenes": []}, duration, settings, **kw)


# --- timeline (pure) ---


def test_windows_overlap_and_cover_the_whole_transcript():
    ws = timeline.windows(transcript()["segments"], [], length=240, overlap=20)
    assert [round(w.start) for w in ws] == [0, 220, 440]
    assert ws[-1].end == pytest.approx(599.5)


def test_snap_moves_times_to_whole_sentences_with_padding():
    segs = transcript()["segments"]
    assert timeline.snap(12.0, 41.0, segs, 600) == pytest.approx((9.7, 44.8))  # 10-14.5 … 40-44.5, ±0.3


def test_fit_length_trims_or_extends_by_whole_sentences():
    segs = transcript()["segments"]
    start, end = timeline.fit_length(9.7, 100.0, segs, 600, 15, 60)
    assert end - start <= 60 and end == pytest.approx(64.8)  # trimmed to the last sentence end that fits
    start, end = timeline.fit_length(9.7, 14.8, segs, 600, 15, 60)
    assert end - start >= 15  # extended by following sentences


def test_overlaps_keep_the_higher_score_and_the_limit():
    clips = [
        {"startSeconds": 0, "endSeconds": 30, "score": 5},
        {"startSeconds": 20, "endSeconds": 50, "score": 9},
        {"startSeconds": 60, "endSeconds": 90, "score": 1},
    ]
    assert [c["score"] for c in timeline.resolve_overlaps(clips, 1)] == [9]
    assert [c["score"] for c in timeline.resolve_overlaps(clips, 5)] == [9, 1]


# --- planner graph (fake LLM) ---


def test_plans_valid_non_overlapping_sentence_aligned_clips():
    progress: list[float] = []
    result = plan(FakeLlm(), on_progress=progress.append)

    clips = result["clips"]
    assert 1 <= len(clips) <= 4 and result["schemaVersion"] == "plan-v1"
    starts = {s["start"] - 0.3 for s in transcript()["segments"]} | {0.0}
    for c in clips:
        assert 15 <= c["endSeconds"] - c["startSeconds"] <= 60
        assert any(abs(c["startSeconds"] - s) < 1e-6 for s in starts)  # on a sentence start
        assert c["title"] == "A title"
    assert all(a["endSeconds"] <= b["startSeconds"] for a, b in zip(clips, clips[1:]))
    assert progress[-1] == 1.0 and progress == sorted(progress)


def test_an_invalid_window_answer_is_retried_then_skipped_and_calls_stay_bounded():
    llm = FakeLlm(moments=lambda s, e: [{"startSeconds": e + 100, "endSeconds": e + 130, "score": 5, "reason": "x"}]
                  if s > 0 else [{"startSeconds": s + 12, "endSeconds": s + 41, "score": 7, "reason": "Good."}])

    result = plan(llm)

    assert result["metrics"]["skippedWindows"] == 2  # windows 2 and 3 answered outside their range twice
    assert "outside" in result["skippedWindows"][0]["errors"][0]
    assert "Your previous answer was invalid" in llm.prompts[2]
    assert result["metrics"]["llmCalls"] <= max_llm_calls(result["metrics"]["windows"], 4)


def test_no_valid_moment_anywhere_fails_as_plan_invalid():
    with pytest.raises(PlanFailure) as failure:
        plan(FakeLlm(moments=lambda s, e: []))
    assert failure.value.code == "PLAN_INVALID"


def test_invalid_copy_twice_fails_instead_of_shipping_half_written_clips():
    with pytest.raises(PlanFailure, match="titles and captions"):
        plan(FakeLlm(copy=lambda n: "{not json"))


def test_too_little_speech_fails_as_no_speech_without_calling_the_model():
    llm = FakeLlm()
    with pytest.raises(PlanFailure) as failure:
        plan(llm, data={"language": "en", "segments": [{"start": 0, "end": 2, "text": "Hi there."}]})
    assert failure.value.code == "NO_SPEECH" and llm.prompts == []


def test_model_errors_propagate_and_cancel_stops_between_calls():
    with pytest.raises(ModelNotInstalled):
        plan(FakeLlm(error=ModelNotInstalled("m")))
    llm = FakeLlm()
    with pytest.raises(FfmpegCancelled):
        plan(llm, should_cancel=lambda: True)
    assert llm.prompts == []


def test_copy_is_written_in_the_transcript_language():
    llm = FakeLlm()
    plan(llm, data=transcript() | {"language": "tl"})
    assert any("code 'tl'" in p for p in llm.prompts)


def test_long_unpunctuated_segments_split_into_units_at_pauses():
    words = [
        {"start": 136.7, "end": 137.2, "word": "I", "probability": 0.1},
        {"start": 137.2, "end": 137.7, "word": "got", "probability": 0.7},
        {"start": 197.9, "end": 199.4, "word": "it.", "probability": 0.9},  # after a 60 s pause
        {"start": 199.5, "end": 200.0, "word": "Nice", "probability": 0.9},
    ]
    segments = [{"start": 136.7, "end": 248.0, "text": "I got it. Nice", "words": words}]

    assert [(u["start"], u["end"], u["text"]) for u in timeline.units(segments)] == [
        (136.7, 137.7, "I got"), (197.9, 199.4, "it."), (199.5, 200.0, "Nice"),
    ]


def test_the_model_may_not_answer_with_no_moment_at_all():
    from pydantic import ValidationError

    from app.planning.schemas import CandidateList

    with pytest.raises(ValidationError):  # the guard against "always []" under constrained decoding
        CandidateList(candidates=[])


def test_a_clip_ending_with_the_video_is_kept_even_with_an_odd_duration():
    duration = 100.456789  # ffprobe-style; the last sentence ends 0.06 s before the end
    data = transcript(seconds=100) | {}
    data["segments"][-1]["end"] = 100.4
    llm = FakeLlm(moments=lambda s, e: [{"startSeconds": 70, "endSeconds": 100.4, "score": 9, "reason": "End."}])

    result = plan(llm, data=data, duration=duration, settings=PlanSettings(minSeconds=15, maxSeconds=60, maxClips=1))

    assert result["clips"][0]["endSeconds"] <= duration


def test_windows_jump_over_long_silence():
    segments = [{"start": 0.0, "end": 2.0, "text": "a"}, {"start": 1_000_000.0, "end": 1_000_002.0, "text": "b"}]
    assert len(timeline.windows(segments, [])) == 2
