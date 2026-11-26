import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EditingPlanRow, PlannedClipRow } from '../../infrastructure/database/schema.js';
import { AnalysesRepository } from '../jobs/analyses.repository.js';
import { ClipsRepository } from './clips.repository.js';
import { PlansRepository } from './plans.repository.js';
import type { AdjustClip } from './plans.schemas.js';
import { buildCues, type Cue, transcriptWords } from './subtitles.js';

/** Edits to a completed plan's clips. AI output is a proposal: every edit is re-validated here. */
@Injectable()
export class ClipsService {
  constructor(
    private readonly plans: PlansRepository,
    private readonly clips: ClipsRepository,
    private readonly analyses: AnalysesRepository,
  ) {}

  async adjust(userId: string, planId: string, clipId: string, change: AdjustClip): Promise<PlannedClipRow> {
    const { plan, clip } = await this.editable(userId, planId, clipId);
    const start = change.startSeconds ?? clip.startSeconds;
    const end = change.endSeconds ?? clip.endSeconds;
    const problem = validateRange(start, end, plan, await this.clips.listForPlan(planId), clipId);
    if (problem) throw new BadRequestException(problem);
    return this.clips.updateTimes(clipId, start, end);
  }

  async remove(userId: string, planId: string, clipId: string): Promise<void> {
    await this.editable(userId, planId, clipId);
    await this.clips.remove(clipId);
  }

  async subtitles(userId: string, planId: string, clipId: string): Promise<Cue[]> {
    const { plan, clip } = await this.found(userId, planId, clipId);
    const analysis = await this.analyses.findByJob(plan.processingJobId);
    return buildCues(transcriptWords(analysis?.transcript ?? null), clip.startSeconds, clip.endSeconds);
  }

  private async found(userId: string, planId: string, clipId: string) {
    const plan = await this.plans.findOwned(userId, planId);
    const clip = plan && (await this.clips.findInPlan(planId, clipId));
    if (!plan || !clip) throw new NotFoundException('Clip not found');
    return { plan, clip };
  }

  private async editable(userId: string, planId: string, clipId: string) {
    const found = await this.found(userId, planId, clipId);
    if (found.clip.removedAt) throw new ConflictException('This clip was removed');
    return found;
  }
}

/** Why [start, end] is not a valid range for this clip, or undefined when it is. */
export function validateRange(
  start: number,
  end: number,
  plan: Pick<EditingPlanRow, 'durationSeconds' | 'settings'>,
  clips: Pick<PlannedClipRow, 'id' | 'startSeconds' | 'endSeconds' | 'removedAt'>[],
  clipId: string,
): string | undefined {
  const { minSeconds, maxSeconds } = plan.settings;
  if (start < 0 || end <= start) return 'The end must be after the start';
  if (end > plan.durationSeconds + 1e-6) return `The clip must end by ${plan.durationSeconds.toFixed(1)} s (the end of the video)`;
  const length = end - start;
  if (length < minSeconds - 1e-6 || length > maxSeconds + 1e-6) {
    return `A clip must be ${minSeconds}–${maxSeconds} s long; this one would be ${length.toFixed(1)} s`;
  }
  const overlap = clips.find((c) => c.id !== clipId && !c.removedAt && start < c.endSeconds && end > c.startSeconds);
  if (overlap) return `It would overlap the clip at ${overlap.startSeconds.toFixed(1)}–${overlap.endSeconds.toFixed(1)} s`;
  return undefined;
}
