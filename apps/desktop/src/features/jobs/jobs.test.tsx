import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Video } from "@/features/videos/api";
import { formatCodecs } from "@/features/videos/format";
import { mockApi, renderWithProviders } from "@/test/render";
import type { Job } from "./api";
import { ProcessingCard } from "./components/processing-card";
import { sampleEvenly } from "./components/frame-strip";
import { jobKeys, upsertJob } from "./queries";

vi.mock("@/lib/live-events", () => ({
  liveEvents: { onState: () => () => {}, getState: () => "open" },
}));

const job = (overrides: Partial<Job> = {}): Job => ({
  id: "j1",
  sourceVideoId: "v1",
  projectId: "p1",
  status: "EXTRACTING_MEDIA",
  stage: "Extracting audio and frames",
  progress: 40,
  message: null,
  errorCode: null,
  errorMessage: null,
  artifacts: null,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-11-26T05:00:00.000Z",
  updatedAt: "2026-11-26T05:00:10.000Z",
  ...overrides,
});

const video = { id: "v1", status: "READY" } as Video;

afterEach(() => vi.unstubAllGlobals());

describe("upsertJob (WebSocket → cache)", () => {
  it("adds a new job first, replaces a newer copy, and never rolls back to an older one", () => {
    const client = new QueryClient();
    client.setQueryData(jobKeys.forVideo("v1"), [job({ id: "old", updatedAt: "2026-11-26T04:00:00.000Z" })]);

    upsertJob(client, job());
    upsertJob(client, job({ progress: 80, updatedAt: "2026-11-26T05:00:20.000Z" }));
    upsertJob(client, job({ progress: 10, updatedAt: "2026-11-26T05:00:05.000Z" })); // late message

    const jobs = client.getQueryData<Job[]>(jobKeys.forVideo("v1"))!;
    expect(jobs.map((j) => [j.id, j.progress])).toEqual([
      ["j1", 80],
      ["old", 40],
    ]);
  });
});

describe("sampleEvenly", () => {
  it("keeps the first and last and spreads the rest", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);

    const picked = sampleEvenly(items, 24);

    expect(picked).toHaveLength(24);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(99);
    expect(new Set(picked).size).toBe(24);
    expect(sampleEvenly([1, 2], 24)).toEqual([1, 2]);
  });
});

describe("ProcessingCard", () => {
  it("offers Process when the video has never been processed", async () => {
    const fetchMock = mockApi({ "POST /videos/v1/process": () => Response.json(job({ status: "PENDING" }), { status: 202 }) });
    renderWithProviders(<ProcessingCard video={video} latest={undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /^process$/i }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Not processed yet.")).toBeInTheDocument();
  });

  it("shows the live stage and progress with a Cancel button while running", async () => {
    const fetchMock = mockApi({
      "POST /jobs/j1/cancel": () => Response.json(job({ status: "CANCELLED" }), { status: 202 }),
    });
    renderWithProviders(<ProcessingCard video={video} latest={job()} />);

    expect(await screen.findByText("Extracting audio and frames")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("shows why a job failed and offers to process again", async () => {
    mockApi({});
    renderWithProviders(
      <ProcessingCard video={video} latest={job({ status: "FAILED", errorMessage: "Not a playable video: moov atom not found" })} />,
    );

    expect(await screen.findByText("Not a playable video: moov atom not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /process again/i })).toBeEnabled();
  });

  it("shows the server's reason when processing cannot start", async () => {
    mockApi({
      "POST /videos/v1/process": () => Response.json({ message: "This video is already being processed" }, { status: 409 }),
    });
    renderWithProviders(<ProcessingCard video={video} latest={undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /^process$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This video is already being processed");
  });
});

describe("formatCodecs", () => {
  it("names common codecs and says when there is no audio", () => {
    expect(formatCodecs({ videoCodec: "h264", audioCodec: "aac", hasAudio: true })).toBe("H.264 / AAC");
    expect(formatCodecs({ videoCodec: "hevc", audioCodec: null, hasAudio: false })).toBe("H.265 / no audio");
    expect(formatCodecs({ videoCodec: null, audioCodec: null, hasAudio: null })).toBe("—");
  });
});
