import { resolve } from 'node:path';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { type Database, DRIZZLE } from './database.tokens.js';

/** apps/api/drizzle — same depth from src/ and dist/. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../../drizzle');

/** Applies pending migrations before the app listens; a failed migration stops startup. */
@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger(MigrationRunner.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await migrate(this.db, { migrationsFolder: MIGRATIONS_DIR });
    this.logger.log('database migrations applied');
  }
}
