import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "@/test/render";
import type { Video } from "../api";
import { VideoTable } from "./video-table";

const video = (overrides: Partial<Video> = {}): Video => ({
  id: "v1",
  projectId: "p1",
  filename: "episode-12.mp4",
  fileSize: 2 * 1024 ** 3,
  bytesCopied: 2 * 1024 ** 3,
  mimeType: "video/mp4",
  status: "READY",
  errorMessage: null,
  duration: null,
  width: null,
  height: null,
  frameRate: null,
  createdAt: "2026-11-26T05:00:00.000Z",
  updatedAt: "2026-11-26T05:00:00.000Z",
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VideoTable", () => {
  it("shows an empty state", async () => {
    mockApi({ "GET /projects/p1/videos": () => Response.json([]) });

    renderWithProviders(<VideoTable projectId="p1" />);

    expect(await screen.findByText(/No videos yet/)).toBeInTheDocument();
  });

  it("shows a ready video with its size and placeholders for Phase 3 metadata", async () => {
    mockApi({ "GET /projects/p1/videos": () => Response.json([video()]) });

    renderWithProviders(<VideoTable projectId="p1" />);

    const row = (await screen.findByText("episode-12.mp4")).closest("tr")!;
    expect(within(row).getByText("2.0 GB")).toBeInTheDocument();
    expect(within(row).getByText("Ready")).toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("shows import progress as an accessible progress bar", async () => {
    mockApi({
      "GET /projects/p1/videos": () =>
        Response.json([video({ status: "IMPORTING", bytesCopied: 1024 ** 3 })]),
    });

    renderWithProviders(<VideoTable projectId="p1" />);

    const bar = await screen.findByRole("progressbar", { name: "Importing episode-12.mp4" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Importing 50%")).toBeInTheDocument();
  });

  it("shows why an import failed", async () => {
    mockApi({
      "GET /projects/p1/videos": () =>
        Response.json([video({ status: "FAILED", errorMessage: "Import interrupted. Import the file again" })]),
    });

    renderWithProviders(<VideoTable projectId="p1" />);

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Import interrupted. Import the file again")).toBeInTheDocument();
  });

  it("polls while a video imports and stops once it is ready", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const responses = [video({ status: "IMPORTING", bytesCopied: 1024 ** 3 }), video()];
    const fetchMock = mockApi({ "GET /projects/p1/videos": () => Response.json([responses.shift() ?? video()]) });

    renderWithProviders(<VideoTable projectId="p1" />);
    expect(await screen.findByText("Importing 50%")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(await screen.findByText("Ready")).toBeInTheDocument();

    const callsWhenReady = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock.mock.calls.length).toBe(callsWhenReady);
  });

  it("asks before deleting and removes the row once confirmed", async () => {
    let videos = [video()];
    mockApi({
      "GET /projects/p1/videos": () => Response.json(videos),
      "DELETE /videos/v1": () => {
        videos = [];
        return new Response(null, { status: 204 });
      },
      "GET /projects": () => Response.json([]),
    });
    renderWithProviders(<VideoTable projectId="p1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete episode-12.mp4" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Delete “episode-12.mp4”?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete video" }));

    expect(await screen.findByText(/No videos yet/)).toBeInTheDocument();
  });

  it("words the dialog as cancelling when the video is still importing, and Keep does nothing", async () => {
    const fetchMock = mockApi({
      "GET /projects/p1/videos": () => Response.json([video({ status: "IMPORTING", bytesCopied: 0 })]),
    });
    renderWithProviders(<VideoTable projectId="p1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete episode-12.mp4" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Cancel this import?");
    expect(within(dialog).getByRole("button", { name: "Cancel import and delete" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
});
