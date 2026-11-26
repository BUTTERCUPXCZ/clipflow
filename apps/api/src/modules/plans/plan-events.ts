import { readFile } from 'node:fs/promises';
import { Controller, Injectable, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { z } from 'zod';
import type { EditingPlanRow } from '../../infrastructure/database/schema.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import type { Ack } from '../jobs/job-events.handler.js';
import { PlansRepository, toPlan } from './plans.repository.js';

interface ProgressEvent {
  planId: string;
  sequence: number;
  progress: number;
  message: string;
}

interface CompletionEvent {
  planId: string;
  sequence: number;
  outputPath: string;
  metrics: { llmCalls: number; elapsedMs: number; windows: number; skippedWindows: number; clipCount: number };
}

interface FailureEvent {
  planId: string;
  sequence: number;
  errorCode: string;
  errorMessage: string;
}

/** plan.json as written by the AI service (apps/ai-service/app/planning/schemas.py EditingPlan), re-checked
 * here so a bad file fails the plan cleanly instead of breaking the insert on every worker retry. */
const planFileSchema = z.object({
  schemaVersion: z.string(),
  language: z.string(),
  skippedWindows: z.array(z.object({ start: z.number(), end: z.number(), errors: z.array(z.string()), raw: z.string().optional() })),
  clips: z
    .array(
      z
        .object({
          startSeconds: z.number().min(0),
          endSeconds: z.number(),
          score: z.number().int().min(1).max(10),
          reason: z.string(),
          title: z.string(),
          hook: z.string(),
          caption: z.string(),
          cropMode: z.string().optional(),
        })
        .refine((c) => c.endSeconds > c.startSeconds, 'endSeconds must be after startSeconds'),
    )
    .min(1),
});

/** Applies the worker's plan events; NestJS is the only DB writer. */
@Injectable()
export class PlanEventsHandler {
  private readonly logger = new Logger(PlanEventsHandler.name);

  constructor(
    private readonly plans: PlansRepository,
    private readonly gateway: EventsGateway,
    private readonly storage: MediaStorage,
  ) {}

  async progress(event: ProgressEvent): Promise<Ack> {
    const progress = Math.max(0, Math.min(100, Math.round(event.progress)));
    return this.ack(event.planId, await this.plans.applyProgress(event.planId, event.sequence, progress));
  }

  async completion(event: CompletionEvent): Promise<Ack> {
    let file: z.infer<typeof planFileSchema>;
    try {
      // Only this plan's own output: the path is checked, not trusted (it is resolved under MEDIA_ROOT).
      if (!event.outputPath.endsWith(`/plans/${event.planId}/plan.json`)) throw new Error(`unexpected path ${event.outputPath}`);
      file = planFileSchema.parse(JSON.parse(await readFile(this.storage.absolute(event.outputPath), 'utf8')));
    } catch (error) {
      this.logger.error(`plan ${event.planId}: unreadable output: ${String(error)}`);
      const ack = await this.failure({ ...event, errorCode: 'JOB_ERROR_CODE_INTERNAL', errorMessage: 'The plan could not be read' });
      return { ...ack, stop: true }; // now FAILED: the worker removes its output
    }
    const clips = file.clips.map((c, position) => ({
      position,
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      title: c.title,
      hook: c.hook,
      caption: c.caption,
      reason: c.reason,
      score: c.score,
      cropMode: c.cropMode ?? 'center',
    }));
    const applied = await this.plans.completeWithClips(event.planId, event.sequence, {
      schemaVersion: file.schemaVersion,
      language: file.language,
      metrics: { ...event.metrics },
      skipped: file.skippedWindows ?? [],
      clips,
    });
    // A retried completion is a success: stop would make the worker delete the output.
    return this.ack(event.planId, applied ?? (await this.plans.completedWith(event.planId, event.sequence)));
  }

  async failure(event: FailureEvent): Promise<Ack> {
    const code = event.errorCode.replace('JOB_ERROR_CODE_', '');
    const row = await this.plans.applyFailure(event.planId, event.sequence, {
      status: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      errorCode: code,
      errorMessage: event.errorMessage,
    });
    return this.ack(event.planId, row);
  }

  private async ack(id: string, row: EditingPlanRow | undefined): Promise<Ack> {
    if (row) {
      this.gateway.planUpdated(toPlan(row));
      return { applied: true, stop: false };
    }
    return { applied: false, stop: await this.plans.isGoneOrFinished(id) };
  }
}

/** gRPC JobEventsService: the plan part (proto/ai/v1/job_events.proto). */
@Controller()
export class PlanEventsController {
  constructor(private readonly handler: PlanEventsHandler) {}

  @GrpcMethod('JobEventsService', 'ReportPlanProgress')
  reportProgress(event: ProgressEvent): Promise<Ack> {
    return this.handler.progress(event);
  }

  @GrpcMethod('JobEventsService', 'ReportPlanCompletion')
  reportCompletion(event: CompletionEvent): Promise<Ack> {
    return this.handler.completion(event);
  }

  @GrpcMethod('JobEventsService', 'ReportPlanFailure')
  reportFailure(event: FailureEvent): Promise<Ack> {
    return this.handler.failure(event);
  }
}
