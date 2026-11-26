"""Speech → timestamped transcript with faster-whisper (system-design §4.5)."""

import gc
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from app.media.ffmpeg_runner import FfmpegCancelled

ModelFactory = Callable[..., Any]  # faster_whisper.WhisperModel or a test fake


class TranscriptionError(RuntimeError):
    pass


def _whisper_model(*args, **kwargs):
    from faster_whisper import WhisperModel  # imported lazily: heavy, and only the worker needs it

    return WhisperModel(*args, **kwargs)


class Transcriber:
    """Loads the model per job and frees it afterwards, so only one model occupies memory at a time (§14)."""

    def __init__(
        self,
        model_name: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        factory: ModelFactory = _whisper_model,
    ) -> None:
        self._model_name = model_name
        self._device = device
        self._compute_type = compute_type
        self._factory = factory

    def transcribe(
        self,
        audio: Path,
        *,
        duration: float,
        on_progress: Callable[[float], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict:
        try:
            model = self._factory(self._model_name, device=self._device, compute_type=self._compute_type)
        except Exception as exc:  # noqa: BLE001 — missing download, bad name, unsupported device
            raise TranscriptionError(f"could not load Whisper model {self._model_name!r}: {exc}") from exc
        try:
            segments, info = model.transcribe(read_wav(audio), word_timestamps=True, vad_filter=True)
            result = []
            for segment in segments:  # a generator: decoding happens while we iterate
                if should_cancel and should_cancel():
                    raise FfmpegCancelled()
                result.append(_segment(segment))
                if on_progress and duration > 0:
                    on_progress(min(1.0, segment.end / duration))
            return {"language": info.language, "durationSeconds": round(duration, 3), "segments": result}
        except FfmpegCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            raise TranscriptionError(f"transcription failed: {exc}") from exc
        finally:
            del model
            gc.collect()


def read_wav(path: Path) -> np.ndarray:
    """The extractor's 16 kHz mono s16 WAV as float32 samples. Passing samples skips faster-whisper's PyAV
    decoding, which breaks with PyAV >= 15 (`open()` lost `metadata_errors`)."""
    with wave.open(str(path), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError(f"expected 16 kHz mono 16-bit audio, got {wav.getparams()}")
        pcm = wav.readframes(wav.getnframes())
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def _segment(segment) -> dict:
    return {
        "start": round(segment.start, 3),
        "end": round(segment.end, 3),
        "text": segment.text.strip(),
        "words": [
            {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word.strip(), "probability": round(w.probability, 3)}
            for w in (segment.words or [])
        ],
    }
