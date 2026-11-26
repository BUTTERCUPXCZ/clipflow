# Spec: Phase 4 — Local AI Integration — V1

Status: approved (2026-11-26). Model decision: qwen3-vl:8b-instruct only; evals compare 8B settings, not models.
Source: `doc/system-design.md` §4.5–4.6, §6.5, §10, §14, §17 Phase 4; `doc/architecture.md` §6.
Builds on: Phase 3 (`spec/SPEC-phase-3.md`, `main` at `d5ddd51`). Standard: `CLAUDE.md`.

## Objective

Turn a processed video into **machine understanding**, still with no editing:
1. **Transcript:** what is said, with segment and word timestamps (faster-whisper).
2. **Visual analysis:** what is seen at sampled moments (Qwen3-VL through Ollama), as validated structured data grounded in the frames.
3. **Model experiments:** run visual analysis with any installed vision model on the same frames, keep raw and parsed output, validation errors, timings and peak VRAM, and **compare two runs side by side**.
4. **Evals:** after implementation, measure the candidates on a fixed set of real videos and record which is better for this laptop (see "Evaluation").

User stories:
1. I click **Process** and the job now continues *… → Transcribing → Analysing visuals → Completed*, with live progress.
2. On the video page I read the transcript with timestamps, and see a timeline of analysed moments: thumbnail, description, subjects, framing, and whether it suits a vertical crop.
3. If Ollama isn't running or the model isn't installed, the job fails with a message telling me exactly what to do. It doesn't hang.
4. On the **Experiments** tab I pick an installed model and run it on this video's frames. I see its progress, then its output, validity and speed. I select two runs and compare them frame by frame.
5. If I click Process while no worker is running, I'm told within seconds instead of seeing "Waiting to start" forever.

## Decisions (approved before this spec)

| Decision | Choice | Consequence |
|---|---|---|
| Frames analysed | **Even budget: up to 60 frames** spread over the video (first and last included), **4 frames per request** | Predictable time per video. Configurable: `VISION_MAX_FRAMES=60`, `VISION_BATCH_SIZE=4`. Short clips (≤ 60 s) analyse every frame. |
| Default vision model | **`qwen3-vl:8b-instruct`** (installed) | 6.2 GB is more than the 6 GB of VRAM, so Ollama offloads part to the CPU and analysis will be slow. That's accepted; the **evals measure it against 4B and 2B** and recommend a default with data. |
| Whisper | **CPU, int8, `small`** | No CUDA downloads, and the GPU stays free for the vision model. Configurable through `TRANSCRIPTION_MODEL` and `WHISPER_DEVICE=cpu`. |
| Experiments | **Run + compare** | Stored per run: the raw responses, the parsed output, the validation errors, model, prompt version, settings, load and inference time, and peak VRAM. The comparison view aligns two runs by frame timestamp. |
| Evals | **After implementation** | Candidates run on a small eval set of your videos with a scoring rubric. Results go in `doc/evals/phase-4-vision-models.md` with a recommendation; you decide the default. |

## Architecture changes

**Pipeline** (the same RQ worker and job, extended):

`VALIDATING → EXTRACTING_MEDIA → TRANSCRIBING → ANALYZING_VISUALS → COMPLETED`

| Status | Progress band | Notes |
|---|---|---|
| `VALIDATING` | 0–3 | |
| `EXTRACTING_MEDIA` | 3–20 | |
| `TRANSCRIBING` | 20–50 | Skipped when there is no audio |
| `ANALYZING_VISUALS` | 50–99 | One progress step per batch |

- **One model at a time** (system-design §14): Whisper is loaded, used and freed before the vision model runs.
- `OLLAMA_KEEP_ALIVE` (default `5m`) controls how long the vision model stays loaded afterwards.

**Outputs.** They are files in the job's artifacts directory, so gRPC messages stay small:
- `transcript.json`:

  ```text
  {language, durationSeconds,
   segments: [{start, end, text,
               words: [{start, end, word, probability}]}]}
  ```

- `visual.json`:

  ```text
  {model, promptVersion,
   frames: [{index, timestampSeconds}],
   scenes: [{timestampSeconds, description, subjects[], actions[],
             cameraFraming, verticalCropSuitable, observations[]}],
   batches: [{frameIndexes, valid, attempts, errors[], raw}]}
  ```

On completion NestJS reads both files (it can read `MEDIA_ROOT`) and stores them in the `video_analyses` table: `transcript`, `visual_analysis` and `model_metadata` as jsonb. The REST API serves them from there.

**Structured output and validation:**
- Calls use Ollama `/api/chat` with `format` set to the Pydantic JSON schema of a batch result, `temperature 0`, and the images as base64.
- The prompt version is recorded (`visual-v1`).
- Every response is validated with Pydantic. Each scene's timestamp must be one of the batch's frame timestamps, and the field types and enums are enforced.
- An invalid batch is retried **once** with the validation error appended. If it's still invalid, the batch is stored with its raw text and errors, and the run continues.
- The job completes with "N of M batches valid". It fails only if *no* batch is valid.

**Grounding (§4.6):** the prompt states the timestamp of each image, asks only for what is visible, and forbids claims about speech or sound.

**Errors:**

| Situation | Outcome |
|---|---|
| Ollama unreachable | Job FAILED `MODEL_RUNTIME_UNAVAILABLE`: "Ollama is not running. Start it and process again." |
| Model not installed | FAILED `MODEL_NOT_INSTALLED`: "qwen3-vl:8b-instruct is not installed: `ollama pull qwen3-vl:8b-instruct`" |
| Whisper fails | FAILED `TRANSCRIPTION_FAILED` with the reason |
| Inference timeout per batch | `VISION_REQUEST_TIMEOUT=300s`; counts as one failed attempt |

**Experiments** reuse the same `VisualAnalyzer` and frames (system-design §10.2):
- They run on the same RQ worker as a second task type, so they never compete with processing for the GPU.
- Peak VRAM comes from `nvidia-smi` sampled every 0.5 s during inference, or `null` if it isn't available.
- Load time comes from Ollama's `load_duration`.

**No worker running:**
- The AI service's `/health` gains a `worker` check (RQ worker registry), which also appears on System status.
- If a job stays `PENDING` for more than 10 s, the processing card says: "No processing worker is running. Start it with `npm run dev:ai`."

## Data Model (migration `0004`)

```text
processing_jobs.status CHECK  + TRANSCRIBING, ANALYZING_VISUALS
video_analyses   id · source_video_id → CASCADE · processing_job_id → CASCADE (unique) · user_id
                 transcript jsonb NULL · visual_analysis jsonb · model_metadata jsonb · created_at
experiments      id · source_video_id → CASCADE · processing_job_id (frames used) → CASCADE · user_id
                 model_name · prompt_version · settings jsonb · status (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED)
                 progress int · output jsonb NULL (visual.json shape) · metrics jsonb NULL
                 {loadMs, inferenceMs, totalMs, peakVramMiB, framesAnalysed, validBatches, totalBatches}
                 last_sequence · error_code · error_message · created/updated/completed_at
```

## API (base `/api/v1`)

| Method | Path | Result |
|---|---|---|
| GET | `/videos/:id/analysis` | Latest completed job's transcript + visual analysis (404 if none) |
| GET | `/experiments/models` | Installed Ollama models that accept images, with size, plus which one is the default |
| POST | `/experiments` | `{videoId, model}` → **202** experiment `PENDING`. 400 if the video has no completed processing job or the model isn't installed |
| GET | `/videos/:id/experiments` | Newest first |
| GET | `/experiments/:id` | Full output and metrics |
| POST | `/experiments/:id/cancel` | 202 |
| WS | `/ws` | + `experiment.updated` |

gRPC additions:
- `StartExperiment(experiment_id, frames_path, model, settings)`
- `CancelAnalysis` is reused for experiments
- JobEvents gets `ReportExperimentProgress`, `ReportExperimentCompletion` and `ReportExperimentFailure`, with the same sequence and `stop` semantics as jobs.

## Desktop

- **Video page, Analysis card** (latest completed job):
  - a **Transcript** tab: segments with clickable-looking timestamps and a copy button
  - a **Visual timeline** tab: a row per analysed moment, with thumbnail, time, description, subject chips, framing and a crop-suitable badge
  - a validity summary
- **Video page, Experiments tab:**
  - a model picker (installed vision models, sizes) and **Run experiment**
  - a list with status and live progress, model, duration, s/frame, peak VRAM and valid batches
  - **Compare**: pick two runs; a table of metrics side by side, then per timestamp each model's description next to the thumbnail, with invalid batches shown with their error and raw text
- The processing card shows the new stages and the no-worker hint.

## Evaluation (after implementation)

Goal: choose the default vision model, and confirm the Whisper setting, using measurements instead of guesses.

- **Eval set:** 3–5 of **your** videos covering different content, for example a talking head, a screen recording or app demo, and outdoor or b-roll footage. Each is processed once, and every candidate analyses the **same 60 frames** (system-design §10.2).
- **Candidates (approved: 8B only, no extra model pulls):** `qwen3-vl:8b-instruct` with **batch size 4 against 1** frames per request (speed against per-frame accuracy and validity). Experiments accept `batchSize` and `maxFrames` so the same feature drives the evals.
- **Automatic metrics per run** (from the experiments feature): load time, inference seconds per frame, total time, peak VRAM, and the JSON validity rate (valid batches / batches).
- **Quality metrics:** a rubric per frame on a sample of 10 frames per video, scored by you in a small eval sheet the script generates (Markdown with the thumbnails):
  - *Accuracy* 0–2: does the description match the frame?
  - *Hallucination* yes/no: anything stated that isn't visible?
  - *Crop suitability correct* yes/no
  - *Usefulness for clipping* 0–2
- **Whisper check:** `small` against `medium` on CPU for one speech-heavy video, measuring transcription time and your read of the errors in a 1-minute excerpt.
- **Output:** `doc/evals/phase-4-vision-models.md` with the results table, the quality scores, and a recommendation that weighs speed against quality on this laptop. The script is `apps/ai-service/evals/run_eval.py`, which drives the public API, so the evals use exactly what the app uses. It is reproducible.

## Commands

```bash
npm run dev:ai && npm run dev:api && npm run dev:desktop     # as before
cd apps/ai-service && uv run python -m evals.run_eval --videos <id,...> --models qwen3-vl:8b-instruct,qwen3-vl:4b,qwen3-vl:2b
npm test        # check:lines, desktop, api, ai-service (Ollama and Whisper faked; one opt-in real-model smoke test)
```

## Testing Strategy

- **Python:**
  - `FrameBudget` selection: even spacing, first and last included, short clips.
  - `Transcriber` with a fake Whisper model, plus one real `tiny`-model test on a generated speech-free tone (it must return no segments without crashing).
  - `VisualAnalyzer` with a fake Ollama transport: a valid batch; an invalid batch retried then accepted; invalid twice, stored with its errors; timestamp mismatch rejected; Ollama down; model missing.
  - The pipeline's new stages and their progress bands.
  - Experiment runs, VRAM sampler parsing, the worker health check.
- **API:**
  - The analysis storage on completion (reading the files).
  - The experiments service: 400 without frames, 400 for an unknown model, 202 and the events.
  - The new status CHECK values; the HTTP contract.
- **Desktop:** the transcript and timeline rendering, the compare view's alignment by timestamp, the no-worker hint after 10 s, and the model picker.
- **Opt-in real-model test** (`RUN_MODEL_TESTS=1`): a real `qwen3-vl` call on two generated frames returns schema-valid output.
- **Mutation spot-checks** at review: the validation retry bound, the timestamp-membership check, the frame budget, and the stop-on-unavailable path.

## Boundaries

- **Always:**
  - One model in memory at a time.
  - Every model output is validated before it's stored as parsed. Raw output is always kept.
  - Prompt versions are recorded.
  - Timeouts on every model call; errors tell the user what to do.
  - NestJS stays the only DB writer.
- **Ask first:**
  - Pulling models (the eval candidates).
  - Installing CUDA libraries.
  - Changing the frame budget or batch size defaults.
  - Adding LangGraph (planned for Phase 5).
  - An event broker (Redis Streams or Kafka).
- **Never:**
  - Send frames or audio to any cloud service.
  - Let model output trigger anything beyond being stored and displayed (no FFmpeg yet).
  - Drop a malformed response silently.
  - Block the API thread on inference.

## Success Criteria

1. Processing a video with speech produces a transcript whose segment timestamps fall within the video's duration, with word timestamps. A video without audio skips TRANSCRIBING.
2. Visual analysis covers ≤ 60 evenly spread frames (all frames for clips ≤ 60 s). Every stored scene's timestamp is one of the analysed frames, and the results match the Pydantic schema.
3. An invalid model response is retried once, then stored with its raw text and validation errors. The job completes and reports "N of M batches valid".
4. With Ollama stopped, the job fails within its timeout with "Ollama is not running…". With a model name that isn't installed, it fails with the `ollama pull` hint.
5. The Analysis card shows the transcript with timestamps and the visual timeline with thumbnails.
6. An experiment with any installed vision model runs on the same frames and stores the raw and parsed output, validation, load and inference time, and peak VRAM. Two experiments can be compared side by side.
7. With no worker running, a pending job shows the no-worker hint within about 10 s, and System status shows `worker: error`.
8. All suites, builds, the lint, `cargo check` and `check:lines` pass. The review finds no open Critical or Required items. The docs are updated (§4.5–4.6, §5 states, §6.5, §10, §14).
9. **Evals done:** `doc/evals/phase-4-vision-models.md` holds the measured comparison and a recommendation, and the default model is set according to your decision.

## Out of Scope (Deferred)

- LangGraph orchestration, combining transcript and visuals, highlight detection: Phase 5.
- Scene-change frame selection: Phase 5, once highlights need it.
- Whisper on the GPU: revisit only if the evals show CPU transcription is the bottleneck.
- An event broker (Redis Streams or Kafka): the current queue, gRPC events and WebSocket are enough with one worker. Revisit when several consumers need the same events (system-design §20).
- A transcript editor, search and word-level highlighting: Phase 7 polish.
- Automatic LLM-as-judge scoring in evals: the human rubric first; an automatic judge can be added if the evals become routine.

## Open Questions

1. **The eval set:** which 3–5 of your videos should we use? They should be ones you've imported, with a mix of content.
2. ~~Eval models~~: resolved. Only `qwen3-vl:8b-instruct`; the evals compare its settings.
3. **Quality scoring:** are you OK spending about 15 minutes scoring the generated eval sheet (10 frames × candidates × videos, with quick checkboxes)? Or should I add an automatic judge model instead, which is less trustworthy?
