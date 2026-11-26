import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { Env } from '../../config/env.js';
import { AI_SERVICE_GRPC, AiServiceClient } from './ai-service.client.js';

/** Injection tokens for the narrow interfaces AiServiceClient implements (MediaProbe, AnalysisRunner). */
export const MEDIA_PROBE = Symbol('MEDIA_PROBE');
export const ANALYSIS_RUNNER = Symbol('ANALYSIS_RUNNER');

/** Single source of truth shared with the Python service. Same depth from src/ and dist/. */
const PROTO_DIR = resolve(import.meta.dirname, '../../../../../proto/ai/v1');
const PROTO_PATH = resolve(PROTO_DIR, 'video_analysis.proto');
/** Served by NestJS itself (main.ts) for the Python worker. */
export const JOB_EVENTS_PROTO_PATH = resolve(PROTO_DIR, 'job_events.proto');
export const GRPC_LOADER_OPTIONS = { keepCase: false, longs: Number, enums: String, defaults: true, arrays: true };

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: AI_SERVICE_GRPC,
        inject: [ConfigService],
        useFactory: (config: ConfigService<Env, true>) => ({
          transport: Transport.GRPC,
          options: {
            package: 'ai.v1',
            protoPath: PROTO_PATH,
            url: config.get('AI_GRPC_URL', { infer: true }),
            // defaults: proto3 omits false/0/empty fields on the wire; restore them.
            loader: GRPC_LOADER_OPTIONS,
          },
        }),
      },
    ]),
  ],
  providers: [
    AiServiceClient,
    { provide: MEDIA_PROBE, useExisting: AiServiceClient },
    { provide: ANALYSIS_RUNNER, useExisting: AiServiceClient },
  ],
  exports: [AiServiceClient, MEDIA_PROBE, ANALYSIS_RUNNER],
})
export class GrpcModule {}
