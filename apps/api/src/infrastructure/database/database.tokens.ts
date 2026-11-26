import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema.js';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE = Symbol('DRIZZLE');
export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}
