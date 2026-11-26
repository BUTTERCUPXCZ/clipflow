import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { ExperimentEventsController, ExperimentEventsHandler } from './experiment-events.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsReconciler } from './experiments.reconciler.js';
import { ExperimentsRepository } from './experiments.repository.js';
import { ExperimentsService } from './experiments.service.js';

@Module({
  imports: [JobsModule, VideosModule, GrpcModule],
  controllers: [ExperimentsController, ExperimentEventsController],
  providers: [ExperimentsRepository, ExperimentsService, ExperimentEventsHandler, ExperimentsReconciler],
})
export class ExperimentsModule {}
