import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Scene, VisualAnalysis } from "@/features/analysis/api";
import type { Experiment } from "./api";
import { alignScenes, CompareView } from "./components/compare-view";
import { experimentKeys, upsertExperiment } from "./queries";

const scene = (t: number, description: string): Scene => ({
  timestampSeconds: t,
  description,
  subjects: [],
  actions: [],
  cameraFraming: "medium",
  verticalCropSuitable: true,
  observations: [],
});

function experiment(id: string, scenes: Scene[], overrides: Partial<Experiment> = {}): Experiment {
  const output: VisualAnalysis = {
    model: "qwen3-vl:8b-instruct",
    promptVersion: "visual-v1",
    frames: [0, 1, 2].map((i) => ({ index: i, timestampSeconds: i })),
    scenes,
    batches: [{ frameIndexes: [2], valid: false, attempts: 2, errors: ["missing timestamp 2"], raw: "{oops" }],
    metrics: { loadMs: 0, inferenceMs: 0, framesAnalysed: 3, validBatches: 0, totalBatches: 1 },
  };
  return {
    id,
    sourceVideoId: "v1",
    processingJobId: "j1",
    modelName: "qwen3-vl:8b-instruct",
    promptVersion: "visual-v1",
    settings: { maxFrames: 60, batchSize: id === "a" ? 4 : 1 },
    status: "COMPLETED",
    progress: 100,
    output,
    metrics: { loadMs: 2000, inferenceMs: 30000, totalMs: 32000, peakVramMiB: null, framesAnalysed: 3, validBatches: 1, totalBatches: 2 },
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-11-26T05:00:00.000Z",
    updatedAt: "2026-11-26T05:00:00.000Z",
    ...overrides,
  };
}

describe("alignScenes", () => {
  it("lists every timestamp either run saw, in order, with gaps where one had no answer", () => {
    const rows = alignScenes(experiment("a", [scene(1, "a1"), scene(0, "a0")]), experiment("b", [scene(1, "b1"), scene(2, "b2")]));

    expect(rows.map((r) => [r.timestampSeconds, r.a?.description, r.b?.description])).toEqual([
      [0, "a0", undefined],
      [1, "a1", "b1"],
      [2, undefined, "b2"],
    ]);
  });
});

describe("CompareView", () => {
  it("shows both runs' metrics, aligned scenes and the invalid raw answers", () => {
    render(<CompareView a={experiment("a", [scene(0, "a person talks")])} b={experiment("b", [scene(0, "a speaker")])} />);

    expect(screen.getByText("qwen3-vl:8b-instruct · 4/request")).toBeInTheDocument();
    expect(screen.getAllByText("10.0")).toHaveLength(2); // 30 s / 3 frames
    expect(screen.getAllByText("unknown")).toHaveLength(2); // no VRAM reading
    expect(screen.getByText("a person talks")).toBeInTheDocument();
    expect(screen.getByText("a speaker")).toBeInTheDocument();
    expect(screen.getByText("Invalid model answers (2)")).toBeInTheDocument();
  });
});

describe("upsertExperiment", () => {
  it("adds new runs first and never rolls one back to an older state", () => {
    const queryClient = new QueryClient();
    const old = experiment("a", [], { status: "RUNNING", updatedAt: "2026-11-26T05:00:05.000Z" });
    queryClient.setQueryData(experimentKeys.forVideo("v1"), [old]);

    upsertExperiment(queryClient, experiment("b", []));
    upsertExperiment(queryClient, { ...old, status: "PENDING", updatedAt: "2026-11-26T05:00:01.000Z" });

    expect(queryClient.getQueryData<Experiment[]>(experimentKeys.forVideo("v1"))?.map((e) => [e.id, e.status])).toEqual([
      ["b", "COMPLETED"],
      ["a", "RUNNING"],
    ]);
  });
});
