import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { MIGRATIONS_DIR } from '../src/infrastructure/database/migration-runner.js';
import { MISSING_DB_HELP, TestDatabase } from './test-database.js';

/** Vitest globalSetup: migrate clipforge_test once per run. */
export default async function setup(): Promise<void> {
  const database = new TestDatabase();
  try {
    await database.pool.query('SELECT 1');
  } catch (e) {
    await database.close();
    throw new Error(`${MISSING_DB_HELP}\n(${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    await migrate(database.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await database.close();
  }
}
