import { resolve } from 'node:path';
import { z } from 'zod';

/** Monorepo root .env, shared by every app. Same depth from src/config and dist/config. */
export const ROOT_ENV_FILE = resolve(import.meta.dirname, '../../../../.env');

/** Origins the Tauri webview uses: Vite dev server, Linux/macOS, Windows. */
export const DESKTOP_ORIGINS = [
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
];

const envSchema = z.object({
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (PostgreSQL connection string)' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
  AI_GRPC_URL: z.string().min(1).default('localhost:50051'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment (check ${ROOT_ENV_FILE}):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
