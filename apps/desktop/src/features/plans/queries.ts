import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PlanSettings, plansApi } from "./api";

export const planKeys = {
  all: ["plans"] as const,
  forVideo: (videoId: string) => ["plans", "video", videoId] as const,
  detail: (planId: string) => ["plans", "detail", planId] as const,
};

/** No polling: plan.updated arrives over the app's WebSocket and refetches these (see useLiveJobUpdates). */
export function usePlans(videoId: string) {
  return useQuery({ queryKey: planKeys.forVideo(videoId), queryFn: () => plansApi.listForVideo(videoId) });
}

export function usePlan(planId: string | undefined) {
  return useQuery({
    queryKey: planKeys.detail(planId ?? ""),
    queryFn: () => plansApi.get(planId!),
    enabled: planId !== undefined,
  });
}

export function useCreatePlan(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: PlanSettings) => plansApi.create(videoId, settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: planKeys.forVideo(videoId) }),
  });
}

/** Cancel, adjust and remove all change a plan: refetch plans (list status and the open plan's clips). */
function usePlanMutation<A>(mutationFn: (args: A) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: planKeys.all }) });
}

export const useCancelPlan = () => usePlanMutation((planId: string) => plansApi.cancel(planId));

export const useAdjustClip = (planId: string) =>
  usePlanMutation((a: { clipId: string; startSeconds: number; endSeconds: number }) =>
    plansApi.adjustClip(planId, a.clipId, { startSeconds: a.startSeconds, endSeconds: a.endSeconds }),
  );

export const useRemoveClip = (planId: string) => usePlanMutation((clipId: string) => plansApi.removeClip(planId, clipId));
