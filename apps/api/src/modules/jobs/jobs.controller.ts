import { createReadStream } from 'node:fs';
import { Controller, Get, HttpCode, Param, Post, StreamableFile } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { z } from 'zod';
import { CurrentUser } from '../../common/current-user.js';
import { uuidParam } from '../../common/schemas.js';
import {
  type Ack,
  type CompletionEvent,
  type FailureEvent,
  JobEventsHandler,
  type ProgressEvent,
} from './job-events.handler.js';
import { JobsService } from './jobs.service.js';

const frameIndex = z.coerce.number().int().min(0).max(1_000_000);

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** 202: the job is queued; follow it over the WebSocket (job.updated) or GET /jobs/:id. */
  @Post('videos/:id/process')
  @HttpCode(202)
  process(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) videoId: string) {
    return this.jobs.process(userId, videoId);
  }

  @Get('videos/:id/jobs')
  list(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) videoId: string) {
    return this.jobs.listForVideo(userId, videoId);
  }

  @Get('videos/:id/analysis')
  analysis(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) videoId: string) {
    return this.jobs.analysis(userId, videoId);
  }

  @Get('jobs/:id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.jobs.get(userId, id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(202)
  cancel(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.jobs.cancel(userId, id);
  }

  @Get('jobs/:id/frames')
  frames(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.jobs.frames(userId, id);
  }

  @Get('jobs/:id/frames/:index')
  async frame(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Param('index', { schema: frameIndex }) index: number,
  ): Promise<StreamableFile> {
    const path = await this.jobs.framePath(userId, id, index);
    // Frames never change once written, so the desktop may cache them.
    return new StreamableFile(createReadStream(path), { type: 'image/jpeg', disposition: 'inline' });
  }
}

/** gRPC JobEventsService (proto/ai/v1/job_events.proto), called by the Python worker. */
@Controller()
export class JobEventsController {
  constructor(private readonly handler: JobEventsHandler) {}

  @GrpcMethod('JobEventsService', 'ReportProgress')
  reportProgress(event: ProgressEvent): Promise<Ack> {
    return this.handler.progress(event);
  }

  @GrpcMethod('JobEventsService', 'ReportCompletion')
  reportCompletion(event: CompletionEvent): Promise<Ack> {
    return this.handler.completion(event);
  }

  @GrpcMethod('JobEventsService', 'ReportFailure')
  reportFailure(event: FailureEvent): Promise<Ack> {
    return this.handler.failure(event);
  }
}
