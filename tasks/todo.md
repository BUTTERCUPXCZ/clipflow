# Phase 1 — Application Foundation: Task List

Plan: `tasks/plan.md`. Every task also clears `.agents/skills/planning-and-task-breakdown/references/shared/definition-of-done.md`.

---

## Task 1: Repo foundation

**Description:** Make the folder a monorepo: git, root npm workspaces, Node pin, shared env template, ignore rules, and a README with dev commands.

**Acceptance criteria:**
- [x] `git init` done; `.gitignore` covers `node_modules`, `.env`, `.venv`, `target`, `dist`, and generated gRPC stubs
- [x] Root `package.json` declares the workspaces `apps/desktop` and `apps/api`, with `engines.node >=22`; `.nvmrc` = 22
- [x] `.env.example` lists every variable from system-design §14.2, plus `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_PORT`, `AI_HTTP_PORT` and `AI_GRPC_URL`

**Verification:**
- [x] `git status` shows no `.env` or build output
- [x] Manual check: README dev steps are accurate

**Dependencies:** None
**Files likely touched:** `.gitignore`, `.nvmrc`, `package.json`, `.env.example`, `README.md`
**Estimated scope:** S

---

## Task 2: gRPC contract

**Description:** Define `ai.v1.VideoAnalysisService` with only `GetModelStatus` for now. It reports whether Ollama is reachable, the installed models, and whether the configured vision model is installed. Errors use an enum code, not free text.

**Acceptance criteria:**
- [x] `proto/ai/v1/video_analysis.proto` compiles with `grpcio-tools`
- [x] Messages: `GetModelStatusRequest {}`, and `GetModelStatusResponse { bool runtime_reachable; repeated ModelInfo installed_models; string configured_vision_model; bool configured_vision_model_installed; ErrorCode error_code; }`

**Verification:**
- [x] `uv run python -m grpc_tools.protoc ...` generates stubs without errors (run in Task 4)

**Dependencies:** Task 1
**Files likely touched:** `proto/ai/v1/video_analysis.proto`
**Estimated scope:** XS

---

## Task 3: AI service skeleton + `/health`

**Description:** uv project at `apps/ai-service` following the architecture §5.3 layout (only the folders used now). `config.py` uses pydantic-settings and reads the root `.env`. FastAPI `GET /health` checks Ollama (`/api/tags`), Redis (`PING` + `appendonly`), FFmpeg/FFprobe on PATH, and `MEDIA_ROOT`, which it creates if missing and checks is writable. Each check times out after a few seconds. structlog emits JSON logs.

**Acceptance criteria:**
- [x] `uv run python -m app.main` starts on `AI_HTTP_PORT`; invalid config fails fast with a readable error
- [x] `/health` returns per-dependency `{status: ok|error, detail}` and an overall status; one dependency failing doesn't crash the endpoint
- [x] pytest covers healthy and degraded cases (dependencies mocked)

**Verification:**
- [x] `uv run pytest` passes
- [x] Manual: `curl localhost:8000/health` against the real local Ollama/Redis/FFmpeg

**Dependencies:** Task 1
**Files likely touched:** `apps/ai-service/pyproject.toml`, `app/main.py`, `app/config.py`, `app/api/routes/health.py`, `tests/test_health.py`
**Estimated scope:** M

---

## Task 4: Python gRPC server — `GetModelStatus`

**Description:** A codegen script generates stubs from `proto/`. `grpc_server.py` serves `VideoAnalysisService` on `AI_GRPC_URL`'s port, inside the same asyncio loop as FastAPI (started and stopped in the FastAPI lifespan). `GetModelStatus` reuses the Ollama check from Task 3; there's no second client.

**Acceptance criteria:**
- [x] Generating stubs is one command (`uv run python scripts/gen_proto.py`); the stubs are gitignored
- [x] `GetModelStatus` returns the installed models, and `configured_vision_model_installed=true` for `qwen3-vl:8b-instruct` on this machine
- [x] Ollama down → `runtime_reachable=false` with `error_code=MODEL_RUNTIME_UNAVAILABLE`, not a gRPC exception

**Verification:**
- [x] pytest starts the gRPC server in-process and calls it with a real client (Ollama mocked)
- [x] Manual: the same call against the real Ollama

**Dependencies:** Tasks 2, 3
**Files likely touched:** `apps/ai-service/scripts/gen_proto.py`, `app/grpc_server.py`, `app/services/model_runtime.py`, `tests/test_grpc.py`
**Estimated scope:** M

---

## Checkpoint A: AI service
- [x] `uv run pytest` green
- [x] `/health` is accurate against the real dependencies
- [x] gRPC `GetModelStatus` works from a client

---

## Task 5: NestJS skeleton + `/api/v1/health` (Postgres)

**Description:** A NestJS app at `apps/api` following the architecture §5.2 layout (only `config/`, `infrastructure/database`, `modules/health`). Global prefix `/api/v1`. Env validated with zod through `@nestjs/config`. `nestjs-pino` logging. The health endpoint runs `SELECT 1` through a `pg` pool with a short timeout. CORS allows only the Tauri origins (`http://localhost:1420`, `tauri://localhost`, `http://tauri.localhost`).

**Acceptance criteria:**
- [x] `npm run start:dev -w apps/api` starts on `API_PORT`; a missing `DATABASE_URL` fails startup with a clear message
- [x] `GET /api/v1/health` returns `{status, checks: {database}}`; an unreachable database gives `database: error`, a 503, and no crash
- [x] Jest test covers the ok and error paths (pool mocked)

**Verification:**
- [x] `npm test -w apps/api` passes; `npm run build -w apps/api` succeeds
- [x] Manual: curl against the real Supabase

**Dependencies:** Task 1 (and Supabase credentials for the manual check)
**Files likely touched:** `apps/api/src/main.ts`, `app.module.ts`, `config/env.ts`, `infrastructure/database/*`, `modules/health/*`
**Estimated scope:** M

---

## Task 6: NestJS gRPC client → AI service

**Description:** `infrastructure/grpc` registers a `@nestjs/microservices` gRPC client that loads `proto/ai/v1/video_analysis.proto` at runtime. The health endpoint adds an `ai` check that calls `GetModelStatus` with a deadline, and reports Ollama reachability and the configured model.

**Acceptance criteria:**
- [x] With the AI service up, health shows `ai: ok`, plus model info
- [x] With the AI service down, health shows `ai: error` within the deadline (it doesn't hang)
- [x] Jest test covers both cases (gRPC client mocked)

**Verification:**
- [x] `npm test -w apps/api` passes
- [x] Manual: start and stop the AI service, curl health each time

**Dependencies:** Tasks 4, 5
**Files likely touched:** `apps/api/src/infrastructure/grpc/*`, `modules/health/health.service.ts`, `modules/health/health.service.spec.ts`
**Estimated scope:** S–M

---

## Checkpoint B: Backend
- [x] All backend tests green; NestJS builds
- [x] `curl localhost:3000/api/v1/health` shows the database and AI service status from real dependencies

---

## Task 7: Desktop scaffold

**Description:** `apps/desktop` via create-tauri-app (React + TS + Vite), plus Tailwind v4 and `shadcn init` (adding a Button and Card). Directory layout follows architecture §5.1.

**Acceptance criteria:**
- [x] `npm run tauri dev -w apps/desktop` opens a native window showing a shadcn-styled placeholder
- [x] `npm run build -w apps/desktop` (Vite + `tsc`) succeeds

**Verification:**
- [x] Manual: the window opens on this Ubuntu machine
- [x] Build succeeds

**Dependencies:** Task 1
**Files likely touched:** `apps/desktop/**` (generated), `src/index.css`, `components.json`, `src/components/ui/*`
**Estimated scope:** M (mostly generated)

---

## Task 8: Router + Query + System Status page

**Description:** Set up TanStack Router (code-based, `src/app/router.tsx`) and a QueryClient provider. An app-shell layout. A `/status` route (the Phase 1 home page) uses `useQuery` to call `GET /api/v1/health` through a small `lib/api.ts` whose base URL comes from `VITE_API_URL`. The page shows each check as ok or error, with loading and error states and a refetch button.

**Acceptance criteria:**
- [x] With everything running, the status page shows NestJS, database and AI service status (incl. vision model)
- [x] With NestJS stopped, the page shows an "API unreachable" state, not a blank screen
- [x] Vitest test renders the status view for the ok and error responses

**Verification:**
- [x] `npm test -w apps/desktop` passes; build succeeds
- [x] Manual: in the Tauri window, stop and start NestJS and the AI service and watch the status change

**Dependencies:** Tasks 6, 7
**Files likely touched:** `src/app/router.tsx`, `src/app/providers/query.tsx`, `src/app/routes/status.tsx`, `src/lib/api.ts`, `src/features/system/*`
**Estimated scope:** M

---

## Checkpoint C: Phase 1 complete
- [x] Desktop starts · NestJS starts · Python starts · Supabase works · Desktop → NestJS · NestJS → Python (all verified at runtime)
- [x] All tests green; all builds succeed

---

## Task 9: Docs match reality

**Description:** Update `doc/architecture.md`: proto lives at the root `proto/`; npm workspaces + uv; `pg` for Phase 1. Note in system-design §17 that Phase 1 gRPC = `GetModelStatus`.

**Acceptance criteria:**
- [x] No doc statement contradicts the code

**Dependencies:** Tasks 1–8
**Files likely touched:** `doc/architecture.md`, `doc/system-design.md`
**Estimated scope:** XS

---

## Review
- [x] Run the `code-review-and-quality` review over all Phase 1 code; fix the findings; re-verify Checkpoint C
- [ ] Human review before starting Phase 2
