import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applies defaults and coerces the port', () => {
    const env = validateEnv({ DATABASE_URL: 'postgresql://u:p@host:5432/db', API_PORT: '4000' });

    expect(env).toEqual({
      DATABASE_URL: 'postgresql://u:p@host:5432/db',
      API_PORT: 4000,
      AI_GRPC_URL: 'localhost:50051',
    });
  });

  it('fails fast with a readable message when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL is required/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/must start with postgres/);
  });
});
