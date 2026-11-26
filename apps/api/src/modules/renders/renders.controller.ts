import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser } from '../../common/current-user.js';
import { sendFile } from '../../common/range-file.js';
import { uuidParam } from '../../common/schemas.js';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { VideosRepository } from '../videos/videos.repository.js';
import { ExportService } from './export.service.js';
import { RendersRepository } from './renders.repository.js';
import { RendersService } from './renders.service.js';

const createRenderSchema = z.object({ subtitles: z.boolean().default(true) });
const exportClipSchema = z.object({ destination: z.string().min(1).max(4096) });
const exportRenderSchema = z.object({ directory: z.string().min(1).max(4096) });

@Controller()
export class RendersController {
  constructor(
    private readonly renders: RendersService,
    private readonly exports: ExportService,
  ) {}

  /** 202: queued; follow it over the WebSocket (render.updated) or GET /renders/:id. */
  @Post('plans/:id/renders')
  @HttpCode(202)
  create(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) planId: string,
    @Body({ schema: createRenderSchema }) body: z.infer<typeof createRenderSchema>,
  ) {
    return this.renders.create(userId, planId, body);
  }

  @Get('plans/:id/renders')
  list(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) planId: string) {
    return this.renders.listForPlan(userId, planId);
  }

  @Get('renders/:id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.renders.get(userId, id);
  }

  @Post('renders/:id/cancel')
  @HttpCode(202)
  cancel(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.renders.cancel(userId, id);
  }

  @Get('rendered-clips')
  gallery(@CurrentUser() userId: string) {
    return this.renders.gallery(userId);
  }

  @Post('rendered-clips/:id/export')
  @HttpCode(200)
  exportClip(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Body({ schema: exportClipSchema }) body: z.infer<typeof exportClipSchema>,
  ) {
    return this.exports.exportClip(userId, id, body.destination);
  }

  @Post('renders/:id/export')
  @HttpCode(200)
  exportRender(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Body({ schema: exportRenderSchema }) body: z.infer<typeof exportRenderSchema>,
  ) {
    return this.exports.exportRender(userId, id, body.directory);
  }
}

/** Media files for the desktop players: Range-enabled so seeking works. */
@Controller()
export class MediaFilesController {
  constructor(
    private readonly renders: RendersRepository,
    private readonly videos: VideosRepository,
    private readonly storage: MediaStorage,
  ) {}

  @Get('rendered-clips/:id/file')
  async clipFile(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const clip = await this.renders.findClipOwned(userId, id);
    return sendFile(clip ? this.storage.absolute(clip.filePath) : '', 'video/mp4', range, res);
  }

  @Get('rendered-clips/:id/thumbnail')
  async thumbnail(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string, @Res({ passthrough: true }) res: Response) {
    const clip = await this.renders.findClipOwned(userId, id);
    return sendFile(clip ? this.storage.absolute(clip.thumbnailPath) : '', 'image/jpeg', undefined, res);
  }

  /** The source video, for the player on the video page and the planned-clip preview. */
  @Get('videos/:id/file')
  async sourceFile(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const video = await this.videos.findOwned(userId, id);
    const ready = video?.status === 'READY';
    return sendFile(ready ? this.storage.absolute(video.storagePath) : '', video?.mimeType ?? 'video/mp4', range, res);
  }
}
