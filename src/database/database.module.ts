import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const POSTGRES_POOL = Symbol('POSTGRES_POOL');

@Injectable()
class PostgresPoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: POSTGRES_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: 10,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
          application_name: 'tread-api',
        });
        pool.on('error', (error) => {
          Logger.error('Unexpected PostgreSQL pool error', error.stack, 'DatabaseModule');
        });
        return pool;
      },
    },
    PostgresPoolShutdown,
  ],
  exports: [POSTGRES_POOL],
})
export class DatabaseModule {}
