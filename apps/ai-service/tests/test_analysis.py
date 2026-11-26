import json
import wave
from types import SimpleNamespace

import httpx
import numpy as np
import pytest

from app.analysis.frame_budget import batches, select_evenly
from app.analysis.ollama_vision import (
    ModelNotInstalled,
    ModelRuntimeUnavailable,
    OllamaVisionClient,
    VisionReply,
    context_size,
)
from app.analysis.transcriber import TranscriptionError, Transcriber, read_wav
from app.analysis.visual_analyzer import VisualAnalyzer, whole_sentences
from app.analysis.vram import VramSampler
from app.media.ffmpeg_runner import FfmpegCancelled

FRAMES = [{"index": i, "file": f"frame-{i + 1:06d}.jpg", "timestampSeconds": float(i)} for i in range(6)]


def scene(ts: float, **overrides) -> dict:
    base = {
        "timestampSeconds": ts,
        "description": "A person talks to the camera.",
        "subjects": ["person"],
        "actions": ["talking"],
        "cameraFraming": "medium",
        "verticalCropSuitable": True,
        "observations": ["centered subject"],
    }
    return base | overrides


class FakeVision:
    """Answers each call with the next scripted reply (a dict → JSON, a str as is, or an exception)."""

    def __init__(self, *replies) -> None:
        self.replies = list(replies)
        self.prompts: list[str] = []

    def chat(self, model, prompt, images, schema, max_tokens):
        self.prompts.append(prompt)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        content = reply if isinstance(reply, str) else json.dumps(reply)
        return VisionReply(content=content, load_ms=10, inference_ms=100)


@pytest.fixture
def frames_dir(tmp_path):
    for f in FRAMES:
        (tmp_path / f["file"]).write_bytes(b"\xff\xd8")
    return tmp_path


# --- frame budget ---


def test_select_evenly_keeps_first_and_last_and_short_lists():
    picked = select_evenly(list(range(600)), 60)
    assert len(picked) == 60 and picked[0] == 0 and picked[-1] == 599
    assert select_evenly([1, 2, 3], 60) == [1, 2, 3]
    assert batches([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]]


# --- visual analyzer ---


def test_valid_batches_become_sorted_scenes_with_metrics(frames_dir):
    fake = FakeVision({"scenes": [scene(1.0), scene(0.0)]}, {"scenes": [scene(2.0), scene(3.0)]})
    progress: list[float] = []

    result = VisualAnalyzer(fake).analyze(frames_dir, FRAMES[:4], model="m", batch_size=2, on_progress=progress.append)

    assert [s["timestampSeconds"] for s in result["scenes"]] == [0.0, 1.0, 2.0, 3.0]
    assert result["metrics"] == {"loadMs": 20, "inferenceMs": 200, "framesAnalysed": 4, "validBatches": 2, "totalBatches": 2}
    assert progress == [0.5, 1.0]
    assert "Image 1 is at timestampSeconds=0.0." in fake.prompts[0]


def test_an_invalid_answer_is_retried_once_with_the_error(frames_dir):
    fake = FakeVision("not json", {"scenes": [scene(0.0)]})

    result = VisualAnalyzer(fake).analyze(frames_dir, FRAMES[:1], model="m", batch_size=1)

    assert result["batches"][0] | {"errors": []} == {"frameIndexes": [0], "valid": True, "attempts": 2, "errors": []}
    assert "previous answer was invalid" in fake.prompts[1]


def test_twice_invalid_is_kept_with_raw_output_and_errors(frames_dir):
    fake = FakeVision({"scenes": [scene(9.0)]}, {"scenes": [scene(0.0, cameraFraming="drone")]})

    result = VisualAnalyzer(fake).analyze(frames_dir, FRAMES[:1], model="m", batch_size=1)

    batch = result["batches"][0]
    assert batch["valid"] is False and batch["attempts"] == 2
    assert "not one of the images' timestamps" in batch["errors"][0]
    assert "drone" in batch["raw"]
    assert result["scenes"] == [] and result["metrics"]["validBatches"] == 0


def test_a_timeout_counts_as_a_failed_attempt(frames_dir):
    fake = FakeVision(TimeoutError("the model did not answer within 300 s"), {"scenes": [scene(0.0)]})

    result = VisualAnalyzer(fake).analyze(frames_dir, FRAMES[:1], model="m", batch_size=1)

    assert result["batches"][0]["valid"] is True


def test_runtime_errors_stop_the_analysis(frames_dir):
    with pytest.raises(ModelNotInstalled):
        VisualAnalyzer(FakeVision(ModelNotInstalled("m"))).analyze(frames_dir, FRAMES[:1], model="m", batch_size=1)


def test_cancel_between_batches(frames_dir):
    with pytest.raises(FfmpegCancelled):
        VisualAnalyzer(FakeVision()).analyze(frames_dir, FRAMES, model="m", batch_size=2, should_cancel=lambda: True)


# --- Ollama client error mapping ---


def ollama(handler) -> OllamaVisionClient:
    return OllamaVisionClient("http://ollama.test", transport=httpx.MockTransport(handler))


def test_ollama_reply_and_timings(tmp_path):
    (tmp_path / "f.jpg").write_bytes(b"x")
    sent = []

    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": "{}"}, "load_duration": 2e6, "total_duration": 5e6})

    reply = ollama(handler).chat("m", "p", [tmp_path / "f.jpg"], {}, 100)

    assert sent[0]["options"] == {"temperature": 0, "num_predict": 100, "num_ctx": 2048}
    assert (reply.content, reply.load_ms, reply.inference_ms) == ("{}", 2.0, 3.0)


def test_context_fits_the_images_and_the_answer():
    assert context_size(2, 500) == 3072  # 2×1100 + 256 + 500 = 2956
    assert context_size(4, 1000) == 6144  # Ollama's default 4096 was too small here
    assert context_size(0, 600, "a" * 12000) == 5120  # text: 256 + 4000 + 600 = 4856
    assert context_size(0, 100, "short") == 4096  # text calls never get less than Ollama's default
    assert context_size(0, 500, "日本語" * 2000) == 7168  # 6000 + 256 + 500: each CJK char counted as a token


def test_ollama_missing_model_and_down_runtime(tmp_path):
    (tmp_path / "f.jpg").write_bytes(b"x")
    with pytest.raises(ModelNotInstalled, match="ollama pull m"):
        ollama(lambda r: httpx.Response(404, json={"error": "model 'm' not found"})).chat("m", "p", [tmp_path / "f.jpg"], {}, 1)

    def down(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(ModelRuntimeUnavailable, match="Ollama is not running"):
        ollama(down).chat("m", "p", [tmp_path / "f.jpg"], {}, 1)


# --- transcriber (fake Whisper) ---


class FakeWhisper:
    def transcribe(self, path, **kwargs):
        word = SimpleNamespace(start=0.5, end=0.9, word=" Hello", probability=0.98)
        segments = [
            SimpleNamespace(start=0.4, end=2.0, text=" Hello there.", words=[word]),
            SimpleNamespace(start=2.0, end=4.0, text=" Second line.", words=[]),
        ]
        return iter(segments), SimpleNamespace(language="en")


def wav(tmp_path, rate: int = 16000):
    path = tmp_path / "a.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.array([0, 16384, -32768], dtype=np.int16).tobytes())
    return path


def test_read_wav_gives_float_samples_and_rejects_other_formats(tmp_path):
    assert read_wav(wav(tmp_path)).tolist() == [0.0, 0.5, -1.0]
    with pytest.raises(ValueError, match="16 kHz mono"):
        read_wav(wav(tmp_path, rate=44100))


def test_transcriber_builds_timestamped_segments_and_progress(tmp_path):
    progress: list[float] = []
    result = Transcriber(factory=lambda *a, **k: FakeWhisper()).transcribe(
        wav(tmp_path), duration=4.0, on_progress=progress.append
    )

    assert result["language"] == "en"
    assert result["segments"][0] == {
        "start": 0.4, "end": 2.0, "text": "Hello there.",
        "words": [{"start": 0.5, "end": 0.9, "word": "Hello", "probability": 0.98}],
    }
    assert progress == [0.5, 1.0]


def test_transcriber_reports_a_model_that_cannot_load(tmp_path):
    def broken(*a, **k):
        raise OSError("no such model")

    with pytest.raises(TranscriptionError, match="could not load Whisper model"):
        Transcriber(factory=broken).transcribe(tmp_path / "a.wav", duration=1.0)


def test_transcriber_cancels_between_segments(tmp_path):
    with pytest.raises(FfmpegCancelled):
        Transcriber(factory=lambda *a, **k: FakeWhisper()).transcribe(wav(tmp_path), duration=4.0, should_cancel=lambda: True)


# --- VRAM sampler ---


def test_vram_sampler_keeps_the_peak_and_tolerates_no_gpu():
    readings = iter([1000, 4200, 3000])
    with VramSampler(interval=0.01, reader=lambda: next(readings, 2000)) as vram:
        pass
    assert vram.peak_mib == 4200
    with VramSampler(interval=0.01, reader=lambda: None) as none:
        pass
    assert none.peak_mib is None


def test_a_batch_missing_a_frame_is_retried_not_silently_short(frames_dir):
    vision = FakeVision({"scenes": [scene(0.0)]}, {"scenes": [scene(0.0), scene(1.0)]})

    result = VisualAnalyzer(vision).analyze(frames_dir, FRAMES[:2], model="m", batch_size=2)

    assert "no scene for timestampSeconds [1.0]" in vision.prompts[1]
    assert [s["timestampSeconds"] for s in result["scenes"]] == [0.0, 1.0]


def test_ollama_server_errors_and_non_json_replies(tmp_path):
    (tmp_path / "f.jpg").write_bytes(b"x")
    with pytest.raises(ModelRuntimeUnavailable, match="Ollama failed \\(500\\)"):
        ollama(lambda r: httpx.Response(500, text="out of memory")).chat("m", "p", [tmp_path / "f.jpg"], {}, 1)
    with pytest.raises(ValueError, match="not JSON"):
        ollama(lambda r: httpx.Response(200, text="<html>")).chat("m", "p", [tmp_path / "f.jpg"], {}, 1)


def test_capped_descriptions_keep_whole_sentences():
    capped = ("A player aims a rifle at a white box. " * 6)[:200]  # cut mid-sentence by the cap
    assert whole_sentences(capped).endswith("white box.") and len(whole_sentences(capped)) < 200
    one_long = ("word " * 50)[:200]
    assert whole_sentences(one_long).endswith("word…")
    assert whole_sentences("A short one. Done") == "A short one. Done"  # under the cap: unchanged
