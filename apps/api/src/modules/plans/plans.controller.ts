import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.js';
import { uuidParam } from '../../common/schemas.js';
import { ClipsService } from './clips.service.js';
import { type AdjustClip, adjustClipSchema, type CreatePlan, createPlanSchema } from './plans.schemas.js';
import { PlansService } from './plans.service.js';

@Controller()
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly clips: ClipsService,
  ) {}

  /** 202: queued; follow it over the WebSocket (plan.updated) or GET /plans/:id. */
  @Post('videos/:id/plans')
  @HttpCode(202)
  create(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) videoId: string,
    @Body({ schema: createPlanSchema }) body: CreatePlan,
  ) {
    return this.plans.create(userId, videoId, body);
  }

  @Get('videos/:id/plans')
  list(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) videoId: string) {
    return this.plans.listForVideo(userId, videoId);
  }

  @Get('plans/:id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.plans.get(userId, id);
  }

  @Post('plans/:id/cancel')
  @HttpCode(202)
  cancel(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.plans.cancel(userId, id);
  }

  @Patch('plans/:id/clips/:clipId')
  adjust(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) planId: string,
    @Param('clipId', { schema: uuidParam }) clipId: string,
    @Body({ schema: adjustClipSchema }) body: AdjustClip,
  ) {
    return this.clips.adjust(userId, planId, clipId, body);
  }

  @Delete('plans/:id/clips/:clipId')
  @HttpCode(204)
  async remove(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) planId: string,
    @Param('clipId', { schema: uuidParam }) clipId: string,
  ): Promise<void> {
    await this.clips.remove(userId, planId, clipId);
  }

  @Get('plans/:id/clips/:clipId/subtitles')
  subtitles(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) planId: string,
    @Param('clipId', { schema: uuidParam }) clipId: string,
  ) {
    return this.clips.subtitles(userId, planId, clipId);
  }
}
