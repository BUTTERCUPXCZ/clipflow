# Phase 4 — Local AI integration: tasks

Spec: `spec/SPEC-phase-4.md`. Model: `qwen3-vl:8b-instruct`.

## AI service
- [x] Analysis package: schemas, frame budget, Whisper transcriber, Ollama vision client, visual analyzer, VRAM sampler
- [x] Pipeline stages TRANSCRIBING (20–50) and ANALYZING_VISUALS (50–99); transcript.json / visual.json; VISION_INVALID + MODEL_* codes
- [x] ExperimentRunner + `run_experiment` task on the same queue; StartExperiment gRPC; experiment events
- [x] Model vision capability (`/api/show`), worker health check, worker_running
- [x] Hermetic tests (fake transcriber/analyzer; no real model runs)

## API
- [x] Migration 0004: new job statuses, `video_analyses`, `experiments`
- [x] Store the analysis on job completion (fail the job if the result files are unreadable); `GET /videos/:id/analysis`
- [x] Experiments module: models, create (202), list, get, cancel, gRPC events, reconciler, WS `experiment.updated`
- [x] Worker health row; tests

## Desktop
- [x] Stage labels, no-worker hint (pending job + health says no worker), worker status row
- [x] Analysis card (Visual timeline, Transcript)
- [x] Experiments panel (model picker, frames per request, live progress, cancel) and Compare view
- [x] Tests

## Wrap-up
- [x] Docs (system-design §4.5, §4.6, §6.3, §6.5, §10, §14.2; README)
- [x] Independent code review, then fix the findings (6 Important fixed)
- [x] End-to-end run on the real stack (11:20 video: processing + experiments)
- [ ] (script ready; full run still open) Evals: `apps/ai-service/evals/run_eval.py` compares batch size 4 vs 1 and Whisper small vs medium, and writes `doc/evals/phase-4-vision-models.md`
- [x] Model + settings decided by measurement on the target laptop (RTX 4050 6 GB, 16 GB RAM):
  - 8B: 58 % on CPU, filled RAM and swap, ~8 min per 4-frame batch once swapping → default is now `qwen3-vl:4b-instruct`
  - 4B, 4 frames/request: 18.3 s/frame, 13/15 batches valid (180 answer tokens/frame cut JSON off)
  - 4B, 2 frames/request, 250 tokens/frame, context sized per request: 9.7 s/frame in the app, 30/30 valid
  - Frame width does not change image tokens (Ollama resizes every image; ~1,050 tokens each)
- [x] Fixes found in real runs: Ollama context size, faster-whisper vs PyAV 19 (WAV read directly), description cutoff (prompt v2)
