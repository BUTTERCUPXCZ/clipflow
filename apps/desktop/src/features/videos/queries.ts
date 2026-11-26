import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/features/projects/queries";
import { type Video, videosApi } from "./api";

/** Nested under the project key, so removing a project's queries removes its videos too. */
export const videoKeys = {
  list: (projectId: string) => ["projects", projectId, "videos"] as const,
};

export const POLL_INTERVAL_MS = 1000;

const anyImporting = (videos: Video[] | undefined) => videos?.some((v) => v.status === "IMPORTING") ?? false;

/** Polls every second while any video is importing; stops on its own once all are READY or FAILED. */
export function useVideos(projectId: string) {
  return useQuery({
    queryKey: videoKeys.list(projectId),
    queryFn: () => videosApi.list(projectId),
    refetchInterval: (query) => (anyImporting(query.state.data) ? POLL_INTERVAL_MS : false),
  });
}

export interface ImportFailure {
  path: string;
  reason: string;
}

/** Imports each picked file; one rejected file never stops the others. Resolves with the failures. */
export function useImportVideos(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (paths: string[]): Promise<ImportFailure[]> => {
      const failures: ImportFailure[] = [];
      for (const path of paths) {
        await videosApi.import(projectId, path).catch((error: unknown) => {
          failures.push({ path, reason: error instanceof Error ? error.message : String(error) });
        });
      }
      return failures;
    },
    onSettled: () => invalidate(queryClient, projectId),
  });
}

export function useDeleteVideo(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) => videosApi.remove(videoId),
    onSuccess: () => invalidate(queryClient, projectId),
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: videoKeys.list(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true }), // video counts
  ]);
}
