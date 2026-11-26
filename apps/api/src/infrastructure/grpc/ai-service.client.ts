import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable, timeout } from 'rxjs';

export const AI_SERVICE_GRPC = Symbol('AI_SERVICE_GRPC');

/** Mirrors ai.v1 messages as decoded by proto-loader (camelCase, enums as strings, defaults on). */
export interface ModelInfo {
  name: string;
  sizeBytes: number;
}

export interface ModelStatus {
  runtimeReachable: boolean;
  installedModels: ModelInfo[];
  configuredVisionModel: string;
  configuredVisionModelInstalled: boolean;
  errorCode: 'ERROR_CODE_UNSPECIFIED' | 'ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE';
}

interface VideoAnalysisServiceGrpc {
  getModelStatus(request: Record<string, never>): Observable<ModelStatus>;
}

const DEADLINE_MS = 3000;

@Injectable()
export class AiServiceClient implements OnModuleInit {
  private service!: VideoAnalysisServiceGrpc;

  constructor(@Inject(AI_SERVICE_GRPC) private readonly client: ClientGrpc) {}

  onModuleInit(): void {
    this.service = this.client.getService<VideoAnalysisServiceGrpc>('VideoAnalysisService');
  }

  getModelStatus(): Promise<ModelStatus> {
    return firstValueFrom(this.service.getModelStatus({}).pipe(timeout(DEADLINE_MS)));
  }
}
