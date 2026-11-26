import { Injectable } from '@nestjs/common';
import { AiServiceClient, type ModelStatus } from '../../../infrastructure/grpc/ai-service.client.js';
import { type Check, error, errorMessage, type HealthIndicator, ok } from '../health-indicator.js';

/** Reports the AI service itself plus the model runtime and vision model it sees. */
@Injectable()
export class AiServiceHealthIndicator implements HealthIndicator {
  constructor(private readonly ai: AiServiceClient) {}

  async check(): Promise<Record<string, Check>> {
    let status: ModelStatus;
    try {
      status = await this.ai.getModelStatus();
    } catch (e) {
      const unknown = error('unknown: AI service unreachable');
      return {
        ai_service: error(`unreachable: ${errorMessage(e)}`),
        model_runtime: unknown,
        vision_model: unknown,
        worker: unknown,
      };
    }

    return {
      ai_service: ok('connected'),
      model_runtime: status.runtimeReachable
        ? ok(`Ollama reachable, ${status.installedModels.length} models installed`)
        : error('Ollama unreachable'),
      vision_model: visionModelCheck(status),
      worker: status.workerRunning
        ? ok('processing worker running')
        : error('no processing worker is running: start it with npm run dev:ai'),
    };
  }
}

function visionModelCheck(status: ModelStatus): Check {
  const model = status.configuredVisionModel;
  if (!status.runtimeReachable) return error(`unknown: Ollama unreachable (${model})`);
  if (!status.configuredVisionModelInstalled) return error(`${model} is not installed (ollama pull ${model})`);
  return ok(model);
}
