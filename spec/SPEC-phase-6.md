# Spec: Phase 6 — Automatic Rendering — V1

Status: approved (2026-11-26). The user asked to implement the remaining phases directly; their decisions are below.

Renders the kept clips of a completed editing plan (Phase 5) into vertical short-form MP4s, with burned-in subtitles, normalized audio and a thumbnail, and verifies every output.

## Decisions

| Topic | Decision |
|---|---|
| Framing | **Blurred background fit**: the full 16:9 frame scaled to 1080 px wide, centred, over a blurred, zoomed copy filling 9:16. Nothing is cut off (HUD, face cam). `crop_mode` stays `center` in the data; rendering uses `blur-fit` for every clip in V1. |
| Resolution | **1080×1920**, H.264 + AAC in MP4, `+faststart`. The frame rate is the source's, capped at 60. |
| Encoder | `VIDEO_ENCODER=auto` (default): `h264_nvenc` if a 1-frame test encode succeeds at worker start, otherwise `libx264 -preset veryfast`. `nvenc` or `x264` forces one. |
| Subtitles | **Bold captions**: white, bold, black outline, centred in the lower blurred area, one cue at a time (the ≤ 32 character, ≤ 3 s cues from Phase 5). On by default; a Render dialog switch turns them off. |
| Audio | `loudnorm` to −14 LUFS integrated, −1.5 dBTP. A clip of a video without audio has no audio track. |
| Thumbnail | A JPEG of the rendered clip at its midpoint (vertical, with the blur fit). |

## Architecture

Same pattern as plans: `POST /plans/:id/renders` → NestJS → gRPC `StartRendering` → RQ (same queue, one GPU job at a time) → worker → `ReportRender{Progress,Completion,Failure}` → NestJS writes the DB → WS `render.updated`.

- **Cues come from the API.** NestJS builds each clip's subtitle cues with Phase 5's `buildCues` and sends them in the request, so one implementation decides what is shown. The worker only formats them as ASS.
- **Outputs** go under the job's artifacts: `<artifacts>/renders/<renderId>/<clipId>.mp4` and `.jpg`. Existing rules apply: paths resolve under `analysis/`, and deleting the video removes them.

### AI service: `app/rendering/` (new)

| Module | Responsibility |
|---|---|
| `profile.py` | The output profile (1080×1920, blur, loudness) and encoder detection (`auto` → nvenc test → x264). |
| `ass.py` | Cues → an ASS file (style, PlayRes 1080×1920, escaping of `{ } \`). |
| `commands.py` | Builds the FFmpeg argument lists (pure, testable): the clip render, the thumbnail. No shell, ever. |
| `renderer.py` | `ClipRenderer.render(source, clip, out_dir, subtitles, on_progress, should_cancel)`: runs FFmpeg through the existing `FfmpegRunner` (progress, cancel, kill), then the thumbnail, then **verifies** with ffprobe (duration within ±0.5 s, 1080×1920, a video stream, an audio stream if the source has audio). |
| `app/jobs/rendering_job.py` | `RenderRunner`: clips in order with per-clip progress. One failed clip is recorded and the rest continue. The render FAILS only if no clip succeeds. Cancel removes the render directory. |

### Proto

- `StartRendering`: `render_id`, `source_path` (under `original-videos/`), `output_path` (under `analysis/`), `has_audio`, `subtitles`, and `repeated RenderClipSpec clips`. Each clip spec is `clip_id`, `start`, `end`, `repeated Cue cues`.
- Events: `ReportRenderProgress`, `ReportRenderCompletion` (`output_path` of `render.json`; metrics `{rendered, failed, elapsed_ms, encoder}`) and `ReportRenderFailure`.
- New error code: `RENDER_FAILED`.

## Data (migration `0006`)

- **`render_jobs`**: `id`, `plan_id`, `source_video_id`, `user_id`, `settings` (`{subtitles}`), `status` (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED), `progress`, `metrics`, `failures` jsonb (per-clip errors), `last_sequence`, `error_code`/`message`, timestamps. At most one active render per video.
- **`rendered_clips`**: `id`, `render_id`, `planned_clip_id`, `title` (copied, so later edits don't rename past exports), `start_seconds`, `end_seconds`, `file_path`, `thumbnail_path`, `duration_seconds`, `width`, `height`, `size_bytes`, `created_at`. Inserted with the completion, in one transaction.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/plans/:id/renders` | `{subtitles?: boolean}` → 202. Returns 400 unless the plan is COMPLETED with at least one kept clip; 409 while a render of the video runs. |
| GET | `/plans/:id/renders` | Newest first. |
| GET | `/renders/:id` | The render with its rendered clips. |
| POST | `/renders/:id/cancel` | 202, or 409 if already finished. |
| GET | `/rendered-clips/:id/file` | `video/mp4` with HTTP Range (206) for preview and seeking. |
| GET | `/rendered-clips/:id/thumbnail` | `image/jpeg`. |
| WS | `render.updated` | |

A reconciler fails stale renders, as for jobs and plans.

## Success Criteria

1. Render a completed plan → each kept clip becomes a playable MP4: 1080×1920, H.264/AAC, duration = end − start (±0.5 s), the blur fit, the subtitles where speech is, and audio at about −14 LUFS.
2. Outputs are verified by ffprobe before completion. A clip that fails verification is a per-clip failure with its reason.
3. Cancel stops FFmpeg within ~2 s and leaves no files. A worker restart fails the running render (INTERRUPTED) and removes its files.
4. NVENC is used when it works and libx264 otherwise, and the encoder used is recorded in the metrics.
5. All suites, `check:lines`, lint and builds pass; the code review findings are fixed.

## Out of Scope (Deferred)

Smart subject-tracking crop, word-by-word highlight subtitles, silence removal, music and B-roll, other aspect ratios, and re-rendering a single clip.
