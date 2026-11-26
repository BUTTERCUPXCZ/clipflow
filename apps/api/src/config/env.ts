import { homedir } from 'node:os';
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
  /** NestJS serves JobEventsService here; the Python worker reports to it. */
  JOB_EVENTS_GRPC_URL: z
    .string()
    // Unauthenticated internal service: loopback only, like the HTTP API.
    .regex(/^(localhost|127\.0\.0\.1):\d{1,5}$/, 'JOB_EVENTS_GRPC_URL must be localhost:<port> or 127.0.0.1:<port>')
    .default('localhost:50052'),
  FRAME_SAMPLE_INTERVAL: z.coerce.number().positive().max(60).default(1),
  FRAME_MAX_WIDTH: z.coerce.number().int().min(64).max(3840).default(768),
  VISION_MAX_FRAMES: z.coerce.number().int().min(1).max(600).default(60),
  VISION_BATCH_SIZE: z.coerce.number().int().min(1).max(8).default(2),
  MEDIA_ROOT: z
    .string({ error: 'MEDIA_ROOT is required (directory for imported and generated media)' })
    .min(1)
    .transform((p) => resolve(p.replace(/^~(?=$|\/)/, homedir()))),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment (check ${ROOT_ENV_FILE}):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
