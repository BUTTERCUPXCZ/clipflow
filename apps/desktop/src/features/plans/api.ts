import { type ApiClient, api } from "@/lib/api";

export type PlanStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface PlanSettings {
  minSeconds: number;
  maxSeconds: number;
  maxClips: number;
}

/** Mirrors Plan in apps/api/src/modules/plans/plans.repository.ts. */
export interface Plan {
  id: string;
  sourceVideoId: string;
  processingJobId: string;
  modelName: string;
  language: string | null;
  durationSeconds: number;
  settings: PlanSettings;
  status: PlanStatus;
  progress: number;
  metrics: { llmCalls: number; elapsedMs: number; windows: number; skippedWindows: number; clipCount: number } | null;
  skipped: { start: number; end: number; errors: string[]; raw?: string }[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedClip {
  id: string;
  planId: string;
  position: number;
  startSeconds: number;
  endSeconds: number;
  title: string;
  hook: string;
  caption: string;
  reason: string;
  score: number;
  removedAt: string | null;
  /** Words spoken inside the clip, from the plan's own transcript (computed by the API). */
  excerpt: string;
}

export type PlanDetail = Plan & { clips: PlannedClip[] };

export const isPlanRunning = (p: Pick<Plan, "status">) => p.status === "PENDING" || p.status === "RUNNING";

/** Same defaults as the API (plans.schemas.ts): 15–60 s, about one clip per 3 minutes, 1–10. */
export const defaultSettings = (durationSeconds: number): PlanSettings => ({
  minSeconds: 15,
  maxSeconds: 60,
  maxClips: Math.min(10, Math.max(1, Math.round(durationSeconds / 180))),
});

export class PlansApi {
  constructor(private readonly client: ApiClient) {}

  listForVideo(videoId: string): Promise<Plan[]> {
    return this.client.getJson(`/videos/${videoId}/plans`);
  }

  get(id: string): Promise<PlanDetail> {
    return this.client.getJson(`/plans/${id}`);
  }

  create(videoId: string, settings: PlanSettings): Promise<Plan> {
    return this.client.sendJson("POST", `/videos/${videoId}/plans`, settings);
  }

  cancel(id: string): Promise<Plan> {
    return this.client.sendJson("POST", `/plans/${id}/cancel`);
  }

  adjustClip(planId: string, clipId: string, times: { startSeconds: number; endSeconds: number }): Promise<PlannedClip> {
    return this.client.sendJson("PATCH", `/plans/${planId}/clips/${clipId}`, times);
  }

  removeClip(planId: string, clipId: string): Promise<void> {
    return this.client.sendJson("DELETE", `/plans/${planId}/clips/${clipId}`);
  }
}

export const plansApi = new PlansApi(api);
