import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../database/database.module';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async isDatabaseReady(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Database readiness check failed', error instanceof Error ? error.stack : undefined);
      return false;
    }
  }
}
