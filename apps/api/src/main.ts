import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { DESKTOP_ORIGINS, type Env } from './config/env.js';
import { GRPC_LOADER_OPTIONS, JOB_EVENTS_PROTO_PATH } from './infrastructure/grpc/grpc.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  // Validates every @Body/@Param/@Query that declares a { schema } (zod) — 400 on failure.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableCors({ origin: DESKTOP_ORIGINS });
  app.enableShutdownHooks();
  // Job progress to the desktop: ws://localhost:<API_PORT>/ws (EventsGateway checks the Origin).
  app.useWebSocketAdapter(new WsAdapter(app));

  const config = app.get(ConfigService<Env, true>);
  // The Python worker reports job events here (proto/ai/v1/job_events.proto).
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'ai.v1',
      protoPath: JOB_EVENTS_PROTO_PATH,
      url: config.get('JOB_EVENTS_GRPC_URL', { infer: true }),
      loader: GRPC_LOADER_OPTIONS,
    },
  });
  await app.startAllMicroservices();

  // Local-first: never listen on external interfaces.
  await app.listen(config.get('API_PORT', { infer: true }), '127.0.0.1');
}
await bootstrap();
