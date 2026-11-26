import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { Env } from '../../config/env.js';
import { AI_SERVICE_GRPC, AiServiceClient } from './ai-service.client.js';

/** Single source of truth shared with the Python service. Same depth from src/ and dist/. */
const PROTO_PATH = resolve(import.meta.dirname, '../../../../../proto/ai/v1/video_analysis.proto');

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
            loader: { keepCase: false, longs: Number, enums: String, defaults: true, arrays: true },
          },
        }),
      },
    ]),
  ],
  providers: [AiServiceClient],
  exports: [AiServiceClient],
})
export class GrpcModule {}
