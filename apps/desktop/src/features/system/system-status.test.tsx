import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthReport } from "./api";
import { SystemStatus } from "./system-status";

const ok = (detail: string) => ({ status: "ok" as const, detail });
const error = (detail: string) => ({ status: "error" as const, detail });

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe("SystemStatus", () => {
  it("shows every check as OK when healthy", async () => {
    const report: HealthReport = {
      status: "ok",
      checks: {
        database: ok("connected"),
        ai_service: ok("connected"),
        model_runtime: ok("Ollama reachable, 3 models installed"),
        vision_model: ok("qwen3-vl:8b-instruct"),
        worker: ok("processing worker running"),
      },
    };
    mockFetch(async () => Response.json(report));

    renderStatus();

    expect(await screen.findByText("qwen3-vl:8b-instruct")).toBeInTheDocument();
    expect(screen.getAllByText("OK")).toHaveLength(6);
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("treats a 503 as a report and shows which dependency failed", async () => {
    const report: HealthReport = {
      status: "error",
      checks: {
        database: error("unreachable: ECONNREFUSED"),
        ai_service: ok("connected"),
        model_runtime: ok("Ollama reachable, 3 models installed"),
        vision_model: ok("qwen3-vl:8b-instruct"),
        worker: ok("processing worker running"),
      },
    };
    mockFetch(async () => Response.json(report, { status: 503 }));

    renderStatus();

    expect(await screen.findByText("unreachable: ECONNREFUSED")).toBeInTheDocument();
    expect(within(row("PostgreSQL")).getByText("Error")).toBeInTheDocument();
    expect(within(row("NestJS API")).getByText("OK")).toBeInTheDocument();
  });

  it("does not blame reachability when the API answers with an unexpected status", async () => {
    mockFetch(async () => new Response("not found", { status: 404 }));

    renderStatus();

    expect(await screen.findByText("Unexpected health response: HTTP 404")).toBeInTheDocument();
    expect(screen.getAllByText("unknown: health check failed")).toHaveLength(5);
  });

  it("stops showing the previous OK rows when a refresh fails", async () => {
    const report: HealthReport = {
      status: "ok",
      checks: {
        database: ok("connected"),
        ai_service: ok("connected"),
        model_runtime: ok("Ollama reachable, 3 models installed"),
        vision_model: ok("qwen3-vl:8b-instruct"),
        worker: ok("processing worker running"),
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(report))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    renderStatus();
    await screen.findByText("qwen3-vl:8b-instruct");
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findAllByText("unknown: API unreachable")).toHaveLength(5);
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  it("shows an API-unreachable state instead of a blank screen", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    renderStatus();

    expect(await screen.findByText(/API unreachable at/)).toBeInTheDocument();
    expect(within(row("NestJS API")).getByText("Error")).toBeInTheDocument();
    expect(screen.getAllByText("unknown: API unreachable")).toHaveLength(5);
  });
});
