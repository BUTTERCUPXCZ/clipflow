"""Frames → validated scene observations (system-design §4.6). Used by processing jobs and experiments alike."""

from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError

from app.analysis.frame_budget import batches
from app.analysis.ollama_vision import VisionReply
from app.analysis.schemas import DESCRIPTION_MAX, PROMPT_VERSION, BatchResult, batch_schema
from app.media.ffmpeg_runner import FfmpegCancelled

RAW_LIMIT = 4000  # characters of raw output kept per invalid batch


class VisionClient(Protocol):
    def chat(self, model: str, prompt: str, images: list[Path], schema: dict, max_tokens: int) -> VisionReply: ...


def build_prompt(frames: list[dict]) -> str:
    stamps = "\n".join(f"Image {i + 1} is at timestampSeconds={f['timestampSeconds']}." for i, f in enumerate(frames))
    return (
        "You analyse still frames sampled from a video, to help cut it into short vertical clips.\n"
        f"{stamps}\n"
        "Return exactly one scene per image, using that image's timestampSeconds unchanged.\n"
        "Describe only what is visible in the image. Never mention speech, sound or anything you cannot see.\n"
        "description: ONE sentence of at most 20 words, the main subject and what happens.\n"
        "Put other details (HUD, text on screen, background) in observations, a few words each.\n"
        "Answer with JSON only."
    )


class VisualAnalyzer:
    def __init__(self, client: VisionClient, tokens_per_frame: int = 180, max_attempts: int = 2) -> None:
        self._client = client
        self._tokens_per_frame = tokens_per_frame
        self._max_attempts = max_attempts

    def analyze(
        self,
        frames_dir: Path,
        frames: list[dict],
        *,
        model: str,
        batch_size: int,
        on_progress: Callable[[float], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict:
        """`frames`: entries of frames.json ({index, file, timestampSeconds}) already chosen by the frame budget.
        ModelRuntimeUnavailable / ModelNotInstalled propagate: no point trying the next batch."""
        groups = batches(frames, batch_size)
        scenes: list[dict] = []
        records: list[dict] = []
        load_ms = inference_ms = 0.0
        for done, group in enumerate(groups, start=1):
            if should_cancel and should_cancel():
                raise FfmpegCancelled()
            record, batch_scenes, timings = self._run_batch(frames_dir, group, model)
            records.append(record)
            scenes.extend(batch_scenes)
            load_ms += timings[0]
            inference_ms += timings[1]
            if on_progress:
                on_progress(done / len(groups))
        valid = sum(1 for r in records if r["valid"])
        return {
            "model": model,
            "promptVersion": PROMPT_VERSION,
            "frames": [{"index": f["index"], "timestampSeconds": f["timestampSeconds"]} for f in frames],
            "scenes": sorted(scenes, key=lambda s: s["timestampSeconds"]),
            "batches": records,
            "metrics": {
                "loadMs": round(load_ms),
                "inferenceMs": round(inference_ms),
                "framesAnalysed": len(frames),
                "validBatches": valid,
                "totalBatches": len(records),
            },
        }

    def _run_batch(self, frames_dir: Path, group: list[dict], model: str) -> tuple[dict, list[dict], tuple[float, float]]:
        prompt = build_prompt(group)
        images = [frames_dir / f["file"] for f in group]
        allowed = {f["timestampSeconds"] for f in group}
        errors: list[str] = []
        raw = ""
        load_ms = inference_ms = 0.0
        for attempt in range(1, self._max_attempts + 1):
            # A retry tells the model what was wrong with its previous answer.
            correction = f"\nYour previous answer was invalid: {errors[-1]}. Fix it." if errors else ""
            try:
                reply = self._client.chat(model, prompt + correction, images, batch_schema(), self._tokens_per_frame * len(group))
            except (TimeoutError, ValueError) as exc:  # worst case per batch: max_attempts × request timeout
                errors.append(str(exc)[:500])
                continue
            load_ms += reply.load_ms
            inference_ms += reply.inference_ms
            raw = reply.content
            try:
                scenes = _validate(reply.content, allowed)
            except ValueError as exc:
                errors.append(str(exc)[:500])
                continue
            record = {"frameIndexes": [f["index"] for f in group], "valid": True, "attempts": attempt, "errors": errors}
            return record, scenes, (load_ms, inference_ms)
        record = {
            "frameIndexes": [f["index"] for f in group],
            "valid": False,
            "attempts": self._max_attempts,
            "errors": errors,
            "raw": raw[:RAW_LIMIT],
        }
        return record, [], (load_ms, inference_ms)


def whole_sentences(text: str) -> str:
    """The model often writes until the length cap and stops mid-word. A capped text keeps its complete
    sentences, or (if it is one long sentence) ends at a word boundary with an ellipsis."""
    text = text.strip()
    if len(text) < DESCRIPTION_MAX - 5:
        return text
    end = max(text.rfind(". "), text.rfind("! "), text.rfind("? "))
    if end > 0:
        return text[: end + 1]
    return text[: text.rfind(" ")].rstrip(",;:") + "…" if " " in text else text


def _validate(content: str, allowed_timestamps: set[float]) -> list[dict]:
    try:
        result = BatchResult.model_validate_json(content)
    except ValidationError as exc:
        raise ValueError(f"schema: {exc.errors(include_url=False)[:3]}") from exc
    scenes = []
    seen: set[float] = set()
    for scene in result.scenes:
        if scene.timestampSeconds not in allowed_timestamps:
            raise ValueError(f"timestampSeconds {scene.timestampSeconds} is not one of the images' timestamps")
        if scene.timestampSeconds not in seen:  # keep the first answer if the model repeats a frame
            seen.add(scene.timestampSeconds)
            scenes.append(scene.model_dump() | {"description": whole_sentences(scene.description)})
    missing = sorted(allowed_timestamps - seen)
    if missing:  # a "valid" batch must not silently drop frames
        raise ValueError(f"no scene for timestampSeconds {missing}: answer one scene per image")
    return scenes
