# Phase 2 — Projects and Video Import: Task List

Plan: `tasks/phase-2-plan.md` · Spec: `spec/SPEC-phase-2.md` · Standard: `CLAUDE.md`.
Every task also clears `.agents/skills/planning-and-task-breakdown/references/shared/definition-of-done.md`.
Shared commands (non-interactive shells: `export PATH=$HOME/.nvm/versions/node/v22.23.5/bin:$PATH`):
`npm test` (runs `check:lines` first) · `npm test -w apps/api` · `npm test -w apps/desktop` · `npm run build` · `npm run lint -w apps/api`.

---

## T0: Test database ✅

`clipforge_test` exists, is owned by `vanex` and is reachable at port 5433 over the socket (verified 2026-11-26).

---

## T1: Drizzle schema, config and first migrations

**Description:** Add `drizzle-orm` and `drizzle-kit`. Define `users`, `projects` and `source_videos` exactly as in the spec's data model (CHECK constraint on status, the indexes, cascades, `bigint mode:'number'`). Generate the first migration, plus a custom migration that seeds `LOCAL_USER_ID`.

**Acceptance criteria:**
- [x] `npm run db:generate -w apps/api` produces `drizzle/0000_*.sql` matching the spec (tables, FKs, `ON DELETE CASCADE`, CHECK, indexes)
- [x] `drizzle/0001_*.sql` inserts the local user with `ON CONFLICT DO NOTHING`
- [x] The schema file imports only from `drizzle-orm` (ESM-safe for drizzle-kit)

**Verification:** `psql … -d clipforge_test -f` on both files applies cleanly to an empty DB; `npm run build -w apps/api` passes.
**Dependencies:** T0
**Files:** `apps/api/package.json`, `apps/api/drizzle.config.ts`, `apps/api/src/infrastructure/database/schema.ts`, `apps/api/drizzle/*`
**Scope:** S

---

## T2: DRIZZLE provider, MigrationRunner, env, DB test harness

**Description:**
- Export a `DRIZZLE` token from `DatabaseModule` (`drizzle(pool, { schema })`).
- A `MigrationRunner` provider runs `migrate()` in `onModuleInit`, so the API refuses to start if migrations fail.
- Add `MEDIA_ROOT` (required, `~` expanded) and `TEST_DATABASE_URL` (optional) to the env schema.
- Vitest `globalSetup` migrates `clipforge_test`; a `test/db.ts` helper gives a Drizzle instance and `truncateAll()`.

**Acceptance criteria:**
- [x] The API boots against `clipforge` and creates the tables; a second boot is a no-op
- [x] A missing `MEDIA_ROOT` fails startup with a clear message (env spec updated)
- [x] A DB suite run without `clipforge_test` fails with a message naming the `createdb` command

**Verification:** `npm test -w apps/api`; boot the API on port 3999 and `\dt` in psql.
**Dependencies:** T1
**Files:** `database.module.ts`, `migration-runner.ts`, `config/env.ts` (+ spec), `test/db.ts`, `vitest.config.ts`
**Scope:** M

---

## T3: Auth seam, global validation pipe, ProjectsRepository

**Description:**
- `common/current-user.ts`: `LOCAL_USER_ID` and the `@CurrentUser()` param decorator.
- `main.ts` registers the global `StandardSchemaValidationPipe`; a shared `uuid` param schema.
- `ProjectsRepository` (`create`, `listWithVideoCount`, `findOwned`, `update`, `deleteOwned`) . One concrete Drizzle class. Every method takes `userId`.

**Acceptance criteria:**
- [x] Repository integration tests cover create/list (newest first, with `videoCount`), update (touches `updated_at`), delete, and that another user's id is invisible
- [x] A malformed UUID on a route gives 400 (pipe wired)

**Verification:** `npm test -w apps/api`
**Dependencies:** T2
**Files:** `common/current-user.ts`, `common/schemas.ts`, `main.ts`, `modules/projects/projects.repository.ts`, `projects.repository.spec.ts`
**Scope:** M

---

## T4: Projects service, controller, module, MediaStorage

**Description:**
- `infrastructure/storage/media-storage.ts`: `MediaStorage` owns the `MEDIA_ROOT` layout (`videoDir`, `projectDir`, `removeProjectDir`, `removeVideoDir`, `freeBytes`, `isInside`).
- `ProjectsService` implements the use cases, with 404 on not-found and media-directory cleanup on delete.
- `ProjectsController` maps the 5 routes. zod schemas trim the name to 1–100 chars and cap the description at 1000.

**Acceptance criteria:**
- [x] The 5 project routes behave as in the spec (201/200/204, 400 on bad input, 404 on unknown or foreign ids)
- [x] Deleting a project removes `original-videos/{user}/{project}/` (tested on a temp `MEDIA_ROOT`)
- [x] Service unit tests use a fake repository and storage; there's no DB in service tests

**Verification:** `npm test -w apps/api`, `npm run lint -w apps/api`
**Dependencies:** T3
**Files:** `infrastructure/storage/media-storage.ts` (+ spec), `modules/projects/projects.service.ts` (+ spec), `projects.controller.ts`, `projects.schemas.ts`, `projects.module.ts` (+ `app.module.ts`)
**Scope:** M

### Checkpoint A: Projects API
- [x] `npm test -w apps/api` green; API boots and migrates `clipforge`
- [x] Create, list, rename and delete verified over HTTP on port 3999 (Python/httpx; curl is blocked)

---

## T5: Desktop data layer for projects

**Description:**
- `ApiClient` gains `getJson<T>`, `sendJson<T>` (POST/PATCH/DELETE) and `ApiError(status, message)`, which reads Nest's error body.
- `features/projects/api.ts`: `ProjectsApi` types and calls. `queries.ts`: `useProjects`, `useProject`, `useCreateProject`, `useUpdateProject`, `useDeleteProject`, with cache invalidation.
- Routes `/projects` and `/projects/$projectId`; `/` redirects to `/projects`; Projects nav item above System status.

**Acceptance criteria:**
- [x] The `ApiClient` tests cover a JSON success, a 4xx becoming `ApiError` with the server message, 204 with no body, and unreachable
- [x] Navigating between Projects and System status works and the active item is highlighted

**Verification:** `npm test -w apps/desktop`, `npm run build -w apps/desktop`
**Dependencies:** T4 (contract)
**Files:** `lib/api.ts` (+ test), `features/projects/api.ts`, `features/projects/queries.ts`, `app/router.tsx`, `components/layout/app-shell.tsx`
**Scope:** M

---

## T6: Projects list and New project dialog

**Description:** Add the shadcn `dialog`, `input`, `textarea` and `label` components.
- `ProjectList` has loading, error and empty states, and a grid of `ProjectCard`s.
- `ProjectFormDialog` is reused later for rename. It validates the name inline (1–100 chars, trimmed), shows server errors, and disables submit while saving.

**Acceptance criteria:**
- [x] The empty state has a call to action; creating a project adds a card without a reload
- [x] An empty or whitespace name, or 101 chars, shows an inline error and makes no request
- [x] Dialog focus works (focus trapped, Esc closes, focus returns to the trigger)

**Verification:** component tests for each state and for validation; `npm run build -w apps/desktop`
**Dependencies:** T5
**Files:** `features/projects/components/project-list.tsx`, `project-card.tsx`, `project-form-dialog.tsx`, `project-list.test.tsx`, `components/ui/*` (generated)
**Scope:** M

---

## T7: Project page with rename and delete

**Description:** Add shadcn `alert-dialog`.
- `ProjectPage` shows a header with the name and description, Rename (opens `ProjectFormDialog` pre-filled), and Delete (`DeleteProjectDialog`, which states that the videos are removed too).
- After a delete, it navigates to `/projects`. An unknown project shows a not-found state.

**Acceptance criteria:**
- [x] Rename updates the header and the list
- [x] Delete asks for confirmation and never calls `window.confirm`; Cancel does nothing
- [x] A 404 shows "Project not found" with a link back

**Verification:** component tests; manual check in the Tauri window
**Dependencies:** T6
**Files:** `features/projects/components/project-page.tsx`, `delete-project-dialog.tsx`, `project-page.test.tsx`, `app/router.tsx`, `components/ui/alert-dialog.tsx` (generated)
**Scope:** M

### Checkpoint B: Projects end-to-end
- [x] Create, rename and delete in the real Tauri window; projects still listed after restarting the API and the app
- [x] `npm test` green; `npm run build` passes

---

## T8: ContainerFormat table

**Description:** `container-signatures.ts` exports `ContainerFormat { name, extensions, mime, matches(header: Buffer) }` and `CONTAINER_FORMATS`, covering the 10 families in the spec. Also `formatForExtension(ext)` and `HEADER_BYTES` (enough for the M2TS check at 196 bytes plus 1).

**Acceptance criteria:**
- [x] Each family accepts a minimal real-header fixture and rejects a `.txt` header and other families' headers
- [x] Old QuickTime with a leading `moov`, `mdat`, `wide` or `free` atom is accepted; a TS file with only one sync byte is rejected

**Verification:** `npm test -w apps/api`
**Dependencies:** none (pure)
**Files:** `modules/videos/import/container-signatures.ts`, `container-signatures.spec.ts`
**Scope:** S

---

## T9: ImportValidator

**Description:** `ImportValidator.validate(path)` returns `ValidatedFile { absolutePath, size, extension, mime }` or throws `ImportRejectedError(reason)`, applying the spec's 7 rules in order. It depends on `MediaStorage` (`isInside`, `freeBytes`) and on `CONTAINER_FORMATS`.

**Acceptance criteria:**
- [x] One test per rejection, using real temp files: relative path, missing, directory, symlink (to a valid video), unknown extension, renamed `.txt`, empty, over the limit (via an injected limit), inside `MEDIA_ROOT`, not enough space (fake storage)
- [x] A valid mp4 fixture passes, and nothing is written anywhere during validation

**Verification:** `npm test -w apps/api`
**Dependencies:** T4 (`MediaStorage`), T8
**Files:** `modules/videos/import/import-validator.ts`, `import-validator.spec.ts`, `import-rejected.error.ts`
**Scope:** M

---

## T10: MediaCopier and ImportRegistry

**Description:**
- `MediaCopier.copy(src, dest, { signal, onProgress })` streams to `dest.part`, calls `onProgress` at most once a second plus once at the end, renames on success, re-checks the size, and on error or abort removes `.part` and rethrows.
- `ImportRegistry` provides `start(id): AbortSignal`, `abort(id)` and `finish(id)`.

**Acceptance criteria:**
- [x] A copy of a several-MB temp file is byte-identical, and `onProgress` ends at the full size
- [x] Aborting mid-copy leaves no `.part` file and no destination
- [x] A read error leaves no `.part` file
- [x] A size mismatch after the copy is an error

**Verification:** `npm test -w apps/api`
**Dependencies:** none
**Files:** `modules/videos/import/media-copier.ts`, `media-copier.spec.ts`, `import-registry.ts`, `import-registry.spec.ts`
**Scope:** M

---

## T11: Videos repository, service, controller (import, list, get)

**Description:**
- `VideosRepository` (Drizzle): `insertImporting`, `listForProject`, `findOwned`, `updateProgress`, `markReady`, `markFailed`, `deleteOwned`, `findByStatus`.
- `VideosService.startImport` checks the project is owned, validates, inserts, and fires the copy without awaiting it; the copy's outcome is written back to the row.
- Controller routes: `POST /projects/:id/videos/import` (202), `GET /projects/:id/videos`, `GET /videos/:id`. `ImportRejectedError` maps to 400.

**Acceptance criteria:**
- [x] Importing a valid temp video gives 202 + `IMPORTING`, then (awaiting the copy in the test) `READY` with `bytes_copied = file_size` and the file at the spec's path
- [x] A rejected file gives 400 with the reason, and no row or file is created
- [x] Another user's project or video gives 404
- [x] `VideosService` stays at or under 300 lines

**Verification:** `npm test -w apps/api`, `npm run lint -w apps/api`
**Dependencies:** T4, T9, T10
**Files:** `modules/videos/videos.repository.ts` (+ spec), `videos.service.ts` (+ spec), `videos.controller.ts`, `videos.schemas.ts`, `videos.module.ts`
**Scope:** L → keep the repository spec and the service spec in separate files; split further if any file nears 300 lines

---

## T12: Delete with abort, startup recovery

**Description:**
- `VideosService.delete` aborts a running copy through `ImportRegistry`, deletes the row, and removes the video directory. Route: `DELETE /videos/:id` (204).
- `onApplicationBootstrap` turns every `IMPORTING` row into `FAILED` ("Import interrupted — import the file again") and removes its directory.

**Acceptance criteria:**
- [x] Deleting a READY video removes the row and the directory
- [x] Deleting an IMPORTING video aborts the copy and leaves no `.part` file
- [x] An `IMPORTING` row seeded before boot becomes FAILED after bootstrap, with its directory removed

**Verification:** `npm test -w apps/api`
**Dependencies:** T11
**Files:** `videos.service.ts`, `videos.controller.ts`, `videos.recovery.spec.ts`, `videos.delete.spec.ts`
**Scope:** M

### Checkpoint C: Import API
- [x] `npm test -w apps/api` green
- [x] Mutation spot-checks go red: drop the symlink check; drop the inside-`MEDIA_ROOT` check; drop `userId` from one repository query; make the mp4 matcher always true (each restored afterwards)
- [x] Manual: import a real ≥ 1 GB mp4 over HTTP; sha256 matches; the original's mtime is unchanged; `/api/v1/health` answers during the copy
- [x] Manual: kill the API mid-copy, restart, see FAILED with no `.part` file or directory

---

## T13: Tauri dialog plugin and file picker

**Description:**
- Add `tauri-plugin-dialog` (Cargo plus `.plugin(tauri_plugin_dialog::init())`), the npm `@tauri-apps/plugin-dialog`, and capability `dialog:allow-open`.
- `features/videos/file-picker.ts` exposes `pickVideoFiles(): Promise<string[]>` with multi-select and the video extensions filter.
- A single exported `VIDEO_EXTENSIONS` list mirrors the API table.

**Acceptance criteria:**
- [x] `cargo check` passes with the capability
- [x] Outside Tauri, `pickVideoFiles` returns `[]` without throwing

**Verification:** `cargo check`, `npm run build -w apps/desktop`, a manual multi-select pick
**Dependencies:** none (can be done any time before T14)
**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `apps/desktop/package.json`, `features/videos/file-picker.ts`
**Scope:** S

---

## T14: Videos data layer, Import button, video table

**Description:**
- `features/videos/api.ts` and `queries.ts`: `useVideos(projectId)` with `refetchInterval` while any video is IMPORTING, and `useImportVideos` (one POST per picked file, collecting per-file errors).
- `ImportButton`, `VideoTable` and `VideoRow` (filename, size formatted, `VideoStatus` badge, a progress bar with % while IMPORTING, the error text when FAILED, "—" for duration and resolution).
- Add the shadcn `progress` and `table` components. The table goes on `ProjectPage`.

**Acceptance criteria:**
- [x] An importing row shows `role="progressbar"` with the right `aria-valuenow`
- [x] Polling starts while a row is IMPORTING and stops once every row is READY or FAILED (fake timers)
- [x] A rejected file shows its server reason; the other picked files still import

**Verification:** component tests; `npm run build -w apps/desktop`
**Dependencies:** T7, T11, T13
**Files:** `features/videos/api.ts`, `queries.ts`, `components/import-button.tsx`, `components/video-table.tsx`, `components/video-row.tsx` (+ tests; `video-status.tsx` if a file nears 300 lines)
**Scope:** M–L → the tests sit in `video-table.test.tsx` and `queries.test.tsx`

---

## T15: Delete video from the table

**Description:** A delete action per row with an AlertDialog confirm. While IMPORTING it reads "Cancel import and delete". It uses `useDeleteVideo` with cache invalidation.

**Acceptance criteria:**
- [x] Confirming removes the row; Cancel keeps it
- [x] The wording changes for an importing row

**Verification:** component tests; manual check in Tauri
**Dependencies:** T12, T14
**Files:** `features/videos/components/delete-video-dialog.tsx`, `video-row.tsx`, `queries.ts`, `video-table.test.tsx`
**Scope:** S

### Checkpoint D: Phase 2 complete
- [x] Spec success criteria 1–8 verified in the real app (manual end-to-end, including restart persistence)
- [x] `npm test`, `npm run build`, `npm run lint -w apps/api`, `cargo check` all pass; `check:lines` reports 0 files over 300 lines

---

## T16: Docs match reality

**Description:**
- Architecture §9.1: users, projects and source_videos fields.
- Architecture §11 and system-design §15: the single local user and the `CurrentUser` seam.
- System-design §4.1: statuses `IMPORTING/READY/FAILED` replace `UPLOADED`, and the validation rules.
- §17 Phase 2: tasks match what was built. README: Phase 2 marked done.

**Acceptance criteria:**
- [x] No doc statement contradicts the code (grep for `UPLOADED`, `Supabase Auth`, `upload-url`)

**Dependencies:** T1–T15
**Files:** `doc/architecture.md`, `doc/system-design.md`, `README.md`
**Scope:** S

---

## Review
- [x] Independent code-review-and-quality review of Phase 2 plus the SOLID refactor (`ac4e234`), including mutation experiments; fix Critical and Required findings; re-verify Checkpoint D
- [ ] Human review; merge `phase-2` → `main`
