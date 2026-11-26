import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../../config/env.js';

export const PG_POOL = Symbol('PG_POOL');

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
          query_timeout: 3000,
        });
        // Without a listener, an idle client dropped by the server crashes the process.
        pool.on('error', (err) => new Logger('Postgres').error(`idle client error: ${err.message}`));
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
