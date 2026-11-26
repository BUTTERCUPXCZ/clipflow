import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { ActivityPage } from "@/features/activity/activity-page";
import { ProjectList } from "@/features/projects/components/project-list";
import { ProjectPage } from "@/features/projects/components/project-page";
import { ClipsPage } from "@/features/renders/components/clips-page";
import { SystemStatus } from "@/features/system/system-status";
import { ProjectVideos } from "@/features/videos/components/project-videos";
import { VideoPage } from "@/features/videos/components/video-page";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectList,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  component: function ProjectRoute() {
    const { projectId } = projectRoute.useParams();
    return (
      <ProjectPage projectId={projectId}>
        <ProjectVideos projectId={projectId} />
      </ProjectPage>
    );
  },
});

const videoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/videos/$videoId",
  component: function VideoRoute() {
    const { projectId, videoId } = videoRoute.useParams();
    return <VideoPage projectId={projectId} videoId={videoId} />;
  },
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: SystemStatus,
});

const clipsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clips",
  component: ClipsPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, projectsRoute, projectRoute, videoRoute, clipsRoute, activityRoute, statusRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
