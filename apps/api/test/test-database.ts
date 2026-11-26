import { existsSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { LOCAL_USER_ID } from '../src/common/current-user.js';
import { ROOT_ENV_FILE } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/infrastructure/database/database.tokens.js';
import { users } from '../src/infrastructure/database/schema.js';

const DEFAULT_TEST_DATABASE_URL = 'postgresql:///clipforge_test?host=/var/run/postgresql&port=5433';

export function testDatabaseUrl(): string {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE); // never overrides variables already set
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export const MISSING_DB_HELP =
  'Cannot reach the test database. Create it once with:\n' +
  '  sudo -u postgres createdb -p 5433 -O "$USER" clipforge_test\n' +
  'or point TEST_DATABASE_URL in .env at another empty database.';

/** A Drizzle instance on clipforge_test plus helpers to reset it between tests. */
export class TestDatabase {
  readonly pool = new Pool({ connectionString: testDatabaseUrl(), max: 2 });
  readonly db: Database = createDatabase(this.pool);

  /** Removes every row except the seeded local user. */
  async reset(): Promise<void> {
    await this.db.execute(sql`TRUNCATE rendered_clips, render_jobs, planned_clips, editing_plans, experiments, video_analyses, processing_jobs, source_videos, projects`);
    await this.db.execute(sql`DELETE FROM users WHERE id <> ${LOCAL_USER_ID}`);
  }

  async createUser(id: string): Promise<void> {
    await this.db.insert(users).values({ id, displayName: 'Other user' });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
