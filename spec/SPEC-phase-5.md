# Spec: Phase 5 — AI Editing Planner — V1

Status: approved (2026-11-26). Open questions resolved with the defaults: 15–60 s clips, about one per 3 min; copy in the video's language.

Turns a processed video (transcript + visual timeline from Phase 4) into an **editing plan**: a short list of clips with start/end times, a title, a hook, a caption, the reason each was chosen, and subtitle data. Nothing is rendered yet; Phase 6 renders the plan.

## Objective

**User:** a creator with a long video, such as a talk, a stream or a gameplay commentary.

**Story:** on a processed video, I click **Plan clips** and choose a clip length range. A few minutes later I see 1–10 proposed clips. Each shows its time range, a thumbnail, its title, hook and caption, why it was picked, and the words spoken in it. I remove the clips I don't want and nudge start/end where the cut is off. The plan is ready for rendering in Phase 6.

Success means:
- A plan is structured, validated, inside the video, and never cuts a sentence in half.
- Invalid model output never reaches the database: it's retried a bounded number of times, then dropped with the reason kept.

## Decisions (approved before this spec)

| Topic | Decision |
|---|---|
| Planner model | Reuse `VISION_MODEL` (`qwen3-vl:4b-instruct`) for text-only planning. No download, and only one model is ever in VRAM. |
| Trigger | A separate **Plan clips** action on a video whose latest job completed, as its own job on the same queue. Re-planning doesn't redo the analysis. |
| Workflow engine | **LangGraph**, as the design doc says: a typed state graph with bounded retries. New dependency `langgraph` in `apps/ai-service`. |
| Plan editing | View, remove clips, and adjust start/end. Edits are validated server-side. Titles and captions are read-only in V1. |

## Assumptions (correct me if wrong)

1. Planning **needs speech**. With no transcript, or fewer than 30 transcribed words, the plan fails with `NO_SPEECH` and a clear message. Planning from visuals only is deferred.
2. **Clip boundaries snap to transcript segment boundaries**, so a clip starts at the start of a spoken sentence and ends at the end of one, with 0.3 s padding inside the video. The model proposes times and code makes them exact.
3. Defaults: clips **15–60 s**. Maximum clips = `clamp(round(duration / 180 s), 1, 10)`: about one per 3 minutes, so 4 for your 11-minute video and 10 for 30 minutes. The user can change all three in the Plan clips dialog (min 5 s, max 180 s, 1–20 clips).
4. Clips **don't overlap**. When two candidates overlap, the higher-scored one wins.
5. Titles, hooks and captions are written **in the transcript's language** (Whisper detects it).
6. **Subtitle data is computed, not generated.** Cues (≤ 32 characters, ≤ 3 s, split on word timestamps) are built from the transcript words inside the clip's final range. The API computes them on read, so adjusted times always give matching subtitles. No LLM is involved.
7. Re-planning creates a **new plan**. The app shows the latest one; older plans stay in the database. Plan history in the UI is deferred.

## Architecture

```
Desktop ──POST /videos/:id/plans──▶ NestJS ──StartPlanning (gRPC)──▶ AI service ──RQ──▶ worker
   ▲                                  ▲                                                 │
   └──── WS plan.updated ─────────────┴──── ReportPlan{Progress,Completion,Failure} ────┘
```

Same rules as jobs and experiments: NestJS is the only DB writer, with guarded sequence updates and `stop` acks. The worker writes `plan.json` under the job's artifacts (`<artifacts>/plans/<planId>/plan.json`), and NestJS reads it on completion.

### AI service: `app/planning/` (new package)

| Module | Responsibility |
|---|---|
| `schemas.py` | Pydantic models: `Candidate` (start, end, score 1–10, reason), `ClipCopy` (title ≤ 70 chars, hook ≤ 120, caption ≤ 220), `PlannedClip`, `EditingPlan` (`schemaVersion: "plan-v1"`). Plus the JSON schemas passed to Ollama `format`. |
| `timeline.py` | Pure functions: merge transcript segments and scenes into one timeline; split it into **windows** (about 4 min, 20 s overlap) that fit the context; snap a time range to segment boundaries; resolve overlaps. |
| `llm.py` | `TextLlm` protocol and `StructuredAsk` (one question, ≤ 2 attempts). The Phase 4 `OllamaVisionClient` is reused as the text client (a chat with no images), keeping its error mapping; its context sizing now also counts the prompt length. |
| `graph.py` | The LangGraph `StateGraph` (below), built with injected collaborators so tests swap a fake LLM in through the same protocol. |
| `planner.py` | `ClipPlanner`: runs the graph, reports progress, checks cancel, and returns the plan dict. |

**Graph state** (`PlanState`, a TypedDict): only references and small structured data, never media. It holds `duration`, `settings`, `windows`, `candidates`, `selected`, `clips`, `errors`, `attempts`.

**Nodes and edges:**

```
build_windows ─┬─(no speech)──▶ END
               └▶ find_candidates (one call per window, ≤ 2 attempts)
                  ▶ select (snap to units, fit length, resolve overlaps, top N) ─┬─(no clip)──▶ END
                                                                                └▶ write_copy (≤ 5 clips per call, ≤ 2 attempts) ▶ END
```
Then ClipPlanner validates the result with Pydantic `EditingPlan`. *Implementation notes:* segments are re-cut into sentence-like units from word timestamps (Whisper gave 3-minute segments on game casting), and the candidate schema requires at least one moment (an optional empty list made the model always answer `[]`).

Rules:
- A window whose answer is invalid twice is **skipped** and recorded in `errors`, including the raw output (capped at 4,000 characters, as in Phase 4).
- The plan fails with `PLAN_INVALID` only if **no** clip survives.
- Total LLM calls are bounded by `2 × windows + 2 × ceil(clips / 5)`. No unbounded loops.

**Progress bands:** build 0–5, candidates 5–80 (one step per window), select 80–85, copy 85–98, done 100.

**Error codes:** `NO_SPEECH`, `PLAN_INVALID`, `MODEL_RUNTIME_UNAVAILABLE`, `MODEL_NOT_INSTALLED`, `CANCELLED`, `INTERNAL`. Messages are scrubbed of absolute paths.

### Proto

- `video_analysis.proto`: `rpc StartPlanning(StartPlanningRequest) returns (StartAnalysisResponse)`. The request carries `plan_id`, `transcript_path`, `visual_path`, `output_path`, `duration_seconds`, `min_seconds`, `max_seconds` and `max_clips`.
- `job_events.proto`: `ReportPlanProgress`, `ReportPlanCompletion` (`output_path`, `clip_count`, `llm_calls`, `elapsed_ms`) and `ReportPlanFailure`, each returning `ReportAck`. The new error codes are added.

## Data Model (migration `0005`)

- **`editing_plans`**: `id`, `source_video_id`, `processing_job_id` (whose analysis it used), `user_id`, `model_name`, `schema_version`, `settings` jsonb (`{minSeconds, maxSeconds, maxClips}`), `status` (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, CHECK), `progress`, `metrics` jsonb (`{llmCalls, elapsedMs, windows, skippedWindows}`), `errors` jsonb (skipped windows with their raw output), `last_sequence`, `error_code`, `error_message`, timestamps. There is at most one active plan per video (a partial unique index).
- **`planned_clips`**: `id`, `plan_id` (cascade), `position`, `start_seconds`, `end_seconds`, `title`, `hook`, `caption`, `reason`, `score`, `crop_mode` (`center` in V1), `removed_at` (soft remove, so Phase 6 skips it and a remove can be undone later), timestamps. CHECKs: `start_seconds >= 0` and `end_seconds > start_seconds`.

## API (base `/api/v1`)

| Method | Path | Notes |
|---|---|---|
| POST | `/videos/:id/plans` | `{minSeconds?, maxSeconds?, maxClips?}` → 202. Returns 400 without a completed analysis or a transcript; 409 if a plan is already running. |
| GET | `/videos/:id/plans` | Newest first, without clips. |
| GET | `/plans/:id` | The plan with its clips (removed clips flagged). |
| POST | `/plans/:id/cancel` | 202, or 409 if already finished. |
| PATCH | `/plans/:id/clips/:clipId` | `{startSeconds?, endSeconds?}`. Validated: inside the video, within the plan's min/max length, no overlap with other kept clips. 400 with the reason otherwise. |
| DELETE | `/plans/:id/clips/:clipId` | Soft remove (204). |
| GET | `/plans/:id/clips/:clipId/subtitles` | `[{start, end, text}]` cues for the clip's current range, relative to the clip start. |
| WS | `plan.updated` | Same pattern as `job.updated` and `experiment.updated`. |

A reconciler fails stale plans, as for jobs and experiments.

## Desktop

**Clips card** on the video page, shown when the latest job is completed:
- **Plan clips** opens a dialog with the clip length (min/max seconds) and the maximum number of clips, using the defaults above. It starts the plan; progress is live with cancel.
- **Planned clip list:** a thumbnail (the frame at the clip start), the time range and duration, the title, hook, caption and "why this clip", and the transcript excerpt for the range.
- **Per clip:** **Remove**, and **Adjust** (start/end number inputs in 0.5 s steps, with the API's validation message shown inline).
- Failed plans show the error. When some windows were skipped, a note says "N parts of the video could not be analysed" and expands to show them.

## Commands

```
npm run dev:ai | dev:api | dev:desktop
cd apps/ai-service && uv add langgraph && uv run pytest
cd apps/api && npx drizzle-kit generate --name=editing_plans && npx vitest run
npm test   # check:lines + all suites
```

## Testing Strategy

- **Python (pytest, hermetic):** a `FakeLlm` behind `TextLlm` scripts the replies. Tests cover:
  - windowing (overlap; a 30-minute transcript fits the context)
  - snapping to sentences and overlap resolution (pure functions)
  - graph paths: valid; an invalid answer retried and then the window skipped; every window invalid → `PLAN_INVALID`; no speech → `NO_SPEECH`; cancel between nodes
  - the LLM-call bound
  - the planner task end to end with a real worker and a fake LLM

  An optional `RUN_MODEL_TESTS=1` test runs the real 4B model on a fixture transcript.
- **API (Vitest, `clipforge_test`):** plan creation rules (400/409), guarded events, a retried completion, clip PATCH validation (out of range, too short, overlap), soft delete, subtitle cues (word split, ≤ 32 characters, ≤ 3 s, relative times, an adjusted range), and the reconciler.
- **Desktop (Vitest + Testing Library):** the plan dialog defaults, a live update, remove, adjust with the API error shown, and the transcript excerpt for a range.
- **Manual:** plan your 11-minute "SEN TenZ_ special" video and one other video, then check that clips are sensible and none cuts mid-sentence. Record the time and the LLM call count in `tasks/phase-5-todo.md`.

## Boundaries

- **Always:**
  - validate model output with Pydantic, then validate again in the API on edits
  - snap to sentence boundaries
  - keep LLM calls bounded
  - keep the raw output of rejected answers
  - follow the 300-line limit and SOLID rules (`CLAUDE.md`)
  - keep test fakes behind the same protocol
- **Ask first:** any dependency besides `langgraph`, a different planner model, schema changes beyond migration 0005, changing Phase 4 behaviour.
- **Never:**
  - let the model's times through without snapping and clamping
  - loop retries without a limit
  - write the DB from the AI service
  - commit `.env`

## Success Criteria

1. **Plan clips** on a processed video produces a COMPLETED plan with 1 to `maxClips` clips, each with a title, hook, caption and reason.
2. Every kept clip satisfies:
   - `0 ≤ start < end ≤ duration`
   - `min ≤ end − start ≤ max`
   - no overlap with other kept clips
   - start and end on transcript segment boundaries (± padding)
3. Invalid model answers are retried at most twice per call. A plan never makes more LLM calls than the stated bound, and skipped windows are visible with their reason.
4. No speech → FAILED `NO_SPEECH`, with a message saying why. Ollama down or the model missing → the Phase 4 error codes and messages.
5. Remove and adjust work. An invalid adjustment is rejected with a readable reason and nothing changes.
6. The subtitle cues for a clip cover exactly its spoken words, relative to the clip start, ≤ 32 characters and ≤ 3 s each, and follow adjusted times.
7. Planning a **30-minute** video takes **≤ 5 minutes** on the target laptop (RTX 4050 6 GB, 16 GB RAM) with `qwen3-vl:4b-instruct`. This is measured, not assumed; if it misses, report it and propose a fix before closing the phase.
8. Cancel, worker restart and a deleted video behave like jobs and experiments: no stuck RUNNING plans and no orphaned files.
9. All suites, `check:lines`, lint and builds pass. An independent code review is done and its findings fixed.

## Out of Scope (Deferred)

- Rendering, cropping, subtitle burning and thumbnails: Phase 6.
- Planning from visuals only (videos without speech): needs a different prompt and boundary logic.
- Editing titles, hooks and captions; adding clips by hand: Phase 7 (full editing).
- Plan history and comparing plans in the UI.
- Smart crop and subject tracking (`crop_mode` is always `center` in V1).
- Running windows in parallel: one model and one GPU, so it runs sequentially.
- An LLM "virality" score beyond the model's 1–10 relevance score.

## Open Questions

1. Are the **15–60 s** default and "about one clip per 3 minutes" right for your content (gameplay commentary)?
2. Should titles and captions follow the **video's language** (assumption 5), or always be English?
