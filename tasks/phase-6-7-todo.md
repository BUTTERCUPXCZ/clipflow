# Phases 6–7 — Rendering and the complete desktop experience: tasks

Specs: `spec/SPEC-phase-6.md`, `spec/SPEC-phase-7.md`. Decisions: blurred-background fit, 1080×1920, bold captions, Save… per clip plus Export all.

## Phase 6 — rendering
- [x] `app/rendering/`: profile + NVENC detection, ASS captions, FFmpeg commands, ClipRenderer with ffprobe verification
- [x] RenderRunner (per-clip failures, cancel, refused completion), RENDER_TASK, StartRendering gRPC, render events
- [x] Migration 0006 (`render_jobs`, `rendered_clips`); renders module (create/list/get/cancel, events with a path-checked and zod-validated render.json, reconciler, WS `render.updated`)
- [x] Tests: real FFmpeg renders (libx264), a real worker, gRPC refusals, API renders spec

## Phase 7 — desktop
- [x] Range file endpoints (rendered clip, thumbnail, source video); export (clip, all) with no overwrite and MEDIA_ROOT refusal
- [x] Source player on the video page; Preview per planned clip (plays only its range)
- [x] Render clips + Burn subtitles (inline instead of a dialog), progress/cancel, rendered clips grid, Save…, Export all
- [x] Clips page (gallery) and Activity page (running + recent, live); sidebar links
- [x] Tests (desktop: renders, segment player, pages; API: range, activity merge, export)

## Verification
- [x] Real E2E through the API on "SEN TenZ_ special": 2 clips rendered in 14 s (h264_nvenc, 1080×1920, −14.2 LUFS measured earlier); Range 206; Export all wrote `01 - …mp4`, `02 - …mp4`
- [x] All suites, check:lines, lint, builds, cargo check
- [x] Independent code review, then fix the findings: UUID ids and exact render dir at the gRPC boundary (path traversal via clip_id/render_id), sources only from original-videos/, symlink-aware export check, render-time snapshot of clip titles/times, exact output paths in render.json, empty mapped render = failure, per-clip ValueError/OSError, failed clip files removed, NVENC→x264 fallback, render-specific interrupted message, missing file = 409, trailing-slash save refused, last good render kept visible, narrower live refetch, preview re-seeks; tests for verification duration, per-clip FFmpeg failure and HTTP 206/416/404.
