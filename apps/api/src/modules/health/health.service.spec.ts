import { HealthController } from './health.controller.js';
import { error, type HealthIndicator, ok } from './health-indicator.js';
import { HealthService } from './health.service.js';

const indicator = (result: Awaited<ReturnType<HealthIndicator['check']>>): HealthIndicator => ({
  check: vi.fn(async () => result),
});

describe('HealthService', () => {
  it('merges the results of every registered indicator', async () => {
    const service = new HealthService([indicator({ a: ok('1') }), indicator({ b: ok('2'), c: ok('3') })]);

    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(Object.keys(report.checks)).toEqual(['a', 'b', 'c']);
  });

  it('refuses two indicators reporting the same name', async () => {
    const service = new HealthService([indicator({ a: ok('1') }), indicator({ a: error('hidden') })]);

    await expect(service.check()).rejects.toThrow('duplicate health check name: a');
  });

  it('is unhealthy when any indicator reports an error', async () => {
    const service = new HealthService([indicator({ a: ok('1') }), indicator({ b: error('down') })]);

    expect((await service.check()).status).toBe('error');
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
