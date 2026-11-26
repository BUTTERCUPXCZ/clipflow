import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { INTERRUPTED_MESSAGE, STALE_AFTER_SECONDS } from '../jobs/jobs.reconciler.js';
import { ExperimentsRepository, toExperiment } from './experiments.repository.js';

/** Same rule as JobsReconciler, for experiments: nothing stays "running" after its worker is gone. */
@Injectable()
export class ExperimentsReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExperimentsReconciler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly experiments: ExperimentsRepository,
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
      for (const experiment of await this.experiments.findStale(STALE_AFTER_SECONDS)) {
        const state = await this.runner.getAnalysisStatus(experiment.id);
        if (state !== 'UNKNOWN' && state !== 'FINISHED') continue;
        const row = await this.experiments.finish(experiment.id, {
          status: 'FAILED',
          errorCode: 'INTERRUPTED',
          errorMessage: INTERRUPTED_MESSAGE,
        });
        if (row) {
          this.gateway.experimentUpdated(toExperiment(row));
          failed += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`experiment reconciliation skipped (AI service unavailable?): ${String(error)}`);
    }
    return failed;
  }
}
