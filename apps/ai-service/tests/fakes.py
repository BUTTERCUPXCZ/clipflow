"""Model fakes shared by tests: no test may download or run a real model (opt-in RUN_MODEL_TESTS only)."""


class FakeTranscriber:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls = 0

    def transcribe(self, audio, *, duration, on_progress=None, should_cancel=None):
        self.calls += 1
        if self.error:
            raise self.error
        if on_progress:
            on_progress(1.0)
        return {
            "language": "en",
            "durationSeconds": duration,
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hello.", "words": []}],
        }


class FakeAnalyzer:
    """Returns one valid scene per frame, or a result with no valid batch, or raises."""

    def __init__(self, valid: bool = True, error: Exception | None = None) -> None:
        self.valid = valid
        self.error = error
        self.frames_seen: list[dict] = []

    def analyze(self, frames_dir, frames, *, model, batch_size, on_progress=None, should_cancel=None):
        self.frames_seen = frames
        if self.error:
            raise self.error
        if on_progress:
            on_progress(1.0)
        scenes = [
            {
                "timestampSeconds": f["timestampSeconds"],
                "description": "A test pattern.",
                "subjects": ["pattern"],
                "actions": [],
                "cameraFraming": "screen-capture",
                "verticalCropSuitable": False,
                "observations": [],
            }
            for f in frames
        ] if self.valid else []
        return {
            "model": model,
            "promptVersion": "visual-v2",
            "frames": [{"index": f["index"], "timestampSeconds": f["timestampSeconds"]} for f in frames],
            "scenes": scenes,
            "batches": [{"frameIndexes": [f["index"] for f in frames], "valid": self.valid, "attempts": 1, "errors": []}],
            "metrics": {
                "loadMs": 1,
                "inferenceMs": 2,
                "framesAnalysed": len(frames),
                "validBatches": 1 if self.valid else 0,
                "totalBatches": 1,
            },
        }
