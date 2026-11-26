import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ROOT_ENV_FILE, validateEnv } from './config/env.js';
import { loggerParams } from './config/logging.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { VideosModule } from './modules/videos/videos.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ROOT_ENV_FILE, validate: validateEnv }),
    LoggerModule.forRoot(loggerParams),
    DatabaseModule,
    StorageModule,
    HealthModule,
    ProjectsModule,
    VideosModule,
    JobsModule,
  ],
})
export class AppModule {}
