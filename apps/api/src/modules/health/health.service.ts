import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infrastructure/database/database.module.js';
import { AiServiceClient, type ModelStatus } from '../../infrastructure/grpc/ai-service.client.js';

export interface Check {
  status: 'ok' | 'error';
  detail: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  checks: {
    database: Check;
    ai_service: Check;
    model_runtime: Check;
    vision_model: Check;
  };
}

const ok = (detail: string): Check => ({ status: 'ok', detail });
const error = (detail: string): Check => ({ status: 'error', detail });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly ai: AiServiceClient,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, aiChecks] = await Promise.all([this.checkDatabase(), this.checkAi()]);
    const checks = { database, ...aiChecks };
    const healthy = Object.values(checks).every((c) => c.status === 'ok');
    return { status: healthy ? 'ok' : 'error', checks };
  }

  private async checkDatabase(): Promise<Check> {
    try {
      await this.pool.query('SELECT 1');
      return ok('connected');
    } catch (e) {
      return error(`unreachable: ${message(e)}`);
    }
  }

  private async checkAi(): Promise<Omit<HealthReport['checks'], 'database'>> {
    let status;
    try {
      status = await this.ai.getModelStatus();
    } catch (e) {
      const unknown = error('unknown: AI service unreachable');
      return {
        ai_service: error(`unreachable: ${message(e)}`),
        model_runtime: unknown,
        vision_model: unknown,
      };
    }

    return {
      ai_service: ok('connected'),
      model_runtime: status.runtimeReachable
        ? ok(`Ollama reachable, ${status.installedModels.length} models installed`)
        : error('Ollama unreachable'),
      vision_model: visionModelCheck(status),
    };
  }
}

function visionModelCheck(status: ModelStatus): Check {
  const model = status.configuredVisionModel;
  if (!status.runtimeReachable) return error(`unknown: Ollama unreachable (${model})`);
  if (!status.configuredVisionModelInstalled) return error(`${model} is not installed (ollama pull ${model})`);
  return ok(model);
}
