import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { INTERRUPTED_MESSAGE, STALE_AFTER_SECONDS } from '../jobs/jobs.reconciler.js';
import { PlansRepository, toPlan } from './plans.repository.js';

/** Same rule as JobsReconciler, for plans: nothing stays "running" after its worker is gone. */
@Injectable()
export class PlansReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PlansReconciler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly plans: PlansRepository,
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
      for (const plan of await this.plans.findStale(STALE_AFTER_SECONDS)) {
        const state = await this.runner.getAnalysisStatus(plan.id);
        if (state !== 'UNKNOWN' && state !== 'FINISHED') continue;
        const row = await this.plans.finish(plan.id, { status: 'FAILED', errorCode: 'INTERRUPTED', errorMessage: INTERRUPTED_MESSAGE });
        if (row) {
          this.gateway.planUpdated(toPlan(row));
          failed += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`plan reconciliation skipped (AI service unavailable?): ${String(error)}`);
    }
    return failed;
  }
}
