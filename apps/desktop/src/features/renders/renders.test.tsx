import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPage } from "@/features/activity/activity-page";
import { mockApi, renderWithProviders } from "@/test/render";
import type { Render, RenderDetail } from "./api";
import { ClipsPage } from "./components/clips-page";
import { RendersSection } from "./components/renders-section";
import { SegmentPlayer } from "./components/segment-player";

const picked = vi.hoisted(() => ({ file: "/home/me/out.mp4" as string | null, folder: "/home/me/shorts" as string | null }));
vi.mock("./destinations", () => ({ pickSaveFile: async () => picked.file, pickExportFolder: async () => picked.folder }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));

afterEach(() => vi.unstubAllGlobals());

const base: Render = {
  id: "r1", planId: "p1", sourceVideoId: "v1", settings: { subtitles: true }, status: "COMPLETED", progress: 100, clipCount: 2,
  metrics: { rendered: 2, failed: 1, elapsedMs: 9000, encoder: "h264_nvenc" }, failures: [{ clipId: "c9", error: "rendered 0.2 s, expected 20 s" }],
  errorCode: null, errorMessage: null, createdAt: "2026-11-26T05:00:00.000Z", updatedAt: "2026-11-26T05:00:00.000Z",
};
const clip = (id: string, title: string) => ({
  id, renderId: "r1", plannedClipId: null, position: 0, title, startSeconds: 0, endSeconds: 20, durationSeconds: 20,
  width: 1080, height: 1920, sizeBytes: 2_000_000, createdAt: "2026-11-26T05:00:00.000Z",
});

describe("RendersSection", () => {
  it("starts a render with or without subtitles", async () => {
    const sent: unknown[] = [];
    mockApi({
      "GET /plans/p1/renders": () => Response.json([]),
      "POST /plans/p1/renders": (body) => {
        sent.push(body);
        return Response.json({ ...base, status: "PENDING" }, { status: 202 });
      },
    });
    renderWithProviders(<RendersSection planId="p1" keptClips={2} />);

    fireEvent.click(await screen.findByLabelText("Burn subtitles"));
    fireEvent.click(screen.getByRole("button", { name: "Render clips" }));

    await waitFor(() => expect(sent).toEqual([{ subtitles: false }]));
  });

  it("shows the rendered clips with their failures, saves one and exports all", async () => {
    const detail: RenderDetail = { ...base, clips: [clip("c1", "Big play"), clip("c2", "Second")] };
    const exported: unknown[] = [];
    mockApi({
      "GET /plans/p1/renders": () => Response.json([base]),
      "GET /renders/r1": () => Response.json(detail),
      "POST /rendered-clips/c1/export": (body) => {
        exported.push(body);
        return Response.json({ path: "/home/me/out.mp4" });
      },
      "POST /renders/r1/export": () => Response.json({ paths: ["/home/me/shorts/01 - Big play.mp4", "/home/me/shorts/02 - Second.mp4"] }),
    });
    renderWithProviders(<RendersSection planId="p1" keptClips={2} />);

    expect(await screen.findByRole("figure", { name: "Big play" })).toHaveTextContent("1080×1920");
    expect(screen.getByText(/rendered 0.2 s, expected 20 s/)).toBeInTheDocument();
    expect(screen.getByText(/with h264_nvenc/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Save…" })[0]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved to /home/me/out.mp4");
    expect(exported).toEqual([{ destination: "/home/me/out.mp4" }]);

    fireEvent.click(screen.getByRole("button", { name: "Export all…" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Exported 2 clips to /home/me/shorts"));
  });

  it("keeps showing the last good render when a re-render failed", async () => {
    const failed = { ...base, id: "r2", status: "FAILED", errorMessage: "No clip could be rendered" } as Render;
    mockApi({
      "GET /plans/p1/renders": () => Response.json([failed, base]),
      "GET /renders/r1": () => Response.json({ ...base, clips: [clip("c1", "Big play")] }),
    });
    renderWithProviders(<RendersSection planId="p1" keptClips={1} />);

    expect(await screen.findByText("Render failed")).toBeInTheDocument();
    expect(await screen.findByRole("figure", { name: "Big play" })).toBeInTheDocument();
  });

  it("shows progress and cancel while rendering, and nothing happens when a dialog is cancelled", async () => {
    mockApi({ "GET /plans/p1/renders": () => Response.json([{ ...base, status: "RUNNING", progress: 35 }]) });
    renderWithProviders(<RendersSection planId="p1" keptClips={2} />);

    expect(await screen.findByText("35%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render clips" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("SegmentPlayer", () => {
  it("starts at the clip start and stops at its end, ready to play again", () => {
    render(<SegmentPlayer src="x.mp4" start={10} end={20} label="Preview" />);
    const video = screen.getByLabelText("Preview") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});

    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(10);
    video.currentTime = 20.1;
    fireEvent.timeUpdate(video);

    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(10);
  });
});

describe("pages", () => {
  it("Clips shows an empty state that points to the workflow", async () => {
    mockApi({ "GET /rendered-clips": () => Response.json([]) });
    renderWithProviders(<ClipsPage />, { path: "/clips" });
    expect(await screen.findByText("No clips yet")).toBeInTheDocument();
  });

  it("Activity splits running from finished work and links to each video", async () => {
    const item = (id: string, kind: string, status: string) => ({
      id, kind, status, progress: 40, errorMessage: null, videoId: "v1", videoName: "talk.mp4", projectId: "p1",
      updatedAt: "2026-11-26T05:00:00.000Z",
    });
    mockApi({ "GET /activity": () => Response.json([item("r1", "rendering", "RUNNING"), item("j1", "processing", "COMPLETED")]) });
    renderWithProviders(<ActivityPage />, { path: "/activity" });

    const running = await screen.findByRole("region", { name: "Running" });
    expect(running).toHaveTextContent("Rendering");
    expect(running).toHaveTextContent("40%");
    expect(screen.getByRole("region", { name: "Recent" })).toHaveTextContent("completed");
    expect(screen.getAllByRole("link", { name: "talk.mp4" })[0]).toHaveAttribute("href", "/projects/p1/videos/v1");
  });
});
