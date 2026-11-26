import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Experiment, experimentsApi } from "./api";

export const experimentKeys = {
  models: ["experiments", "models"] as const,
  forVideo: (videoId: string) => ["experiments", "video", videoId] as const,
};

/** No polling: experiment.updated arrives over the app's WebSocket (see useLiveJobUpdates). */
export function useExperiments(videoId: string) {
  return useQuery({ queryKey: experimentKeys.forVideo(videoId), queryFn: () => experimentsApi.listForVideo(videoId) });
}

export function useVisionModels() {
  return useQuery({ queryKey: experimentKeys.models, queryFn: () => experimentsApi.models(), retry: false });
}

export function useRunExperiment(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { model: string; batchSize?: number }) => experimentsApi.run({ videoId, ...input }),
    onSuccess: (experiment) => upsertExperiment(queryClient, experiment),
  });
}

export function useCancelExperiment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => experimentsApi.cancel(id),
    onSuccess: (experiment) => upsertExperiment(queryClient, experiment),
  });
}

/** Same rule as jobs: newest first, and a late message never rolls an experiment back. */
export function upsertExperiment(queryClient: QueryClient, experiment: Experiment): void {
  queryClient.setQueryData<Experiment[]>(experimentKeys.forVideo(experiment.sourceVideoId), (list) => {
    if (!list) return list;
    const existing = list.find((e) => e.id === experiment.id);
    if (!existing) return [experiment, ...list];
    if (existing.updatedAt > experiment.updatedAt) return list;
    return list.map((e) => (e.id === experiment.id ? experiment : e));
  });
}
