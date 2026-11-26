# Spec: Phase 3 — Media Processing Foundation — V1

Status: approved (2026-11-26) — open questions resolved: 24-frame strip; worker is its own process, also started by `npm run dev:ai`
Source: `doc/system-design.md` §4.2–4.4, §5, §6.3, §7, §11–13, §17 Phase 3; `doc/architecture.md` §5.3, §6, §8.
Builds on: Phase 2 (`spec/SPEC-phase-2.md`, on `main` at `e455d4d`). Code standard: `CLAUDE.md` (OOP + SOLID, ≤ 300 lines/file).

## Objective

Make imported videos *understood and prepared* by the machine, with no AI yet:

1. Every imported video is **inspected with FFprobe** as soon as its copy finishes. The video table shows duration, resolution and frame rate, plus video and audio codec and whether there is an audio track. A file that cannot be decoded is flagged immediately.
2. The user can **process** a video. A background job runs in the Python service through Redis/RQ: it validates the media, extracts a Whisper-ready audio track, and samples frames. The job reports stage and progress **live over a WebSocket**, can be cancelled, and recovers cleanly from crashes.
3. The extracted audio and frames are **kept** (Phase 4 analyses them) and **shown** in the app: audio length, frame count, and a strip of frame thumbnails.

User stories:
1. After an import I see "12:41 · 1920×1080 · 30 fps · H.264 / AAC" without doing anything.
2. If I import a corrupt or undecodable file, it shows **FAILED: "Not a playable video: …"**.
3. On a ready video I click **Process**. I see *Validating → Extracting audio and frames* with a live %, then **Completed**.
4. I can **Cancel** a running job. It stops within a couple of seconds and leaves no half-written files.
5. On a completed job I see "Audio: 12:41 (16 kHz mono)" (or "No audio track"), "761 frames", and a scrollable strip of thumbnails with their timestamps.
6. If the API or the worker crashes mid-job, the job ends as **FAILED: "Processing interrupted"** after a restart. It never hangs as "running" forever.

## Decisions (approved before this spec)

| Decision | Choice | Consequence |
|---|---|---|
| When FFprobe runs | **Right after import**, via a new gRPC `ProbeVideo` | The copy finishes, then NestJS asks Python to probe, then the row becomes `READY` *with* metadata, or `FAILED` if undecodable. If the AI service is down at that moment, the video still becomes READY with empty metadata, and the job's VALIDATING stage probes again. |
| Job progress | **WebSocket gateway** (NestJS `@nestjs/websockets` + `ws` adapter) | NestJS pushes `job.updated` events. The desktop uses the native `WebSocket` and reconnects with backoff. The database stays authoritative: on (re)connect the desktop refetches over REST. Imports keep Phase 2 polling. |
| Extracted files | **Kept and shown** | Stored at `MEDIA_ROOT/analysis/{user}/{project}/{video}/{job}/`, and removed when the video or project is deleted. This replaces the docs' "temporary `/tmp` dir, deleted at the end" idea. |
| Phase 2 review leftovers | **Included as task 1** | 4 missing tests, the empty project folder race, 2 Python health-check edge cases. |

## Architecture

```
Desktop ──REST──▶ NestJS ──gRPC VideoAnalysisService──▶ Python AI service ──enqueue──▶ Redis (RQ)
   ▲                 ▲  ProbeVideo / StartAnalysis /                                      │
   │ WebSocket       │  CancelAnalysis / GetAnalysisStatus                                ▼
   └─ job.updated ───┤                                                   RQ worker (separate process)
                     └──────── gRPC JobEventsService (NestJS :50052) ◀── ReportProgress / Completion / Failure
```

- **Ownership is unchanged.** NestJS is the only process that writes to Postgres. Python reports events, and NestJS persists them and broadcasts them over the WebSocket.
- **Paths:** services exchange `storage_path` relative to `MEDIA_ROOT`. Python resolves it and rejects anything that escapes `MEDIA_ROOT`.
- **FFmpeg runs only in Python**, through a controlled wrapper: fixed argument lists, `asyncio`/`subprocess` without a shell, and a captured stderr tail.

### gRPC contract (`proto/ai/v1/`)

`video_analysis.proto` (Python serves) gains:
- `ProbeVideo(storage_path)`. Returns `decodable`, `duration_seconds`, `width`, `height`, `frame_rate`, `video_codec`, `audio_codec`, `has_audio`, `container`, and `error_code` / `error_message`.
- `StartAnalysis(job_id, storage_path, artifacts_path, settings{frame_interval_seconds, frame_max_width})`. Returns `accepted`. A duplicate `job_id` is a no-op that is still accepted.
- `CancelAnalysis(job_id)`. Returns `found`.
- `GetAnalysisStatus(job_id)`. Returns the state: `QUEUED`, `RUNNING`, `FINISHED` or `UNKNOWN`.

New `job_events.proto` (NestJS serves, on `JOB_EVENTS_GRPC_URL`):
- `ReportProgress(job_id, sequence, status, stage, progress, message)`
- `ReportCompletion(job_id, sequence, artifacts{has_audio, audio_path, audio_duration_seconds, frame_count, frame_interval_seconds, frames_path})`
- `ReportFailure(job_id, sequence, error_code, error_message)`. `error_code` is one of `MEDIA_UNDECODABLE`, `FFMPEG_FAILED`, `INTERRUPTED`, `CANCELLED`, `INTERNAL`.

Every event carries a monotonically increasing `sequence`. NestJS ignores an event whose sequence isn't greater than the last one stored, and any event for a job that is already terminal.

### Processing job (Python RQ worker)

| Status | What happens | Progress |
|---|---|---|
| `PENDING` | Row created by NestJS; enqueued in RQ | 0 |
| `VALIDATING` | FFprobe: must decode with a video stream; duration > 0 | 0–5 |
| `EXTRACTING_MEDIA` | Audio: `-vn -ac 1 -ar 16000` WAV, skipped when there is no audio track. Frames: `fps=1/interval,scale='min(768,iw)':-2` JPEG, plus `frames.json` (index → timestamp). Progress comes from `-progress pipe:1` `out_time` against the duration | 5–100 |
| `COMPLETED` | Artifacts reported | 100 |
| `FAILED` / `CANCELLED` | Partial artifacts removed; reason kept | — |

- One worker, so one job runs at a time (`MAX_CONCURRENT_ANALYSIS=1`). The RQ job timeout is 2 h, and RQ `job_id` = processing job id.
- **Cancel:** a queued job is removed from RQ. A running job gets a Redis cancel flag, checked every second, and the worker terminates its ffmpeg child (SIGTERM, then SIGKILL after 5 s), deletes the partial artifacts and reports `CANCELLED`.
- **Recovery:**
  - When the worker starts, any job in RQ's started registry (the worker died) is reported as `FAILED/INTERRUPTED` and its artifacts are removed. Jobs are not requeued in Phase 3.
  - When the API starts, any non-terminal job older than 30 s is checked with `GetAnalysisStatus`. If the answer is `UNKNOWN` or `FINISHED` without a final event, the job becomes `FAILED/INTERRUPTED`. If the AI service is unreachable, the API retries every 30 s.
- One active job per video. `POST /process` while a job is `PENDING`, `VALIDATING` or `EXTRACTING_MEDIA` gives **409**.

## Data Model (migration `0002`)

```text
source_videos  + video_codec text NULL, audio_codec text NULL, has_audio boolean NULL, container text NULL
               (duration/width/height/frame_rate already exist; filled by ProbeVideo)

processing_jobs
  id uuid PK · source_video_id → source_videos ON DELETE CASCADE (index) · project_id · user_id
  status text CHECK in (PENDING, VALIDATING, EXTRACTING_MEDIA, COMPLETED, FAILED, CANCELLED)  (index)
  stage text · progress int 0–100 · message text NULL
  last_sequence int default 0 · error_code text NULL · error_message text NULL
  artifacts jsonb NULL   -- {hasAudio, audioPath, audioDurationSeconds, frameCount, frameIntervalSeconds, framesPath} (paths relative)
  started_at, completed_at timestamptz NULL · created_at, updated_at
```

The status CHECK covers only the Phase 3 states. Later phases widen it with their own migration.

## API (base `/api/v1`, scoped to the current user)

| Method | Path | Result |
|---|---|---|
| POST | `/videos/:id/process` | **202** job `PENDING`. 409 if a job is active; 400 if the video isn't READY; 404 if not found or not owned |
| GET | `/videos/:id/jobs` | The video's jobs, newest first |
| GET | `/jobs/:id` | One job |
| POST | `/jobs/:id/cancel` | **202**. 409 if the job is already terminal |
| GET | `/jobs/:id/frames` | `[{index, timestampSeconds}]` (from `frames.json`) |
| GET | `/jobs/:id/frames/:index` | `image/jpeg`, streamed from the job's artifacts, with ownership checked |
| WS | `ws://localhost:3000/ws` | Server → client `{"event":"job.updated","data":<job>}`. The Origin is checked against `DESKTOP_ORIGINS`, and any other origin is refused at the upgrade |

Deleting a video or project also removes its jobs (cascade) and the `analysis/…` directories. It cancels any running job first.

## Desktop

- **Video table:** Duration, Resolution and a new **Codec** column ("H.264 / AAC", or "H.264 / no audio") show real values. A **Process** action appears on READY rows.
- **Video page** `/projects/$projectId/videos/$videoId`:
  - a metadata card
  - a **Processing** card: the latest job's status and stage, a progress bar, and Cancel
  - a **Results** card (completed jobs): audio summary, frame count, and a horizontal strip of up to 24 evenly spaced frame thumbnails with timestamps; clicking a thumbnail enlarges it
  - job history
- `lib/events.ts`, the `EventsClient` class: one WebSocket per app with exponential-backoff reconnect (1 s → 30 s). It applies `job.updated` to the TanStack cache (`setQueryData`) and invalidates the job queries on (re)connect. Components subscribe through a `useJobEvents()` hook.
- No polling for jobs. If the socket is down, the panel shows "Live updates paused, reconnecting…", and REST data stays correct on refresh.

## Commands

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.5/bin:$PATH    # non-interactive shells only
npm run dev:ai          # gRPC + HTTP (as before)
npm run dev:worker      # NEW: RQ worker  (cd apps/ai-service && uv run python -m app.workers.processing_worker)
npm run dev:api         # also serves JobEventsService on :50052 and the WebSocket on /ws
npm run dev:desktop
npm test                # check:lines, desktop, api (needs clipforge_test), ai-service (pytest; ffmpeg fixtures)
cd apps/ai-service && uv run python scripts/gen_proto.py   # after the proto changes
```

## Project Structure (new or changed)

```text
proto/ai/v1/video_analysis.proto (+4 RPCs) · proto/ai/v1/job_events.proto (new)
apps/ai-service/app/
├── grpc_server.py                       # + ProbeVideo, StartAnalysis, CancelAnalysis, GetAnalysisStatus
├── media/
│   ├── ffmpeg_runner.py                 # FfmpegRunner: exec without shell, progress parsing, cancel/kill, stderr tail
│   ├── prober.py                        # MediaProber: ffprobe JSON → ProbeResult
│   ├── audio_extractor.py · frame_extractor.py
│   └── media_paths.py                   # MediaPaths: resolve relative paths inside MEDIA_ROOT, reject escapes
├── jobs/
│   ├── queue.py                         # JobQueue (RQ): enqueue (idempotent), cancel, status
│   ├── pipeline.py                      # ProcessingPipeline: VALIDATING → EXTRACTING_MEDIA → COMPLETED
│   ├── events.py                        # JobEventsClient (gRPC to NestJS) with sequence numbers and retry
│   └── cancellation.py                  # Redis cancel flags
└── workers/processing_worker.py         # RQ worker entry point + startup recovery
apps/api/src/
├── infrastructure/grpc/                 # + ai-service client methods; job-events server bootstrap
├── modules/jobs/                        # controller, service, repository, schemas, job-events.controller (gRPC),
│                                        #   events.gateway (WebSocket), reconciler (startup)
└── modules/videos/                      # + probe after copy; process-related cleanup on delete
apps/desktop/src/
├── lib/events.ts                        # EventsClient (WebSocket, reconnect) + useJobEvents
├── features/jobs/                       # api.ts, queries.ts, components/ (processing-card, results-card, frame-strip, job-history)
└── features/videos/components/          # + video-page.tsx, process-button.tsx; codec column
```

## Code Style

As in Phase 2 and `CLAUDE.md`:
- **NestJS:** the controller handles HTTP or gRPC only. Services hold the use cases. A repository holds the SQL.
- **Python:** small classes with constructor-injected collaborators. `FfmpegRunner` is the only place that spawns processes. Every external call (ffmpeg, Redis, gRPC) sits behind a class that tests can fake.

## Testing Strategy

- **Python (pytest):**
  - `MediaPaths` rejects escapes.
  - `MediaProber` against **real tiny fixtures generated by ffmpeg at test time** (`testsrc` with and without a sine audio track, plus a corrupt file).
  - Audio and frame extraction produce the expected files and counts; progress is monotonic.
  - Cancelling kills ffmpeg and leaves no files.
  - The pipeline with fake events and queue covers success, undecodable, cancel and the FFmpeg error.
  - Worker startup recovery.
  - The gRPC servicer through a real in-process server.
- **API (Vitest + `clipforge_test`):**
  - The jobs repository: status transitions, sequence ordering, terminal immutability.
  - The jobs service: 409/400/404, cancel, cascade cleanup.
  - The `JobEventsService` handler: out-of-order and duplicate events are ignored, and persist + broadcast happen.
  - The reconciler.
  - The probe-after-import path with the gRPC client faked.
  - The gateway: Origin rejected, event delivered.
  - HTTP contract specs (202, 409, frame streaming, content type).
- **Desktop (Vitest):**
  - `EventsClient` reconnect and cache updates (fake WebSocket).
  - The processing card's states.
  - The frame strip (sampling 24 of N, timestamps).
  - The video page's metadata formatting.
- **Mutation spot-checks** at review: the sequence guard, the terminal guard, the path-escape check, the WebSocket Origin check, the cancel kill.
- **Manual end-to-end:**
  - Process a real ~10-minute video.
  - Watch live progress, then check the audio length is about the video length and the frame count is about its duration in seconds.
  - Cancel mid-run and confirm no files remain.
  - Kill the worker mid-job, restart it, and see FAILED "Processing interrupted".
  - Probe a corrupt file and see FAILED "Not a playable video".

## Boundaries

- **Always:**
  - NestJS is the only DB writer.
  - Relative paths only across services; FFmpeg with fixed argument lists and no shell.
  - Every event is sequence-checked; every long operation can be cancelled.
  - All suites, builds, the lint and `cargo check` pass, and `doc/` is updated.
- **Ask first:**
  - Dependencies beyond `rq`, `@nestjs/websockets`, `@nestjs/platform-ws`.
  - Changing the frame interval or width defaults (1 s, 768 px).
  - Requeueing or retrying jobs automatically.
  - Moving imports to WebSocket.
- **Never:**
  - Pass model output or user input into an FFmpeg command line.
  - Let Python write to Postgres.
  - Expose absolute media paths to the desktop.
  - Keep partial artifacts of a failed or cancelled job.
  - Accept WebSocket connections from origins other than the desktop's.

## Success Criteria

1. Every newly imported video shows duration, resolution, frame rate, codecs and has-audio within 2 s of reaching READY. A corrupt file (for example random bytes with an mp4 header) ends **FAILED** with "Not a playable video".
2. **Process** on a READY video gives 202 and a job that moves PENDING → VALIDATING → EXTRACTING_MEDIA → COMPLETED. The desktop shows each change **without polling** (WebSocket events only).
3. After completion:
   - `audio.wav` is 16 kHz mono, and its duration is within 1 s of the video's.
   - The frame count is within ±1 of ⌈duration / interval⌉, every frame is at most 768 px wide, and `frames.json` timestamps increase.
   - A video without audio completes with "No audio track".
4. The results card shows the audio summary, the frame count and a thumbnail strip served by `GET /jobs/:id/frames/:index`.
5. Cancel during EXTRACTING_MEDIA ends **CANCELLED** within 3 s; the ffmpeg process is gone and no artifact files remain.
6. Killing the worker mid-job and restarting the worker and the API ends **FAILED / INTERRUPTED**; nothing stays non-terminal.
7. A second Process while one is active gives 409. Another user's video or job gives 404. A WebSocket from a foreign Origin is refused.
8. Deleting a video or project during a running job cancels it and removes its `analysis/…` directory.
9. The Phase 2 review leftovers are done (4 tests, the empty-folder race, the 2 Python edge cases).
10. All suites, both builds, the lint, `cargo check` and `check:lines` pass. The code review finds no open Critical or Required items. `doc/` is updated: §4.1–4.4, §5 states and progress, §6.3 endpoints, §7 proto, §11.2 artifacts (replacing `/tmp`), §12 WebSocket, §13.3 recovery (no requeue in Phase 3), and README.

## Out of Scope (Deferred)

- Transcription, visual analysis and every AI stage (`TRANSCRIBING` …): Phase 4 onward.
- Denser frame sampling around interesting sections: Phase 4/5, once there is a signal for "interesting".
- Automatic retry or requeue of failed jobs: the user can click Process again. Revisit with longer AI jobs.
- More than one worker or parallel jobs: one at a time on the 16 GB laptop.
- Audio playback and video preview in the app: Phase 7.
- Moving import progress to the WebSocket: polling works, so it's an optional cleanup later.
- Deleting individual jobs or job history: videos and projects already clean up after themselves.
- Model and profile settings in `POST /process`: Phase 4, when models are used.

## Open Questions

1. **Frame thumbnails:** the strip shows up to **24** evenly spaced frames. Is that enough, or do you want a full scrollable grid of every frame (1 per second, so ~600 for a 10-minute video)?
2. **Worker startup:** the RQ worker is a **separate process** (`npm run dev:worker`), so a 4th terminal. Is that OK, or should `dev:ai` start both the service and the worker together?
