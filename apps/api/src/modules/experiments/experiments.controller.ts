import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.js';
import { uuidParam } from '../../common/schemas.js';
import { type CreateExperiment, createExperimentSchema } from './experiments.schemas.js';
import { ExperimentsService } from './experiments.service.js';

@Controller()
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get('experiments/models')
  models() {
    return this.experiments.models();
  }

  /** 202: queued; follow it over the WebSocket (experiment.updated) or GET /experiments/:id. */
  @Post('experiments')
  @HttpCode(202)
  create(@CurrentUser() userId: string, @Body({ schema: createExperimentSchema }) body: CreateExperiment) {
    return this.experiments.create(userId, body);
  }

  @Get('videos/:id/experiments')
  list(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) videoId: string) {
    return this.experiments.listForVideo(userId, videoId);
  }

  @Get('experiments/:id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.experiments.get(userId, id);
  }

  @Post('experiments/:id/cancel')
  @HttpCode(202)
  cancel(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.experiments.cancel(userId, id);
  }
}
