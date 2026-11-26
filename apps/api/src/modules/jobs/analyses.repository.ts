import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { type Database, DRIZZLE } from '../../infrastructure/database/database.tokens.js';
import { videoAnalyses, type VideoAnalysisRow } from '../../infrastructure/database/schema.js';

export type NewAnalysis = Pick<
  VideoAnalysisRow,
  'sourceVideoId' | 'processingJobId' | 'userId' | 'transcript' | 'visualAnalysis' | 'modelMetadata'
>;

/** Transcript + visual analysis of completed jobs; the latest one is the video's current analysis. */
@Injectable()
export class AnalysesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(analysis: NewAnalysis): Promise<void> {
    await this.db.insert(videoAnalyses).values(analysis).onConflictDoNothing({ target: videoAnalyses.processingJobId });
  }

  async latestForVideo(userId: string, videoId: string): Promise<VideoAnalysisRow | undefined> {
    const [row] = await this.db
      .select()
      .from(videoAnalyses)
      .where(and(eq(videoAnalyses.sourceVideoId, videoId), eq(videoAnalyses.userId, userId)))
      .orderBy(desc(videoAnalyses.createdAt))
      .limit(1);
    return row;
  }
}
