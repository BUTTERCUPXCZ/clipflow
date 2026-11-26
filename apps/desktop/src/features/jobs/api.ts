import { type ApiClient, api } from "@/lib/api";

export type JobStatus = "PENDING" | "VALIDATING" | "EXTRACTING_MEDIA" | "COMPLETED" | "FAILED" | "CANCELLED";

export const ACTIVE_STATUSES: readonly JobStatus[] = ["PENDING", "VALIDATING", "EXTRACTING_MEDIA"];

export interface JobArtifacts {
  hasAudio: boolean;
  audioPath: string | null;
  audioDurationSeconds: number | null;
  frameCount: number;
  frameIntervalSeconds: number;
  framesPath: string;
}

/** Mirrors Job in apps/api/src/modules/jobs/jobs.repository.ts (dates as ISO strings). */
export interface Job {
  id: string;
  sourceVideoId: string;
  projectId: string;
  status: JobStatus;
  stage: string;
  progress: number;
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  artifacts: JobArtifacts | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FrameInfo {
  index: number;
  file: string;
  timestampSeconds: number;
}

export const isActive = (job: Pick<Job, "status">) => ACTIVE_STATUSES.includes(job.status);

export class JobsApi {
  constructor(private readonly client: ApiClient) {}

  process(videoId: string): Promise<Job> {
    return this.client.sendJson("POST", `/videos/${videoId}/process`);
  }

  listForVideo(videoId: string): Promise<Job[]> {
    return this.client.getJson(`/videos/${videoId}/jobs`);
  }

  cancel(jobId: string): Promise<Job> {
    return this.client.sendJson("POST", `/jobs/${jobId}/cancel`);
  }

  frames(jobId: string): Promise<FrameInfo[]> {
    return this.client.getJson(`/jobs/${jobId}/frames`);
  }

  frameUrl(jobId: string, index: number): string {
    return `${this.client.baseUrl}/jobs/${jobId}/frames/${index}`;
  }
}

export const jobsApi = new JobsApi(api);
