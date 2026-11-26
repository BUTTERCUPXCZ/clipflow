import { type ApiClient, api } from "@/lib/api";

/** Mirrors Project in apps/api/src/modules/projects/projects.repository.ts (dates arrive as ISO strings). */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  videoCount: number;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
}

export class ProjectsApi {
  constructor(private readonly client: ApiClient) {}

  list(): Promise<ProjectSummary[]> {
    return this.client.getJson("/projects");
  }

  get(id: string): Promise<Project> {
    return this.client.getJson(`/projects/${id}`);
  }

  create(input: ProjectInput): Promise<Project> {
    return this.client.sendJson("POST", "/projects", input);
  }

  update(id: string, input: Partial<ProjectInput>): Promise<Project> {
    return this.client.sendJson("PATCH", `/projects/${id}`, input);
  }

  remove(id: string): Promise<void> {
    return this.client.sendJson("DELETE", `/projects/${id}`);
  }
}

export const projectsApi = new ProjectsApi(api);
