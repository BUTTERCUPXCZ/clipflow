import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/features/jobs/api";
import { mockApi, renderWithProviders } from "@/test/render";
import { defaultSettings, type Plan, type PlanDetail } from "./api";
import { ClipsCard, frameIndexAt } from "./components/clips-card";
import { validateSettings } from "./components/plan-dialog";

afterEach(() => vi.unstubAllGlobals());

const job = { id: "j1", artifacts: { frameCount: 600, frameIntervalSeconds: 1 } } as Job;
const plan = (overrides: Partial<Plan> = {}): Plan =>
  ({
    id: "p1",
    sourceVideoId: "v1",
    processingJobId: "j1",
    modelName: "qwen3-vl:4b-instruct",
    language: "en",
    durationSeconds: 600,
    settings: { minSeconds: 15, maxSeconds: 60, maxClips: 3 },
    status: "COMPLETED",
    progress: 100,
    metrics: { llmCalls: 4, elapsedMs: 14000, windows: 3, skippedWindows: 1, clipCount: 2 },
    skipped: [{ start: 0, end: 200, errors: ["moment 900-930 is outside 0-200"] }],
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-11-26T05:00:00.000Z",
    updatedAt: "2026-11-26T05:00:00.000Z",
    ...overrides,
  }) as Plan;
const clip = (id: string, startSeconds: number, endSeconds: number, removedAt: string | null = null) => ({
  id, planId: "p1", position: 0, startSeconds, endSeconds, title: `Clip ${id}`, hook: "A hook", caption: "A caption.",
  reason: "Big play.", score: 8, removedAt, excerpt: `Words of ${id}`,
});

describe("plan helpers", () => {
  it("defaults to 15–60 s and about one clip per 3 minutes", () => {
    expect(defaultSettings(680)).toEqual({ minSeconds: 15, maxSeconds: 60, maxClips: 4 });
    expect(defaultSettings(30)).toMatchObject({ maxClips: 1 });
    expect(defaultSettings(7200)).toMatchObject({ maxClips: 10 });
  });

  it("validates settings like the API", () => {
    expect(validateSettings({ minSeconds: 15, maxSeconds: 60, maxClips: 4 })).toBeUndefined();
    expect(validateSettings({ minSeconds: 60, maxSeconds: 30, maxClips: 4 })).toMatch(/longer than the longest/);
    expect(validateSettings({ minSeconds: 15, maxSeconds: 60, maxClips: 0 })).toMatch(/1 and 20/);
    expect(validateSettings({ minSeconds: Number.NaN, maxSeconds: 60, maxClips: 4 })).toMatch(/whole numbers/);
  });

  it("finds the frame for a clip start", () => {
    expect(frameIndexAt(job, 9.7)).toBe(10);
    expect(frameIndexAt(job, 9999)).toBe(599);
    expect(frameIndexAt(undefined, 10)).toBeUndefined();
  });
});

describe("ClipsCard", () => {
  function api(detail: PlanDetail, patch?: (body: unknown) => Response) {
    const deleted: string[] = [];
    mockApi({
      "GET /videos/v1/plans": () => Response.json([detail]),
      "GET /plans/p1": () => Response.json(detail),
      "PATCH /plans/p1/clips/c1": (body) => (patch ? patch(body) : Response.json({})),
      "DELETE /plans/p1/clips/c2": () => {
        deleted.push("c2");
        return new Response(null, { status: 204 });
      },
    });
    renderWithProviders(<ClipsCard videoId="v1" durationSeconds={600} jobs={[job]} />);
    return { deleted };
  }

  it("lists the kept clips with their copy, times and skipped parts", async () => {
    api({ ...plan(), clips: [clip("c1", 9.7, 30), clip("c2", 100, 130), clip("c3", 200, 230, "2026-11-26T06:00:00.000Z")] });

    const first = await screen.findByRole("listitem", { name: "Clip c1" });
    expect(first).toHaveTextContent("0:10–0:30 · 20 s");
    expect(within(first).getByText("Why: Big play.")).toBeInTheDocument();
    expect(within(first).getByText("“Words of c1”")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Clip c3" })).toBeNull(); // removed
    expect(screen.getByText(/planned in 14 s with 4 model calls/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("1 part of the video could not be analysed"));
    expect(screen.getByText(/outside 0-200/)).toBeInTheDocument();
  });

  it("removes a clip and shows the API's reason when an adjustment is refused", async () => {
    const { deleted } = api({ ...plan(), clips: [clip("c1", 9.7, 30), clip("c2", 100, 130)] }, () =>
      Response.json({ message: "A clip must be 15–60 s long; this one would be 10.3 s" }, { status: 400 }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove Clip c2" }));
    await waitFor(() => expect(deleted).toEqual(["c2"]));

    fireEvent.click(screen.getByRole("button", { name: "Adjust Clip c1" }));
    fireEvent.change(screen.getByLabelText("End (s)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("this one would be 10.3 s");
  });

  it("shows progress with cancel while planning, and the reason when it failed", async () => {
    mockApi({ "GET /videos/v1/plans": () => Response.json([plan({ status: "RUNNING", progress: 40 })]) });
    renderWithProviders(<ClipsCard videoId="v1" durationSeconds={600} jobs={[job]} />);
    expect(await screen.findByText("40%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan clips" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
