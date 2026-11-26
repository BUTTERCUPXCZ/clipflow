"""Phase 4 eval: which settings of the default vision model work best here, and which Whisper size.

Drives the running app through its public API (the same path as the desktop), so the stack must be up:
`npm run dev:api` and `npm run dev:ai`. Each video must already be processed once.

    uv run python evals/run_eval.py --video <id> [--video <id> ...] [--batch-sizes 4,1] [--whisper small,medium]

Writes doc/evals/phase-4-vision-models.md: measured metrics plus a scoring sheet to fill in by hand.
"""

import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analysis.transcriber import Transcriber  # noqa: E402
from app.config import Settings  # noqa: E402
from evals.report import write_report  # noqa: E402

FINISHED = {"COMPLETED", "FAILED", "CANCELLED"}
REPO = Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default="http://localhost:3000/api/v1")
    p.add_argument("--video", action="append", required=True, help="video id (repeat for several)")
    p.add_argument("--batch-sizes", default="4,1", help="frames per request to compare")
    p.add_argument("--whisper", default="small,medium", help="Whisper sizes to time; empty to skip")
    p.add_argument("--timeout-hours", type=float, default=6.0, help="per experiment")
    p.add_argument("--out", type=Path, default=REPO / "doc/evals/phase-4-vision-models.md")
    return p.parse_args()


def latest_completed_job(api: httpx.Client, video_id: str) -> dict:
    jobs = api.get(f"/videos/{video_id}/jobs").raise_for_status().json()
    job = next((j for j in jobs if j["status"] == "COMPLETED"), None)
    if not job:
        sys.exit(f"video {video_id} has no completed processing job: process it in the app first")
    return job


def run_experiment(api: httpx.Client, video_id: str, model: str, batch_size: int, timeout_s: float) -> dict:
    experiment = api.post("/experiments", json={"videoId": video_id, "model": model, "batchSize": batch_size})
    experiment = experiment.raise_for_status().json()
    deadline = time.monotonic() + timeout_s
    while experiment["status"] not in FINISHED:
        if time.monotonic() > deadline:
            api.post(f"/experiments/{experiment['id']}/cancel")
            sys.exit(f"experiment {experiment['id']} timed out")
        time.sleep(10)
        experiment = api.get(f"/experiments/{experiment['id']}").raise_for_status().json()
        print(f"  {video_id[:8]} batch={batch_size}: {experiment['status']} {experiment['progress']}%", flush=True)
    return experiment


def time_whisper(settings: Settings, job: dict, size: str) -> dict:
    artifacts = job["artifacts"]
    if not artifacts.get("hasAudio"):
        return {"model": size, "skipped": "no audio"}
    audio = settings.media_root / artifacts["audioPath"]
    started = time.monotonic()
    transcript = Transcriber(size, settings.whisper_device, settings.whisper_compute_type).transcribe(
        audio, duration=artifacts["audioDurationSeconds"]
    )
    seconds = time.monotonic() - started
    text = " ".join(s["text"].strip() for s in transcript["segments"])
    return {
        "model": size,
        "seconds": seconds,
        "realtimeFactor": seconds / max(artifacts["audioDurationSeconds"], 1e-6),
        "segments": len(transcript["segments"]),
        "sample": text[:400],
    }


def main() -> None:
    args = parse_args()
    settings = Settings()
    batch_sizes = [int(b) for b in args.batch_sizes.split(",") if b]
    whisper_sizes = [w for w in args.whisper.split(",") if w]
    with httpx.Client(base_url=args.api, timeout=60) as api:
        models = api.get("/experiments/models").raise_for_status().json()
        model = next((m["name"] for m in models if m["isDefault"]), None)
        if not model:
            sys.exit(f"the default vision model is not installed; installed vision models: {[m['name'] for m in models]}")
        videos = []
        for video_id in args.video:
            video = api.get(f"/videos/{video_id}").raise_for_status().json()
            job = latest_completed_job(api, video_id)
            print(f"{video['filename']}: {len(batch_sizes)} experiments with {model}", flush=True)
            runs = [run_experiment(api, video_id, model, b, args.timeout_hours * 3600) for b in batch_sizes]
            whisper = [time_whisper(settings, job, size) for size in whisper_sizes]
            videos.append({"video": video, "job": job, "runs": runs, "whisper": whisper})
    write_report(args.out, model, args.api, videos)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
