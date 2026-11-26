import { readFile } from 'node:fs/promises';
import { Controller, Injectable, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type { ExperimentRow } from '../../infrastructure/database/schema.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import type { Ack } from '../jobs/job-events.handler.js';
import { ExperimentsRepository, toExperiment } from './experiments.repository.js';

interface ProgressEvent {
  experimentId: string;
  sequence: number;
  progress: number;
  message: string;
}

interface CompletionEvent {
  experimentId: string;
  sequence: number;
  outputPath: string;
  metrics: {
    loadMs: number;
    inferenceMs: number;
    totalMs: number;
    peakVramMib: number;
    framesAnalysed: number;
    validBatches: number;
    totalBatches: number;
  };
}

interface FailureEvent {
  experimentId: string;
  sequence: number;
  errorCode: string;
  errorMessage: string;
}

/** Applies the worker's experiment events and forwards each applied change to the desktop. */
@Injectable()
export class ExperimentEventsHandler {
  private readonly logger = new Logger(ExperimentEventsHandler.name);

  constructor(
    private readonly experiments: ExperimentsRepository,
    private readonly gateway: EventsGateway,
    private readonly storage: MediaStorage,
  ) {}

  async progress(event: ProgressEvent): Promise<Ack> {
    const progress = Math.max(0, Math.min(100, Math.round(event.progress)));
    return this.ack(event.experimentId, await this.experiments.applyProgress(event.experimentId, event.sequence, progress));
  }

  async completion(event: CompletionEvent): Promise<Ack> {
    let output: unknown;
    try {
      output = JSON.parse(await readFile(this.storage.absolute(event.outputPath), 'utf8'));
    } catch (error) {
      this.logger.error(`experiment ${event.experimentId}: unreadable output: ${String(error)}`);
      const ack = await this.failure({ ...event, errorCode: 'JOB_ERROR_CODE_INTERNAL', errorMessage: 'The experiment output could not be read' });
      return { ...ack, stop: true }; // now FAILED: the worker removes its output
    }
    const m = event.metrics;
    const applied = await this.experiments.applyCompletion(event.experimentId, event.sequence, {
      outputPath: event.outputPath,
      output,
      metrics: {
        loadMs: m.loadMs,
        inferenceMs: m.inferenceMs,
        totalMs: m.totalMs,
        peakVramMiB: m.peakVramMib < 0 ? null : m.peakVramMib,
        framesAnalysed: m.framesAnalysed,
        validBatches: m.validBatches,
        totalBatches: m.totalBatches,
      },
    });
    // A retried completion is a success: stop would make the worker delete the output.
    return this.ack(event.experimentId, applied ?? (await this.experiments.completedWith(event.experimentId, event.sequence)));
  }

  async failure(event: FailureEvent): Promise<Ack> {
    const code = event.errorCode.replace('JOB_ERROR_CODE_', '');
    const row = await this.experiments.applyFailure(event.experimentId, event.sequence, {
      status: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
      errorCode: code,
      errorMessage: event.errorMessage,
    });
    return this.ack(event.experimentId, row);
  }

  private async ack(id: string, row: ExperimentRow | undefined): Promise<Ack> {
    if (row) {
      this.gateway.experimentUpdated(toExperiment(row));
      return { applied: true, stop: false };
    }
    return { applied: false, stop: await this.experiments.isGoneOrFinished(id) };
  }
}

/** gRPC JobEventsService: the experiment half (proto/ai/v1/job_events.proto). */
@Controller()
export class ExperimentEventsController {
  constructor(private readonly handler: ExperimentEventsHandler) {}

  @GrpcMethod('JobEventsService', 'ReportExperimentProgress')
  reportProgress(event: ProgressEvent): Promise<Ack> {
    return this.handler.progress(event);
  }

  @GrpcMethod('JobEventsService', 'ReportExperimentCompletion')
  reportCompletion(event: CompletionEvent): Promise<Ack> {
    return this.handler.completion(event);
  }

  @GrpcMethod('JobEventsService', 'ReportExperimentFailure')
  reportFailure(event: FailureEvent): Promise<Ack> {
    return this.handler.failure(event);
  }
}
