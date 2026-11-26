import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { CurrentUser } from '../../common/current-user.js';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { editingPlans, processingJobs, renderJobs, sourceVideos } from '../../infrastructure/database/schema.js';

export type ActivityKind = 'processing' | 'planning' | 'rendering';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  status: string;
  progress: number;
  errorMessage: string | null;
  videoId: string;
  videoName: string;
  projectId: string;
  updatedAt: Date;
}

const LIMIT = 50;

/** Recent work across every video (the desktop's Activity page): jobs, plans and renders, newest first. */
@Injectable()
export class ActivityRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async recent(userId: string): Promise<ActivityItem[]> {
    const video = { videoId: sourceVideos.id, videoName: sourceVideos.filename, projectId: sourceVideos.projectId };
    const [jobs, plans, renders] = await Promise.all([
      this.db
        .select({ id: processingJobs.id, status: processingJobs.status, progress: processingJobs.progress, errorMessage: processingJobs.errorMessage, updatedAt: processingJobs.updatedAt, ...video })
        .from(processingJobs)
        .innerJoin(sourceVideos, eq(sourceVideos.id, processingJobs.sourceVideoId))
        .where(eq(processingJobs.userId, userId))
        .orderBy(desc(processingJobs.updatedAt))
        .limit(LIMIT),
      this.db
        .select({ id: editingPlans.id, status: editingPlans.status, progress: editingPlans.progress, errorMessage: editingPlans.errorMessage, updatedAt: editingPlans.updatedAt, ...video })
        .from(editingPlans)
        .innerJoin(sourceVideos, eq(sourceVideos.id, editingPlans.sourceVideoId))
        .where(eq(editingPlans.userId, userId))
        .orderBy(desc(editingPlans.updatedAt))
        .limit(LIMIT),
      this.db
        .select({ id: renderJobs.id, status: renderJobs.status, progress: renderJobs.progress, errorMessage: renderJobs.errorMessage, updatedAt: renderJobs.updatedAt, ...video })
        .from(renderJobs)
        .innerJoin(sourceVideos, eq(sourceVideos.id, renderJobs.sourceVideoId))
        .where(eq(renderJobs.userId, userId))
        .orderBy(desc(renderJobs.updatedAt))
        .limit(LIMIT),
    ]);
    return mergeActivity({ processing: jobs, planning: plans, rendering: renders });
  }
}

/** The three lists as one, newest first, capped at LIMIT. */
export function mergeActivity(lists: Record<ActivityKind, Omit<ActivityItem, 'kind'>[]>): ActivityItem[] {
  return (Object.entries(lists) as [ActivityKind, Omit<ActivityItem, 'kind'>[]][])
    .flatMap(([kind, items]) => items.map((item) => ({ ...item, kind })))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, LIMIT);
}

@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityRepository) {}

  @Get('activity')
  recent(@CurrentUser() userId: string) {
    return this.activity.recent(userId);
  }
}

@Module({ controllers: [ActivityController], providers: [ActivityRepository] })
export class ActivityModule {}
