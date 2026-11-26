import { useQuery } from "@tanstack/react-query";
import { analysisApi } from "./api";

export const analysisKey = (videoId: string) => ["analysis", videoId] as const;

/** Refetched when a job for this video completes (see useLiveJobUpdates). */
export function useAnalysis(videoId: string) {
  return useQuery({ queryKey: analysisKey(videoId), queryFn: () => analysisApi.forVideo(videoId), retry: false });
}
