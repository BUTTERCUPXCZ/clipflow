import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.js';
import { uuidParam } from '../../common/schemas.js';
import { type ImportVideo, importVideoSchema } from './videos.schemas.js';
import { VideosService } from './videos.service.js';

@Controller()
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  /** 202: the row is created at once; the copy continues in the background (poll GET /videos/:id). */
  @Post('projects/:id/videos/import')
  @HttpCode(202)
  import(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) projectId: string,
    @Body({ schema: importVideoSchema }) body: ImportVideo,
  ) {
    return this.videos.startImport(userId, projectId, body.path);
  }

  @Get('projects/:id/videos')
  list(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) projectId: string) {
    return this.videos.list(userId, projectId);
  }

  @Get('videos/:id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.videos.get(userId, id);
  }

  @Delete('videos/:id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string): Promise<void> {
    await this.videos.delete(userId, id);
  }
}
