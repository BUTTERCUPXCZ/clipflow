import { type ApiClient, api } from "@/lib/api";

export type RenderStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

/** Mirrors Render in apps/api/src/modules/renders/renders.repository.ts. */
export interface Render {
  id: string;
  planId: string;
  sourceVideoId: string;
  settings: { subtitles: boolean };
  status: RenderStatus;
  progress: number;
  clipCount: number;
  metrics: { rendered: number; failed: number; elapsedMs: number; encoder: string } | null;
  failures: { clipId: string; error: string }[] | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderedClip {
  id: string;
  renderId: string;
  plannedClipId: string | null;
  position: number;
  title: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
}

export type RenderDetail = Render & { clips: RenderedClip[] };
export type GalleryClip = RenderedClip & { videoId: string; videoName: string; projectId: string };

export const isRenderRunning = (r: Pick<Render, "status">) => r.status === "PENDING" || r.status === "RUNNING";

export class RendersApi {
  constructor(private readonly client: ApiClient) {}

  create(planId: string, subtitles: boolean): Promise<Render> {
    return this.client.sendJson("POST", `/plans/${planId}/renders`, { subtitles });
  }

  listForPlan(planId: string): Promise<Render[]> {
    return this.client.getJson(`/plans/${planId}/renders`);
  }

  get(id: string): Promise<RenderDetail> {
    return this.client.getJson(`/renders/${id}`);
  }

  cancel(id: string): Promise<Render> {
    return this.client.sendJson("POST", `/renders/${id}/cancel`);
  }

  gallery(): Promise<GalleryClip[]> {
    return this.client.getJson("/rendered-clips");
  }

  exportClip(clipId: string, destination: string): Promise<{ path: string }> {
    return this.client.sendJson("POST", `/rendered-clips/${clipId}/export`, { destination });
  }

  exportAll(renderId: string, directory: string): Promise<{ paths: string[] }> {
    return this.client.sendJson("POST", `/renders/${renderId}/export`, { directory });
  }

  fileUrl(clipId: string): string {
    return `${this.client.baseUrl}/rendered-clips/${clipId}/file`;
  }

  thumbnailUrl(clipId: string): string {
    return `${this.client.baseUrl}/rendered-clips/${clipId}/thumbnail`;
  }

  /** The original video, Range-enabled (preview of planned clips, the video page player). */
  sourceUrl(videoId: string): string {
    return `${this.client.baseUrl}/videos/${videoId}/file`;
  }
}

export const rendersApi = new RendersApi(api);
