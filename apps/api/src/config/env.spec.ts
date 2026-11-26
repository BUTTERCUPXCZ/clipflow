import { homedir } from 'node:os';
import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://u:p@host:5432/db', MEDIA_ROOT: '/srv/media' };

describe('validateEnv', () => {
  it('applies defaults and coerces the port', () => {
    const env = validateEnv({ ...base, API_PORT: '4000' });

    expect(env).toEqual({
      ...base,
      API_PORT: 4000,
      AI_GRPC_URL: 'localhost:50051',
      JOB_EVENTS_GRPC_URL: 'localhost:50052',
      FRAME_SAMPLE_INTERVAL: 1,
      FRAME_MAX_WIDTH: 768,
      VISION_MAX_FRAMES: 60,
      VISION_BATCH_SIZE: 2,
    });
  });

  it('expands ~ in MEDIA_ROOT to the home directory', () => {
    expect(validateEnv({ ...base, MEDIA_ROOT: '~/clips' }).MEDIA_ROOT).toBe(`${homedir()}/clips`);
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    expect(() => validateEnv({ MEDIA_ROOT: '/m' })).toThrow(/DATABASE_URL is required/);
  });

  it('fails fast when MEDIA_ROOT is missing', () => {
    expect(() => validateEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/MEDIA_ROOT is required/);
  });

  it('only lets the job-events server listen on loopback', () => {
    expect(validateEnv({ ...base, JOB_EVENTS_GRPC_URL: '127.0.0.1:6000' }).JOB_EVENTS_GRPC_URL).toBe('127.0.0.1:6000');
    expect(() => validateEnv({ ...base, JOB_EVENTS_GRPC_URL: '0.0.0.0:50052' })).toThrow(/localhost/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/must start with postgres/);
  });
});
