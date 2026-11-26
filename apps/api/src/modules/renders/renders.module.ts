import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { ExportService } from './export.service.js';
import { RenderEventsController, RenderEventsHandler } from './render-events.js';
import { MediaFilesController, RendersController } from './renders.controller.js';
import { RendersReconciler } from './renders.reconciler.js';
import { RendersRepository } from './renders.repository.js';
import { RendersService } from './renders.service.js';

@Module({
  imports: [JobsModule, PlansModule, VideosModule, GrpcModule],
  controllers: [RendersController, MediaFilesController, RenderEventsController],
  providers: [RendersRepository, RendersService, ExportService, RenderEventsHandler, RendersReconciler],
  exports: [RendersRepository],
})
export class RendersModule {}
