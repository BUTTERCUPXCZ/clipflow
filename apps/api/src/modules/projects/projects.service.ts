import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { type Project, type ProjectWithVideoCount, ProjectsRepository } from './projects.repository.js';
import type { CreateProject, UpdateProject } from './projects.schemas.js';

/** Project use cases. "Not owned" and "not found" are the same 404, so other users' ids leak nothing. */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly storage: MediaStorage,
  ) {}

  create(userId: string, input: CreateProject): Promise<Project> {
    return this.projects.create(userId, { name: input.name, description: input.description ?? null });
  }

  list(userId: string): Promise<ProjectWithVideoCount[]> {
    return this.projects.listWithVideoCount(userId);
  }

  async get(userId: string, id: string): Promise<Project> {
    return found(await this.projects.findOwned(userId, id));
  }

  async update(userId: string, id: string, changes: UpdateProject): Promise<Project> {
    return found(await this.projects.update(userId, id, changes));
  }

  /** Deletes the project, its videos (DB cascade) and its media directory. */
  async delete(userId: string, id: string): Promise<void> {
    if (!(await this.projects.deleteOwned(userId, id))) throw notFound();
    await this.storage.removeProjectDir(userId, id);
  }
}

const notFound = () => new NotFoundException('Project not found');

function found(project: Project | undefined): Project {
  if (!project) throw notFound();
  return project;
}
