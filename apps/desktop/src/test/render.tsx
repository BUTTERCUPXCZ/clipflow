import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** Renders `ui` inside a memory router (so <Link>/useNavigate work) and a fresh, non-retrying QueryClient. */
export function renderWithProviders(ui: ReactElement, { path = "/" }: { path?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

type Handler = (body: unknown) => Response | Promise<Response>;

/**
 * Fake API: routes keyed "METHOD /path" (path after /api/v1). Unmatched calls fail the test loudly.
 * Returns the fetch mock so tests can assert on calls.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace(/^\/api\/v1/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected API call: ${key}`);
    return handler(init?.body ? JSON.parse(String(init.body)) : undefined);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
