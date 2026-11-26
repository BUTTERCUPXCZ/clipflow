import { readFile } from 'node:fs/promises';
import { Controller, Injectable, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { z } from 'zod';
import type { RenderJobRow } from '../../infrastructure/database/schema.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import type { Ack } from '../jobs/job-events.handler.js';
import { RendersRepository, toRender } from './renders.repository.js';

interface ProgressEvent {
  renderId: string;
  sequence: number;
  progress: number;
  message: string;
}

interface CompletionEvent {
  renderId: string;
  sequence: number;
  outputPath: string;
  metrics: { rendered: number; failed: number; elapsedMs: number; encoder: string };
}

interface FailureEvent {
  renderId: string;
  sequence: number;
  errorCode: string;
  errorMessage: string;
}

/** render.json as written by apps/ai-service/app/jobs/rendering_job.py, re-checked before it is stored. */
const renderFileSchema = z.object({
  clips: z
    .array(
      z.object({
        clipId: z.uuid(),
        file: z.string().min(1),
        thumbnail: z.string().min(1),
        durationSeconds: z.number().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        sizeBytes: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  failures: z.array(z.object({ clipId: z.string(), error: z.string() })),
});

/** Applies the worker's render events; NestJS is the only DB writer. */
@Injectable()
export class RenderEventsHandler {
  private readonly logger = new Logger(RenderEventsHandler.name);

  constructor(
    private readonly renders: RendersRepository,
    private readonly gateway: EventsGateway,
    private readonly storage: MediaStorage,
  ) {}

  async progress(event: ProgressEvent): Promise<Ack> {
    const progress = Math.max(0, Math.min(100, Math.round(event.progress)));
    return this.ack(event.renderId, await this.renders.applyProgress(event.renderId, event.sequence, progress));
  }

  async completion(event: CompletionEvent): Promise<Ack> {
    let file: z.infer<typeof renderFileSchema>;
    try {
      if (!event.outputPath.endsWith(`/renders/${event.renderId}/render.json`)) throw new Error(`unexpected path ${event.outputPath}`);
      const dir = event.outputPath.slice(0, -'render.json'.length);
      file = renderFileSchema.parse(JSON.parse(await readFile(this.storage.absolute(event.outputPath), 'utf8')));
      // Every output must be exactly where this render writes it.
      if (file.clips.some((c) => c.file !== `${dir}${c.clipId}.mp4` || c.thumbnail !== `${dir}${c.clipId}.jpg`)) {
        throw new Error('output outside the render directory');
      }
    } catch (error) {
      this.logger.error(`render ${event.renderId}: unreadable output: ${String(error)}`);
      const ack = await this.failure({ ...event, errorCode: 'JOB_ERROR_CODE_INTERNAL', errorMessage: 'The rendered clips could not be read' });
      return { ...ack, stop: true }; // now FAILED: the worker removes its output
    }
    // Titles and times come from the snapshot taken when the render started, not from the plan now.
    const sent = new Map(((await this.renders.findAny(event.renderId))?.settings.clips ?? []).map((c) => [c.id, c]));
    const clips = file.clips.flatMap((c, position) => {
      const source = sent.get(c.clipId);
      if (!source) return [];
      return [
        {
          plannedClipId: source.id,
          position,
          title: source.title,
          startSeconds: source.startSeconds,
          endSeconds: source.endSeconds,
          filePath: c.file,
          thumbnailPath: c.thumbnail,
          durationSeconds: c.durationSeconds,
          width: c.width,
          height: c.height,
          sizeBytes: c.sizeBytes,
        },
      ];
    });
    if (!clips.length) {
      // A COMPLETED render always has clips: outputs for clips it never asked for are a failure, not success.
      const ack = await this.failure({ ...event, errorCode: 'JOB_ERROR_CODE_INTERNAL', errorMessage: 'The rendered clips did not match the plan' });
      return { ...ack, stop: true };
    }
    const applied = await this.renders.completeWithClips(event.renderId, event.sequence, {
      metrics: { ...event.metrics },
      failures: file.failures,
      clips,
    });
    // A retried completion is a success: stop would make the worker delete the output.
    return this.ack(event.renderId, applied ?? (await this.renders.completedWith(event.renderId, event.sequence)));
  }

  async failure(event: FailureEvent): Promise<Ack> {
    const code = event.errorCode.replace('JOB_ERROR_CODE_', '');
    const row = await this.renders.applyFailure(event.renderId, event.sequence, {
      status: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      errorCode: code,
      errorMessage: event.errorMessage,
    });
    return this.ack(event.renderId, row);
  }

  private async ack(id: string, row: RenderJobRow | undefined): Promise<Ack> {
    if (row) {
      this.gateway.renderUpdated(toRender(row));
      return { applied: true, stop: false };
    }
    return { applied: false, stop: await this.renders.isGoneOrFinished(id) };
  }
}

/** gRPC JobEventsService: the render part (proto/ai/v1/job_events.proto). */
@Controller()
export class RenderEventsController {
  constructor(private readonly handler: RenderEventsHandler) {}

  @GrpcMethod('JobEventsService', 'ReportRenderProgress')
  reportProgress(event: ProgressEvent): Promise<Ack> {
    return this.handler.progress(event);
  }

  @GrpcMethod('JobEventsService', 'ReportRenderCompletion')
  reportCompletion(event: CompletionEvent): Promise<Ack> {
    return this.handler.completion(event);
  }

  @GrpcMethod('JobEventsService', 'ReportRenderFailure')
  reportFailure(event: FailureEvent): Promise<Ack> {
    return this.handler.failure(event);
  }
}
