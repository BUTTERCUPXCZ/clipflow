import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { DESKTOP_ORIGINS, type Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: DESKTOP_ORIGINS });
  app.enableShutdownHooks();

  const port = app.get(ConfigService<Env, true>).get('API_PORT', { infer: true });
  // Local-first: never listen on external interfaces.
  await app.listen(port, '127.0.0.1');
}
await bootstrap();
