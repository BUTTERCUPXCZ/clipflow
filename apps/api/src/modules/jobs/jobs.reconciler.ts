import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { EventsGateway } from './events.gateway.js';
import { JobsRepository, toJob } from './jobs.repository.js';

export const STALE_AFTER_SECONDS = 30;
export const INTERRUPTED_MESSAGE = 'Processing interrupted. Process the video again';

/**
 * Guarantees no job stays "running" forever (system-design §13.3): every 30 s, jobs that have not moved for
 * 30 s are checked with the AI service. If its queue no longer knows the job, or finished it without a final
 * event reaching us, the job is failed as interrupted. If the AI service is unreachable, nothing changes and
 * the next pass tries again.
 */
@Injectable()
export class JobsReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsReconciler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly jobs: JobsRepository,
    @Inject(ANALYSIS_RUNNER) private readonly runner: AnalysisRunner,
    private readonly gateway: EventsGateway,
  ) {}

  onApplicationBootstrap(): void {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), STALE_AFTER_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async reconcile(): Promise<number> {
    let failed = 0;
    try {
      for (const job of await this.jobs.findStale(STALE_AFTER_SECONDS)) {
        const state = await this.runner.getAnalysisStatus(job.id);
        if (state !== 'UNKNOWN' && state !== 'FINISHED') continue; // queued or running: leave it alone
        const row = await this.jobs.finish(job.id, {
          status: 'FAILED',
          errorCode: 'INTERRUPTED',
          errorMessage: INTERRUPTED_MESSAGE,
        });
        if (row) {
          this.gateway.jobUpdated(toJob(row));
          failed += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`job reconciliation skipped (AI service unavailable?): ${String(error)}`);
    }
    if (failed) this.logger.warn(`marked ${failed} interrupted job(s) as failed`);
    return failed;
  }
}
