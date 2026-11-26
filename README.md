# ClipForge AI

**Turn long videos into short-form clips automatically, with AI that runs on your own machine.**

ClipForge AI is a desktop app for content creators. You import a long video (a podcast, a lecture, a stream, raw footage), and ClipForge finds the engaging moments. It then cuts them into vertical 9:16 clips with burned-in subtitles, ready for TikTok, YouTube Shorts, Instagram Reels and Facebook Reels.

Everything runs locally. Speech recognition, visual understanding and rendering all happen on your computer, so you need no cloud account or paid AI API, and your footage never leaves your machine.

> **Status:** Phases 1–4 are complete. You can create projects, import videos (validated, copied, and inspected with FFprobe), and **process** them: a background worker extracts audio and frames, transcribes speech with faster-whisper, and describes the frames with a local vision model through Ollama. Progress is live over a WebSocket, with cancel and crash recovery. **Model experiments** rerun the visual analysis with another installed model or setting and compare speed, VRAM and output side by side. The editing planner and rendering arrive in Phases 5–6. See the [roadmap](#roadmap).

---

## How it works

1. **Import** one or more source videos into a project.
2. **Analyze:** FFmpeg extracts the audio and sampled frames. **faster-whisper** transcribes the speech with timestamps, and **Qwen3-VL** (via Ollama) describes what's on screen.
3. **Plan:** the AI combines what is *said* with what is *seen* to pick self-contained moments. It then writes a structured editing plan: clip boundaries, title, hook, caption, crop and subtitles.
4. **Validate:** every plan is checked against a strict schema. The AI proposes edits but never runs commands.
5. **Render:** FFmpeg trims, reframes to 9:16, burns in subtitles and encodes MP4s with thumbnails.
6. **Preview and export** the finished clips from the app.

## Features (MVP)

- Projects with multiple source videos
- Local transcription (Whisper) and visual analysis (Qwen3-VL 8B / 4B / 2B)
- Automatic highlight detection and clip boundaries
- Vertical 9:16 output with basic reframing and burned-in subtitles
- Suggested titles, hooks and captions
- Live processing progress, with clear error reporting
- Model experiments: run the same footage through different local models and compare their output, speed and memory use

## Architecture

```
┌─────────────────────┐   REST / WebSocket   ┌──────────────────┐   gRPC (ai.v1)   ┌──────────────────────────┐
│  Desktop (Tauri 2)  │ ───────────────────▶ │   API (NestJS)   │ ───────────────▶ │  AI service (Python)     │
│  React + TanStack   │                      │  modular monolith│ ◀─────────────── │  FastAPI + gRPC + RQ     │
│  Tailwind + shadcn  │                      │  sole DB writer  │   job events     │  LangGraph, Whisper,     │
└─────────────────────┘                      └────────┬─────────┘                  │  FFmpeg                  │
                                                      │                            └────┬────────┬───────┬────┘
                                               ┌──────▼──────┐               ┌──────────▼─┐ ┌────▼────┐ ┌▼─────────────┐
                                               │ PostgreSQL  │               │   Ollama   │ │  Redis  │ │ Local media  │
                                               │  (local)    │               │  Qwen3-VL  │ │ RQ queue│ │ (MEDIA_ROOT) │
                                               └─────────────┘               └────────────┘ └─────────┘ └──────────────┘
```

- **The desktop app only talks to the API.** It never calls models or workers directly.
- **The API owns all application data.** The AI service reports progress and results back to the API over gRPC and never touches the database.
- **Video files never travel over the network.** Services pass references to files in a local media directory.
- **AI decides, FFmpeg executes.** Model output is validated before anything is rendered.

The full design is in [`doc/architecture.md`](doc/architecture.md) and [`doc/system-design.md`](doc/system-design.md).

## Tech stack

| Layer | Technology |
|---|---|
| Desktop | Tauri 2, React 19, TypeScript, TanStack Router & Query, Tailwind CSS v4, shadcn/ui |
| API | NestJS 12, PostgreSQL (`pg`), gRPC client, Pino logging, Zod config validation |
| AI service | Python 3.13, FastAPI, gRPC (`grpcio`), structlog, pydantic-settings, uv |
| AI models | Qwen3-VL via Ollama, faster-whisper |
| Media | FFmpeg / FFprobe |
| Infrastructure | PostgreSQL 16 + Drizzle ORM, Redis (append-only persistence), local filesystem |

## Project structure

```
clipflow/
├── apps/
│   ├── desktop/      # Tauri + React desktop app
│   ├── api/          # NestJS backend
│   └── ai-service/   # Python AI service (uv project)
├── proto/ai/v1/      # gRPC contracts shared by API and AI service
├── doc/              # architecture and system design
├── spec/             # approved specs per phase
├── tasks/            # implementation plans
└── .env.example      # one root .env, read by every app
```

## Getting started

### Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 22 (`nvm use`) | `node -v` |
| uv | ≥ 0.5 | `uv --version` |
| Rust | stable | `rustc --version` |
| Tauri Linux deps | webkit2gtk-4.1 etc. | [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |
| PostgreSQL | 16, local | `pg_lsclusters` |
| Redis | localhost, `appendonly yes` | `redis-cli config get appendonly` |
| Ollama | with `qwen3-vl:4b-instruct` | `ollama list` |
| FFmpeg | ffmpeg + ffprobe on PATH | `ffprobe -version` |

Developed and tested on Ubuntu 24.04 with an RTX 4050 (6 GB VRAM) and 16 GB RAM.

### Setup

```bash
nvm use
npm install                                   # desktop + api workspaces
cd apps/ai-service && uv sync && uv run python scripts/gen_proto.py && cd -
cp .env.example .env                          # defaults work for a local setup
ollama pull qwen3-vl:4b-instruct
```

One-time database setup. Your OS user gets a matching Postgres role, so it connects over the local socket with no password:

```bash
sudo -u postgres createuser -p 5433 "$USER"
sudo -u postgres createdb -p 5433 -O "$USER" clipforge
sudo -u postgres createdb -p 5433 -O "$USER" clipforge_test   # for the API test suite
```

Adjust the port to match your cluster (`pg_lsclusters`), here and in `DATABASE_URL`. Re-run `gen_proto.py` whenever a file under `proto/` changes.

### Run (three terminals)

```bash
npm run dev:ai        # AI service (HTTP :8000, gRPC :50051) + processing worker (RQ)
                      # (npm run dev:worker runs the worker alone)
npm run dev:api       # API: http://localhost:3000/api/v1, WebSocket /ws, job events gRPC :50052
npm run dev:desktop   # opens the ClipForge window
```

The app opens on **System status**, which shows the API, PostgreSQL, the AI service, Ollama and the vision model. Each is green or red, with the reason when it's red.

In a terminal, logs are readable colored lines. When output is redirected to a file, they switch to JSON.

### Test and build

```bash
npm test              # 300-line check, desktop + api (Vitest), then ai-service (pytest)
                      # the API suite needs the clipforge_test database (see Setup)
npm run build         # desktop + api
```

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1 | Application foundation: all services running and talking | ✅ Done |
| 2 | Projects and video import | ✅ Done |
| 3 | Media processing: FFprobe, audio and frame extraction, job queue | ✅ Done |
| 4 | Local AI: transcription and visual analysis, model experiments | ✅ Done |
| 5 | AI editing planner: highlights, clip boundaries, validated plans | Planned |
| 6 | Automatic rendering: 9:16, subtitles, thumbnails | Planned |
| 7 | Complete desktop experience: progress, gallery, preview, export | Planned |

Later: combining multiple source videos, smarter reframing, music and B-roll, and direct publishing to social platforms.
