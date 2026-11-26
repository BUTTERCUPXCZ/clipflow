# Spec: Phase 7 — Complete Desktop Experience — V1

Status: approved (2026-11-26). The user asked to implement the remaining phases directly; export decision: a save dialog per clip, plus Export all.

Acceptance (system-design §17): *a user can import a video, process it with local AI, receive automatically edited short-form videos, preview them, and export them without using the terminal.*

## Scope

1. **Video preview.**
   - A source-video player on the video page, streamed by `GET /videos/:id/file` (HTTP Range).
   - **Preview** on each planned clip plays the source from the clip's start and stops at its end, so a clip can be checked before rendering. It follows adjusted times.
2. **Render from the app.** On a completed plan:
   - **Render clips**, with an inline **Burn subtitles** checkbox (on by default) instead of a dialog: one click fewer for the same choice. It shows live progress and cancel.
   - Per-clip failures are shown with their reason.
3. **Rendered clips gallery.**
   - Per video, a **Rendered clips** card shows the latest render: a 9:16 player per clip, the title, duration and size, **Save…** and **Export all**.
   - The sidebar gets a **Clips** page listing every rendered clip across projects (newest first), with the thumbnail, video name, play, and Save….
4. **Export.** The desktop picks the destination with the native dialog (`@tauri-apps/plugin-dialog`, already installed). The API copies the file there, because the API is local, like import.
   - `POST /rendered-clips/:id/export {destination}`: an absolute `.mp4` path. The parent must exist, and the path must not be inside `MEDIA_ROOT`. An existing file gets ` (1)`, ` (2)`… instead of being overwritten. Returns the final path.
   - `POST /renders/:id/export {directory}`: every clip, named `NN - <title>.mp4` with unsafe characters removed. Returns the paths.
5. **Activity dashboard.** A sidebar **Activity** page (`GET /activity`) shows running and recent work across all videos: processing jobs, plans and renders, each with its status, progress and video, linking to the video page. It updates live.
6. **Loading and error states.** Every new card has a loading skeleton or text, an empty state, and an error state with the API's message. A failed load can be retried.

## API additions

| Method | Path | Notes |
|---|---|---|
| GET | `/videos/:id/file` | The source video, Range-enabled. |
| POST | `/rendered-clips/:id/export` | `{destination}` → `{path}`. |
| POST | `/renders/:id/export` | `{directory}` → `{paths}`. |
| GET | `/rendered-clips` | All rendered clips of the user, newest first, with the video name. |
| GET | `/activity` | Latest 50 jobs, plans and renders, merged and ordered by update time. |

## Success Criteria

1. Without a terminal: import → process → plan clips → preview a planned clip → render → play a rendered clip → Save… and Export all to a folder. The exported files play in another player.
2. Seeking works in every player (Range requests return 206).
3. Export never overwrites a file and refuses destinations inside the media root, relative paths, or a missing parent folder, with a readable message.
4. The Activity page shows running work live and links to it.
5. All suites, `check:lines`, lint and builds pass; the code review findings are fixed.

## Out of Scope (Deferred)

Authentication beyond the single local user, project-level batch processing, uploading or publishing to social platforms, and editing titles and captions.
