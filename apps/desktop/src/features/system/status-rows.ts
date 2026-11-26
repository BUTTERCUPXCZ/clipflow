import { ApiUnreachableError } from "@/lib/api";
import type { Check, HealthReport } from "./api";

export interface StatusRow {
  label: string;
  /** undefined while the first check is still running */
  check: Check | undefined;
}

type CheckKey = keyof HealthReport["checks"];

const LABELS: Record<CheckKey, string> = {
  database: "PostgreSQL",
  ai_service: "AI service (gRPC)",
  model_runtime: "Ollama runtime",
  vision_model: "Vision model",
  worker: "Processing worker",
};

/** The slice of a TanStack query result these rows depend on. */
export interface HealthQueryState {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data: HealthReport | undefined;
}

const error = (detail: string): Check => ({ status: "error", detail });

/** Pure mapping from query state to the rows the status card shows: the API itself first, then each dependency. */
export function toStatusRows(health: HealthQueryState, apiUrl: string): StatusRow[] {
  const unreachable = health.error instanceof ApiUnreachableError;

  let apiCheck: Check | undefined;
  if (health.isError) {
    apiCheck = error(
      unreachable ? `API unreachable at ${apiUrl}. Is it running? (npm run dev:api)` : (health.error?.message ?? ""),
    );
  } else if (!health.isPending) {
    apiCheck = { status: "ok", detail: apiUrl };
  }

  // On error, ignore `data`: TanStack keeps the last successful report after a failed refetch.
  const dependencyCheck = (key: CheckKey): Check | undefined =>
    health.isError
      ? error(unreachable ? "unknown: API unreachable" : "unknown: health check failed")
      : health.data?.checks[key];

  return [
    { label: "NestJS API", check: apiCheck },
    ...(Object.keys(LABELS) as CheckKey[]).map((key) => ({ label: LABELS[key], check: dependencyCheck(key) })),
  ];
}
