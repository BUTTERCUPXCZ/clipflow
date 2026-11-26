import type { VisualAnalysis } from "@/features/analysis/api";
import { type ApiClient, api } from "@/lib/api";

export type ExperimentStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ExperimentMetrics {
  loadMs: number;
  inferenceMs: number;
  totalMs: number;
  peakVramMiB: number | null;
  framesAnalysed: number;
  validBatches: number;
  totalBatches: number;
}

/** Mirrors Experiment in apps/api/src/modules/experiments/experiments.repository.ts. */
export interface Experiment {
  id: string;
  sourceVideoId: string;
  processingJobId: string;
  modelName: string;
  promptVersion: string;
  settings: { maxFrames: number; batchSize: number };
  status: ExperimentStatus;
  progress: number;
  output: VisualAnalysis | null;
  metrics: ExperimentMetrics | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisionModel {
  name: string;
  sizeBytes: number;
  isDefault: boolean;
}

export const isRunning = (e: Pick<Experiment, "status">) => e.status === "PENDING" || e.status === "RUNNING";

/** Seconds of inference per analysed frame: the number that decides if a model is usable here. */
export const secondsPerFrame = (m: ExperimentMetrics) => (m.framesAnalysed ? m.inferenceMs / 1000 / m.framesAnalysed : 0);

export class ExperimentsApi {
  constructor(private readonly client: ApiClient) {}

  models(): Promise<VisionModel[]> {
    return this.client.getJson("/experiments/models");
  }

  listForVideo(videoId: string): Promise<Experiment[]> {
    return this.client.getJson(`/videos/${videoId}/experiments`);
  }

  run(input: { videoId: string; model: string; batchSize?: number; maxFrames?: number }): Promise<Experiment> {
    return this.client.sendJson("POST", "/experiments", input);
  }

  cancel(id: string): Promise<Experiment> {
    return this.client.sendJson("POST", `/experiments/${id}/cancel`);
  }
}

export const experimentsApi = new ExperimentsApi(api);
