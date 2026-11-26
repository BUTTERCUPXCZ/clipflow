import type { Pool } from 'pg';
import type { AiServiceClient, ModelStatus } from '../../infrastructure/grpc/ai-service.client.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

const MODEL = 'qwen3-vl:8b-instruct';

const modelStatus = (overrides: Partial<ModelStatus> = {}): ModelStatus => ({
  runtimeReachable: true,
  installedModels: [{ name: MODEL, sizeBytes: 1 }],
  configuredVisionModel: MODEL,
  configuredVisionModelInstalled: true,
  errorCode: 'ERROR_CODE_UNSPECIFIED',
  ...overrides,
});

function setup({ db = true, ai }: { db?: boolean; ai: () => Promise<ModelStatus> }) {
  const pool = {
    query: vi.fn(db ? () => Promise.resolve({ rows: [] }) : () => Promise.reject(new Error('ECONNREFUSED'))),
  } as unknown as Pool;
  const aiClient = { getModelStatus: vi.fn(ai) } as unknown as AiServiceClient;
  return new HealthService(pool, aiClient);
}

describe('HealthService', () => {
  it('reports ok when every dependency is healthy', async () => {
    const report = await setup({ ai: async () => modelStatus() }).check();

    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.vision_model).toEqual({ status: 'ok', detail: MODEL });
  });

  it('reports a database failure without throwing', async () => {
    const report = await setup({ db: false, ai: async () => modelStatus() }).check();

    expect(report.status).toBe('error');
    expect(report.checks.database).toEqual({ status: 'error', detail: 'unreachable: ECONNREFUSED' });
    expect(report.checks.ai_service.status).toBe('ok');
  });

  it('marks model checks unknown when the AI service is unreachable', async () => {
    const report = await setup({
      ai: () => Promise.reject(new Error('14 UNAVAILABLE: No connection established')),
    }).check();

    expect(report.status).toBe('error');
    expect(report.checks.ai_service.detail).toContain('UNAVAILABLE');
    expect(report.checks.model_runtime.detail).toContain('unknown');
    expect(report.checks.vision_model.detail).toContain('unknown');
  });

  it('reports Ollama down when the AI service is up but the runtime is not', async () => {
    const report = await setup({
      ai: async () =>
        modelStatus({
          runtimeReachable: false,
          installedModels: [],
          configuredVisionModelInstalled: false,
          errorCode: 'ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE',
        }),
    }).check();

    expect(report.checks.ai_service.status).toBe('ok');
    expect(report.checks.model_runtime).toEqual({ status: 'error', detail: 'Ollama unreachable' });
    expect(report.checks.vision_model.status).toBe('error');
  });

  it('tells the user how to install a missing vision model', async () => {
    const report = await setup({
      ai: async () => modelStatus({ configuredVisionModelInstalled: false }),
    }).check();

    expect(report.checks.vision_model.detail).toContain(`ollama pull ${MODEL}`);
  });
});

describe('HealthController', () => {
  it('responds 503 when unhealthy', async () => {
    const service = { check: vi.fn(async () => ({ status: 'error' })) } as unknown as HealthService;
    const res = { status: vi.fn() };

    await new HealthController(service).get(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('keeps the default 200 when healthy', async () => {
    const service = { check: vi.fn(async () => ({ status: 'ok' })) } as unknown as HealthService;
    const res = { status: vi.fn() };

    await new HealthController(service).get(res as never);

    expect(res.status).not.toHaveBeenCalled();
  });
});
