import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.js';
import { uuidParam } from '../../common/schemas.js';
import {
  type CreateProject,
  createProjectSchema,
  type UpdateProject,
  updateProjectSchema,
} from './projects.schemas.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body({ schema: createProjectSchema }) body: CreateProject) {
    return this.projects.create(userId, body);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.projects.list(userId);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string) {
    return this.projects.get(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id', { schema: uuidParam }) id: string,
    @Body({ schema: updateProjectSchema }) body: UpdateProject,
  ) {
    return this.projects.update(userId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@CurrentUser() userId: string, @Param('id', { schema: uuidParam }) id: string): Promise<void> {
    await this.projects.delete(userId, id);
  }
}
