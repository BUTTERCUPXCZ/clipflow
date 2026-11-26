import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable, timeout } from 'rxjs';

export const AI_SERVICE_GRPC = Symbol('AI_SERVICE_GRPC');

/** Mirrors ai.v1 messages as decoded by proto-loader (camelCase, enums as strings, defaults on). */
export interface ModelInfo {
  name: string;
  sizeBytes: number;
  vision: boolean;
}

export interface ModelStatus {
  runtimeReachable: boolean;
  installedModels: ModelInfo[];
  configuredVisionModel: string;
  configuredVisionModelInstalled: boolean;
  errorCode: 'ERROR_CODE_UNSPECIFIED' | 'ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE';
  workerRunning: boolean;
}

type ErrorCode =
  | 'ERROR_CODE_UNSPECIFIED'
  | 'ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE'
  | 'ERROR_CODE_MEDIA_UNDECODABLE'
  | 'ERROR_CODE_INVALID_PATH'
  | 'ERROR_CODE_QUEUE_UNAVAILABLE';

export interface ProbeResult {
  decodable: boolean;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
  container: string;
  errorCode: ErrorCode;
  errorMessage: string;
}

export interface StartAnalysisRequest {
  jobId: string;
  storagePath: string;
  artifactsPath: string;
  settings: { frameIntervalSeconds: number; frameMaxWidth: number };
}

export interface StartAnalysisResult {
  accepted: boolean;
  errorCode: ErrorCode;
  errorMessage: string;
}

export type AnalysisState = 'QUEUED' | 'RUNNING' | 'FINISHED' | 'UNKNOWN';

export interface StartExperimentRequest {
  experimentId: string;
  framesPath: string;
  outputPath: string;
  model: string;
  maxFrames: number;
  batchSize: number;
}

interface VideoAnalysisServiceGrpc {
  getModelStatus(request: Record<string, never>): Observable<ModelStatus>;
  probeVideo(request: { storagePath: string }): Observable<ProbeResult>;
  startAnalysis(request: StartAnalysisRequest): Observable<StartAnalysisResult>;
  cancelAnalysis(request: { jobId: string }): Observable<{ found: boolean }>;
  getAnalysisStatus(request: { jobId: string }): Observable<{ state: `ANALYSIS_STATE_${AnalysisState}` }>;
  startExperiment(request: StartExperimentRequest): Observable<StartAnalysisResult>;
}

const DEADLINE_MS = 3000;
// ffprobe itself is bounded at 30 s in the AI service.
const PROBE_DEADLINE_MS = 35_000;

/** Only what video import needs (interface segregation): tests fake this, not the whole client. */
export interface MediaProbe {
  probeVideo(storagePath: string): Promise<ProbeResult>;
}

/** Only what processing jobs need from the AI service. */
export interface AnalysisRunner {
  startAnalysis(request: StartAnalysisRequest): Promise<StartAnalysisResult>;
  cancelAnalysis(jobId: string): Promise<boolean>;
  getAnalysisStatus(jobId: string): Promise<AnalysisState>;
  startExperiment(request: StartExperimentRequest): Promise<StartAnalysisResult>;
  getModelStatus(): Promise<ModelStatus>;
}

@Injectable()
export class AiServiceClient implements OnModuleInit, MediaProbe, AnalysisRunner {
  private service!: VideoAnalysisServiceGrpc;

  constructor(@Inject(AI_SERVICE_GRPC) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.service = this.client.getService<VideoAnalysisServiceGrpc>('VideoAnalysisService');
  }

  getModelStatus(): Promise<ModelStatus> {
    return firstValueFrom(this.service.getModelStatus({}).pipe(timeout(DEADLINE_MS)));
  }

  probeVideo(storagePath: string): Promise<ProbeResult> {
    return firstValueFrom(this.service.probeVideo({ storagePath }).pipe(timeout(PROBE_DEADLINE_MS)));
  }

  startAnalysis(request: StartAnalysisRequest): Promise<StartAnalysisResult> {
    return firstValueFrom(this.service.startAnalysis(request).pipe(timeout(DEADLINE_MS)));
  }

  async cancelAnalysis(jobId: string): Promise<boolean> {
    return (await firstValueFrom(this.service.cancelAnalysis({ jobId }).pipe(timeout(DEADLINE_MS)))).found;
  }

  startExperiment(request: StartExperimentRequest): Promise<StartAnalysisResult> {
    return firstValueFrom(this.service.startExperiment(request).pipe(timeout(DEADLINE_MS)));
  }

  async getAnalysisStatus(jobId: string): Promise<AnalysisState> {
    const { state } = await firstValueFrom(this.service.getAnalysisStatus({ jobId }).pipe(timeout(DEADLINE_MS)));
    return state.replace('ANALYSIS_STATE_', '') as AnalysisState;
  }
}
