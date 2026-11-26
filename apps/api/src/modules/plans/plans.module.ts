import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { ClipsRepository } from './clips.repository.js';
import { ClipsService } from './clips.service.js';
import { PlanEventsController, PlanEventsHandler } from './plan-events.js';
import { PlansController } from './plans.controller.js';
import { PlansReconciler } from './plans.reconciler.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';

@Module({
  imports: [JobsModule, VideosModule, GrpcModule],
  controllers: [PlansController, PlanEventsController],
  providers: [PlansRepository, ClipsRepository, PlansService, ClipsService, PlanEventsHandler, PlansReconciler],
  exports: [PlansRepository, ClipsRepository],
})
export class PlansModule {}
