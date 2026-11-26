import { Inject, Injectable } from '@nestjs/common';
import { type Check, HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';

export interface HealthReport {
  status: 'ok' | 'error';
  checks: Record<string, Check>;
}

/** Runs every registered indicator concurrently. Add a dependency by registering a new HealthIndicator. */
@Injectable()
export class HealthService {
  constructor(@Inject(HEALTH_INDICATORS) private readonly indicators: HealthIndicator[]) {}

  async check(): Promise<HealthReport> {
    const results = await Promise.all(this.indicators.map((indicator) => indicator.check()));
    const checks: Record<string, Check> = {};
    for (const [name, check] of results.flatMap((result) => Object.entries(result))) {
      // Two indicators claiming one name would silently hide a failure.
      if (name in checks) throw new Error(`duplicate health check name: ${name}`);
      checks[name] = check;
    }
    const healthy = Object.values(checks).every((c) => c.status === 'ok');
    return { status: healthy ? 'ok' : 'error', checks };
  }
}
