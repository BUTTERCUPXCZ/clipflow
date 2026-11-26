import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { AnalysesRepository } from './analyses.repository.js';
import { EventsGateway } from './events.gateway.js';
import { JobEventsHandler } from './job-events.handler.js';
import { JobEventsController, JobsController } from './jobs.controller.js';
import { JobsReconciler } from './jobs.reconciler.js';
import { JobsRepository } from './jobs.repository.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [VideosModule, GrpcModule],
  controllers: [JobsController, JobEventsController],
  providers: [JobsRepository, AnalysesRepository, JobsService, JobEventsHandler, JobsReconciler, EventsGateway],
  exports: [JobsRepository, AnalysesRepository, EventsGateway],
})
export class JobsModule {}
