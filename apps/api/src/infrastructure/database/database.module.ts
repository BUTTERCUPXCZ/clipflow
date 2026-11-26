import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../../config/env.js';
import { createDatabase, DRIZZLE, PG_POOL } from './database.tokens.js';
import { MigrationRunner } from './migration-runner.js';

export { DRIZZLE, PG_POOL, type Database } from './database.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 5,
          connectionTimeoutMillis: 3000,
          query_timeout: 10_000,
        });
        // Without a listener, an idle client dropped by the server crashes the process.
        pool.on('error', (err) => new Logger('Postgres').error(`idle client error: ${err.message}`));
        return pool;
      },
    },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: createDatabase },
    MigrationRunner,
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
