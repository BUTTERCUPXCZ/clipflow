# Phase 5 — AI editing planner: tasks

Spec: `spec/SPEC-phase-5.md`. Planner model: `qwen3-vl:4b-instruct` (text-only use). Workflow: LangGraph 1.2.

## AI service
- [x] `app/planning/`: schemas, timeline (windows, snap, overlaps), text LLM client, LangGraph graph, ClipPlanner
  - Verify: pytest with a FakeLlm (valid, retry, skipped window, PLAN_INVALID, NO_SPEECH, cancel, call bound)
- [x] `plan_clips` task, `enqueue_plan`, cancel/state/recovery for plans, `StartPlanning` gRPC, plan events
  - Verify: pytest (queue, gRPC, a real worker with a fake LLM)

## API
- [x] Migration 0005: `editing_plans`, `planned_clips`
- [x] Plans module: create (400/409/202), list, get, cancel, events (guarded, a retried completion, stop), reconciler, WS `plan.updated`
- [x] Clip PATCH (range, length, overlap) and DELETE (soft); subtitle cues on read
  - Verify: vitest on `clipforge_test`

## Desktop
- [x] Plans api/queries plus live `plan.updated`
- [x] Clips card: Plan clips dialog, progress/cancel, clip list (thumbnail, times, copy, reason, transcript excerpt), remove, adjust
  - Verify: vitest

## Wrap-up
- [x] Docs (system-design §4.7–4.10, §6, §9; README)
- [x] Manual: "SEN TenZ_ special" (11:20 game cast) through the API: COMPLETED in 18 s, 3 windows, 4 LLM calls, 2 clips; a too-short adjust refused (400); subtitle cues returned. STRUKTURA has no Phase 4 analysis yet (correctly 400): process it in the app to plan it.
  - Fixed during real runs: Whisper segments of up to 3 min (re-cut into units from word timestamps); the model always answered `[]` while the schema allowed an empty list (now at least 1).
  - Known limit: on sparse speech a clip can be mostly silence (e.g. 197.6–248.3 s holds a few words); the transcript quality (Whisper small on game casting) limits the titles.
- [x] Independent code review, then fix the findings. Fixed: a clip at the video end failed the whole plan (round then clamp); non-Latin context and token sizing (non-ASCII counted per char, 4096 floor for text calls); the excerpt now comes from the plan's own transcript words (API); plan.json is zod-validated and path-checked; StartPlanning refuses NaN, an empty id and output paths other than `plans/<id>`; windows jump over silence; CJK sentence ends; tests for empty candidates, plan.updated, a clip at the end. Not done: making validateRange atomic (single local user; low risk).
