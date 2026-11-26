import { type ApiClient, api } from "@/lib/api";

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  language: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
}

export interface Scene {
  timestampSeconds: number;
  description: string;
  subjects: string[];
  actions: string[];
  cameraFraming: string;
  verticalCropSuitable: boolean;
  observations: string[];
}

export interface Batch {
  frameIndexes: number[];
  valid: boolean;
  attempts: number;
  errors: string[];
  raw?: string;
}

/** visual.json, as written by the AI service (shared by processing jobs and experiments). */
export interface VisualAnalysis {
  model: string;
  promptVersion: string;
  frames: { index: number; timestampSeconds: number }[];
  scenes: Scene[];
  batches: Batch[];
  metrics: { loadMs: number; inferenceMs: number; framesAnalysed: number; validBatches: number; totalBatches: number };
}

/** Mirrors GET /videos/:id/analysis (apps/api/src/modules/jobs/jobs.service.ts). */
export interface VideoAnalysis {
  id: string;
  sourceVideoId: string;
  processingJobId: string;
  transcript: Transcript | null;
  visualAnalysis: VisualAnalysis;
  createdAt: string;
}

/** Frame index for a scene's timestamp, to show its thumbnail. */
export function frameIndexAt(visual: VisualAnalysis, timestampSeconds: number): number | undefined {
  return visual.frames.find((f) => f.timestampSeconds === timestampSeconds)?.index;
}

export class AnalysisApi {
  constructor(private readonly client: ApiClient) {}

  forVideo(videoId: string): Promise<VideoAnalysis> {
    return this.client.getJson(`/videos/${videoId}/analysis`);
  }
}

export const analysisApi = new AnalysisApi(api);
