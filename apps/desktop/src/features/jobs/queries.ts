import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { activityKey } from "@/features/activity/queries";
import { analysisKey } from "@/features/analysis/queries";
import { fetchHealth } from "@/features/system/api";
import type { Experiment } from "@/features/experiments/api";
import { upsertExperiment } from "@/features/experiments/queries";
import { planKeys } from "@/features/plans/queries";
import { renderKeys } from "@/features/renders/queries";
import type { ConnectionState, EventsClient } from "@/lib/events";
import { type Job, jobsApi } from "./api";

export const jobKeys = {
  all: ["jobs"] as const,
  forVideo: (videoId: string) => ["jobs", "video", videoId] as const,
  frames: (jobId: string) => ["jobs", jobId, "frames"] as const,
};

/** No polling: live changes arrive over the WebSocket (useLiveJobUpdates) and are written into this cache. */
export function useVideoJobs(videoId: string) {
  return useQuery({ queryKey: jobKeys.forVideo(videoId), queryFn: () => jobsApi.listForVideo(videoId) });
}

export function useJobFrames(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: jobKeys.frames(jobId),
    queryFn: () => jobsApi.frames(jobId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY, // frames never change once a job has completed
  });
}

export function useProcessVideo(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => jobsApi.process(videoId),
    onSuccess: (job) => upsertJob(queryClient, job),
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => jobsApi.cancel(jobId),
    onSuccess: (job) => upsertJob(queryClient, job),
  });
}

/** Puts a job into its video's list (newest first), replacing an older copy unless that one is newer. */
export function upsertJob(queryClient: QueryClient, job: Job): void {
  queryClient.setQueryData<Job[]>(jobKeys.forVideo(job.sourceVideoId), (jobs) => {
    if (!jobs) return jobs; // list not loaded yet: it will be fetched with this job in it
    const existing = jobs.find((j) => j.id === job.id);
    if (!existing) return [job, ...jobs];
    if (existing.updatedAt > job.updatedAt) return jobs; // a late message must not roll back state
    return jobs.map((j) => (j.id === job.id ? job : j));
  });
}

/**
 * Connects the app to the API's event stream: applies job.updated to the cache and refetches all job
 * queries whenever the socket (re)opens, so nothing missed while disconnected stays stale.
 */
export function useLiveJobUpdates(events: EventsClient): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const offMessage = events.onMessage((message) => {
      if (message.event === "job.updated") {
        const job = message.data as Job;
        upsertJob(queryClient, job);
        // A completed job has just stored a new analysis for its video.
        if (job.status === "COMPLETED") void queryClient.invalidateQueries({ queryKey: analysisKey(job.sourceVideoId) });
      }
      if (message.event === "experiment.updated") upsertExperiment(queryClient, message.data as Experiment);
      // A plan event carries no clips: refetch the plan list and the open plan.
      if (message.event === "plan.updated") void queryClient.invalidateQueries({ queryKey: planKeys.all });
      if (message.event === "render.updated") {
        const render = message.data as { planId: string; status: string };
        void queryClient.invalidateQueries({ queryKey: renderKeys.forPlan(render.planId) });
        // Clips exist only once a render ends: the gallery and details refetch then, not on every progress tick.
        if (!["PENDING", "RUNNING"].includes(render.status)) void queryClient.invalidateQueries({ queryKey: renderKeys.all });
      }
      // Any change to any work moves the Activity page.
      void queryClient.invalidateQueries({ queryKey: activityKey });
    });
    const offState = events.onState((state) => {
      if (state === "open") {
        void queryClient.invalidateQueries({ queryKey: jobKeys.all });
        void queryClient.invalidateQueries({ queryKey: ["experiments"] });
        void queryClient.invalidateQueries({ queryKey: planKeys.all });
        void queryClient.invalidateQueries({ queryKey: renderKeys.all });
        void queryClient.invalidateQueries({ queryKey: activityKey });
      }
    });
    events.start();
    return () => {
      offMessage();
      offState();
      events.stop();
    };
  }, [events, queryClient]);
}

export function useConnectionState(events: EventsClient): ConnectionState {
  return useSyncExternalStore(
    (onChange) => events.onState(onChange),
    () => events.getState(),
  );
}

/** True when the API health check says no processing worker is running (polled only while `enabled`). */
export function useWorkerMissing(enabled: boolean): boolean {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth, enabled, refetchInterval: 5000 });
  return enabled && health.data?.checks.worker?.status === "error";
}
