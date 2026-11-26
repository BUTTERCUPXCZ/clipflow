import type { Pool } from 'pg';
import type { AiServiceClient, ModelStatus } from '../../../infrastructure/grpc/ai-service.client.js';
import { AiServiceHealthIndicator } from './ai-service.indicator.js';
import { DatabaseHealthIndicator } from './database.indicator.js';

const MODEL = 'qwen3-vl:8b-instruct';

const modelStatus = (overrides: Partial<ModelStatus> = {}): ModelStatus => ({
  runtimeReachable: true,
  installedModels: [{ name: MODEL, sizeBytes: 1, vision: true }],
  configuredVisionModel: MODEL,
  configuredVisionModelInstalled: true,
  errorCode: 'ERROR_CODE_UNSPECIFIED',
  workerRunning: true,
  ...overrides,
});

const aiIndicator = (getModelStatus: () => Promise<ModelStatus>) =>
  new AiServiceHealthIndicator({ getModelStatus: vi.fn(getModelStatus) } as unknown as AiServiceClient);

describe('DatabaseHealthIndicator', () => {
  it('reports connected when SELECT 1 succeeds', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;

    expect(await new DatabaseHealthIndicator(pool).check()).toEqual({ database: { status: 'ok', detail: 'connected' } });
  });

  it('reports the failure without throwing', async () => {
    const pool = { query: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) } as unknown as Pool;

    expect(await new DatabaseHealthIndicator(pool).check()).toEqual({
      database: { status: 'error', detail: 'unreachable: ECONNREFUSED' },
    });
  });
});

describe('AiServiceHealthIndicator', () => {
  it('reports ok when the AI service, Ollama and the model are all fine', async () => {
    const checks = await aiIndicator(async () => modelStatus()).check();

    expect(checks.ai_service.status).toBe('ok');
    expect(checks.vision_model).toEqual({ status: 'ok', detail: MODEL });
  });

  it('marks model checks unknown when the AI service is unreachable', async () => {
    const checks = await aiIndicator(() => Promise.reject(new Error('14 UNAVAILABLE: No connection established'))).check();

    expect(checks.ai_service.detail).toContain('UNAVAILABLE');
    expect(checks.model_runtime.detail).toContain('unknown');
    expect(checks.vision_model.detail).toContain('unknown');
  });

  it('reports Ollama down when the AI service is up but the runtime is not', async () => {
    const checks = await aiIndicator(async () =>
      modelStatus({
        runtimeReachable: false,
        installedModels: [],
        configuredVisionModelInstalled: false,
        errorCode: 'ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE',
      }),
    ).check();

    expect(checks.ai_service.status).toBe('ok');
    expect(checks.model_runtime).toEqual({ status: 'error', detail: 'Ollama unreachable' });
    expect(checks.vision_model.status).toBe('error');
  });

  it('tells the user how to install a missing vision model', async () => {
    const checks = await aiIndicator(async () => modelStatus({ configuredVisionModelInstalled: false })).check();

    expect(checks.vision_model.detail).toContain(`ollama pull ${MODEL}`);
  });
});
