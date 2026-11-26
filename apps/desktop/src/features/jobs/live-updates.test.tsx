import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EventsClient, type SocketFactory } from "@/lib/events";
import type { Job } from "./api";
import { analysisKey } from "@/features/analysis/queries";
import type { Experiment } from "@/features/experiments/api";
import { experimentKeys } from "@/features/experiments/queries";
import { planKeys } from "@/features/plans/queries";
import { NoWorkerHint } from "./components/processing-card";
import { jobKeys, useLiveJobUpdates } from "./queries";

class FakeSocket {
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  close() {
    this.onclose?.({});
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const events = new EventsClient("ws://api.test/ws", (() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  }) as unknown as SocketFactory);
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useLiveJobUpdates(events), { wrapper });
  return { sockets, queryClient };
}

const job = { id: "j1", sourceVideoId: "v1", status: "EXTRACTING_MEDIA", progress: 40, updatedAt: "2026-11-26T05:00:00.000Z" } as Job;

describe("useLiveJobUpdates", () => {
  it("writes job.updated events into the video's job list", () => {
    const { sockets, queryClient } = setup();
    queryClient.setQueryData(jobKeys.forVideo("v1"), [job]);

    act(() => {
      sockets[0].onopen?.({});
      sockets[0].onmessage?.({
        data: JSON.stringify({ event: "job.updated", data: { ...job, progress: 80, updatedAt: "2026-11-26T05:00:05.000Z" } }),
      });
    });

    expect(queryClient.getQueryData<Job[]>(jobKeys.forVideo("v1"))?.[0].progress).toBe(80);
  });

  it("refetches every job query when the socket (re)opens, recovering events missed while down", () => {
    const { sockets, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => sockets[0].onopen?.({}));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: jobKeys.all });
  });
});

describe("EventsClient restart (React StrictMode: start → stop → start)", () => {
  /** A socket whose close event arrives only when the test says so, like a real one. */
  class SlowClosingSocket extends FakeSocket {
    override close() {}
    fireClose() {
      this.onclose?.({});
    }
  }

  it("ignores the late close of the old socket instead of dropping the new one", () => {
    vi.useFakeTimers();
    const sockets: SlowClosingSocket[] = [];
    const client = new EventsClient("ws://api.test/ws", (() => {
      const socket = new SlowClosingSocket();
      sockets.push(socket);
      return socket;
    }) as unknown as SocketFactory);

    client.start();
    client.stop();
    client.start();
    sockets[1].onopen?.({});
    sockets[0].fireClose(); // the first socket's close only arrives now

    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2); // no extra reconnect
    expect(client.getState()).toBe("open");
    vi.useRealTimers();
  });

  it("refetches the video's analysis when one of its jobs completes", () => {
    const { sockets, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ event: "job.updated", data: { ...job, status: "COMPLETED" } }) }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: analysisKey("v1") });
  });

  it("writes experiment.updated events into the video's experiment list", () => {
    const { sockets, queryClient } = setup();
    const experiment = { id: "e1", sourceVideoId: "v1", status: "RUNNING", progress: 10, updatedAt: "2026-11-26T05:00:00.000Z" } as Experiment;
    queryClient.setQueryData(experimentKeys.forVideo("v1"), [experiment]);

    act(() =>
      sockets[0].onmessage?.({
        data: JSON.stringify({ event: "experiment.updated", data: { ...experiment, progress: 60, updatedAt: "2026-11-26T05:00:09.000Z" } }),
      }),
    );

    expect(queryClient.getQueryData<Experiment[]>(experimentKeys.forVideo("v1"))?.[0].progress).toBe(60);
  });
});

describe("plan.updated", () => {
  it("refetches plans, since the event carries no clips", () => {
    const { sockets, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    act(() => sockets[0].onmessage?.({ data: JSON.stringify({ event: "plan.updated", data: { id: "p1", status: "COMPLETED" } }) }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: planKeys.all });
  });
});

describe("NoWorkerHint", () => {
  it("shows only for a pending job when the health check reports no worker", async () => {
    const queryClient = new QueryClient();
    const health = (status: "ok" | "error") => ({ status, checks: { worker: { status, detail: "" } } });
    queryClient.setQueryData(["system", "health"], health("error"));
    const view = (status: Job["status"]) => (
      <QueryClientProvider client={queryClient}>
        <NoWorkerHint job={{ ...job, status }} />
      </QueryClientProvider>
    );

    const { rerender } = render(view("PENDING"));
    expect(screen.getByRole("status")).toHaveTextContent("npm run dev:ai");

    rerender(view("EXTRACTING_MEDIA"));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => queryClient.setQueryData(["system", "health"], health("ok")));
    rerender(view("PENDING"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
