import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { SystemStatus } from "@/features/system/system-status";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/status" });
  },
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: SystemStatus,
});

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, statusRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
