import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { AnalysisRunner } from '../../infrastructure/grpc/ai-service.client.js';
import { ANALYSIS_RUNNER } from '../../infrastructure/grpc/grpc.module.js';
import { EventsGateway } from '../jobs/events.gateway.js';
import { STALE_AFTER_SECONDS } from '../jobs/jobs.reconciler.js';
import { RendersRepository, toRender } from './renders.repository.js';

const INTERRUPTED_MESSAGE = 'Rendering was interrupted. Render the clips again';

/** Same rule as JobsReconciler, for renders: nothing stays "running" after its worker is gone. */
@Injectable()
export class RendersReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RendersReconciler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly renders: RendersRepository,
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
      for (const render of await this.renders.findStale(STALE_AFTER_SECONDS)) {
        const state = await this.runner.getAnalysisStatus(render.id);
        if (state !== 'UNKNOWN' && state !== 'FINISHED') continue;
        const row = await this.renders.finish(render.id, { status: 'FAILED', errorCode: 'INTERRUPTED', errorMessage: INTERRUPTED_MESSAGE });
        if (row) {
          this.gateway.renderUpdated(toRender(row));
          failed += 1;
        }
      }
    } catch (error) {
      this.logger.warn(`render reconciliation skipped (AI service unavailable?): ${String(error)}`);
    }
    return failed;
  }
}
