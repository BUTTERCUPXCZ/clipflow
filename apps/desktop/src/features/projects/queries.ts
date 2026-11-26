import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { type ProjectInput, projectsApi } from "./api";

export const projectKeys = {
  all: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

export function useProjects() {
  return useQuery({ queryKey: projectKeys.all, queryFn: () => projectsApi.list() });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => projectsApi.get(id),
    retry: (failures, error) => !isNotFound(error) && failures < 1,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectInput) => projectsApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProjectInput>) => projectsApi.update(id, input),
    onSuccess: (project) => {
      // The PATCH response is the fresh detail; only the list (name, ordering) needs refetching.
      queryClient.setQueryData(projectKeys.detail(id), project);
      return queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      return queryClient.invalidateQueries({ queryKey: projectKeys.all, exact: true });
    },
  });
}
