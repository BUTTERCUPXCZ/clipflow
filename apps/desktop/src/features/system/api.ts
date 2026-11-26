import { api } from "@/lib/api";

export interface Check {
  status: "ok" | "error";
  detail: string;
}

/** Mirrors HealthReport in apps/api/src/modules/health/health.service.ts. */
export interface HealthReport {
  status: "ok" | "error";
  checks: {
    database: Check;
    ai_service: Check;
    model_runtime: Check;
    vision_model: Check;
  };
}

export async function fetchHealth(): Promise<HealthReport> {
  const res = await api.request("/health");
  // 503 means "API is up, a dependency is down": its body is still a report.
  if (res.status !== 200 && res.status !== 503) {
    throw new Error(`Unexpected health response: HTTP ${res.status}`);
  }
  return res.json();
}
