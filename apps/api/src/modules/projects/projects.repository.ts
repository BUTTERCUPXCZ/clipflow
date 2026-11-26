import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { projects, sourceVideos } from '../../infrastructure/database/schema.js';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithVideoCount extends Project {
  videoCount: number;
}

export interface ProjectChanges {
  name?: string;
  description?: string | null;
}

const columns = {
  id: projects.id,
  name: projects.name,
  description: projects.description,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

/**
 * Persistence for projects. Every method is scoped to `userId`: rows of other users are invisible,
 * so "not owned" and "not found" are the same answer.
 */
@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(userId: string, input: { name: string; description: string | null }): Promise<Project> {
    const [row] = await this.db
      .insert(projects)
      .values({ userId, ...input })
      .returning(columns);
    return row;
  }

  listWithVideoCount(userId: string): Promise<ProjectWithVideoCount[]> {
    return this.db
      .select({ ...columns, videoCount: count(sourceVideos.id) })
      .from(projects)
      .leftJoin(sourceVideos, eq(sourceVideos.projectId, projects.id))
      .where(eq(projects.userId, userId))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));
  }

  async findOwned(userId: string, id: string): Promise<Project | undefined> {
    const [row] = await this.db.select(columns).from(projects).where(this.owned(userId, id)).limit(1);
    return row;
  }

  async update(userId: string, id: string, changes: ProjectChanges): Promise<Project | undefined> {
    const [row] = await this.db
      .update(projects)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(this.owned(userId, id))
      .returning(columns);
    return row;
  }

  /** @returns false when no owned project had that id */
  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const deleted = await this.db.delete(projects).where(this.owned(userId, id)).returning({ id: projects.id });
    return deleted.length > 0;
  }

  private owned(userId: string, id: string) {
    return and(eq(projects.id, id), eq(projects.userId, userId));
  }
}
