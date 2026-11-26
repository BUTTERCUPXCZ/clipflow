import { type ApiClient, api } from "@/lib/api";

export type VideoStatus = "IMPORTING" | "READY" | "FAILED";

/** Mirrors Video in apps/api/src/modules/videos/videos.repository.ts (dates arrive as ISO strings). */
export interface Video {
  id: string;
  projectId: string;
  filename: string;
  fileSize: number;
  bytesCopied: number;
  mimeType: string;
  status: VideoStatus;
  errorMessage: string | null;
  /** duration/width/height/frameRate are filled by FFprobe in Phase 3 */
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  createdAt: string;
  updatedAt: string;
}

export class VideosApi {
  constructor(private readonly client: ApiClient) {}

  list(projectId: string): Promise<Video[]> {
    return this.client.getJson(`/projects/${projectId}/videos`);
  }

  /** Starts a background import (HTTP 202); the returned video is IMPORTING. */
  import(projectId: string, path: string): Promise<Video> {
    return this.client.sendJson("POST", `/projects/${projectId}/videos/import`, { path });
  }

  remove(id: string): Promise<void> {
    return this.client.sendJson("DELETE", `/videos/${id}`);
  }
}

export const videosApi = new VideosApi(api);
