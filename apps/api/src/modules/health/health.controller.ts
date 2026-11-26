import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthReport, HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(503);
    return report;
  }
}
