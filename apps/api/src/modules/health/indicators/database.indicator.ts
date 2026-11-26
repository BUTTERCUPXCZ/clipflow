import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../infrastructure/database/database.module.js';
import { type Check, error, errorMessage, type HealthIndicator, ok } from '../health-indicator.js';

@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async check(): Promise<Record<string, Check>> {
    try {
      await this.pool.query('SELECT 1');
      return { database: ok('connected') };
    } catch (e) {
      return { database: error(`unreachable: ${errorMessage(e)}`) };
    }
  }
}
