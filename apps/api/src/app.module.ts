import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ROOT_ENV_FILE, validateEnv } from './config/env.js';
import { loggerParams } from './config/logging.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ROOT_ENV_FILE, validate: validateEnv }),
    LoggerModule.forRoot(loggerParams),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
