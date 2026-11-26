import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Mirrors ActivityItem in apps/api/src/modules/activity/activity.ts. */
export interface ActivityItem {
  id: string;
  kind: "processing" | "planning" | "rendering";
  status: string;
  progress: number;
  errorMessage: string | null;
  videoId: string;
  videoName: string;
  projectId: string;
  updatedAt: string;
}

export const activityKey = ["activity"] as const;

/** Refetched on every live event (see useLiveJobUpdates), so running work moves without polling. */
export function useActivity() {
  return useQuery({ queryKey: activityKey, queryFn: () => api.getJson<ActivityItem[]>("/activity") });
}
