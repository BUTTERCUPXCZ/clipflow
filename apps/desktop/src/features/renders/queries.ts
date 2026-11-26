import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rendersApi } from "./api";

export const renderKeys = {
  all: ["renders"] as const,
  forPlan: (planId: string) => ["renders", "plan", planId] as const,
  detail: (id: string) => ["renders", "detail", id] as const,
  gallery: ["renders", "gallery"] as const,
};

/** No polling: render.updated arrives over the app's WebSocket and refetches these (see useLiveJobUpdates). */
export function useRenders(planId: string) {
  return useQuery({ queryKey: renderKeys.forPlan(planId), queryFn: () => rendersApi.listForPlan(planId) });
}

export function useRender(id: string | undefined) {
  return useQuery({ queryKey: renderKeys.detail(id ?? ""), queryFn: () => rendersApi.get(id!), enabled: id !== undefined });
}

export function useGallery() {
  return useQuery({ queryKey: renderKeys.gallery, queryFn: () => rendersApi.gallery() });
}

function useRenderMutation<A, R>(mutationFn: (args: A) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => queryClient.invalidateQueries({ queryKey: renderKeys.all }) });
}

export const useCreateRender = (planId: string) => useRenderMutation((subtitles: boolean) => rendersApi.create(planId, subtitles));
export const useCancelRender = () => useRenderMutation((id: string) => rendersApi.cancel(id));
