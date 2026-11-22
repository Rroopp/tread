import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ThrottlerStorage } from '@nestjs/throttler';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(PostgresThrottlerStorage.name);
  private cleanupTimer: NodeJS.Timeout;

  constructor(private readonly pool: Pool) {
    this.cleanupTimer = setInterval(() => {
      void this.pool.query(`DELETE FROM api_rate_limits WHERE expires_at < now() - interval '1 hour'`)
        .catch((error: unknown) => this.logger.error('Rate limit cleanup failed', error instanceof Error ? error.stack : undefined));
    }, 10 * 60_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void { clearInterval(this.cleanupTimer); }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const result = await this.pool.query<{
      total_hits: number;
      time_to_expire: number;
      is_blocked: boolean;
      time_to_block_expire: number;
    }>(
      `INSERT INTO api_rate_limits
         (throttler_name, tracker_key, window_started_at, total_hits, blocked_until, expires_at)
       VALUES ($1, $2, clock_timestamp(), 1, NULL,
         clock_timestamp() + (($3::bigint + $5::bigint) * interval '1 millisecond'))
       ON CONFLICT (throttler_name, tracker_key) DO UPDATE SET
         total_hits = CASE
           WHEN api_rate_limits.blocked_until > clock_timestamp() THEN api_rate_limits.total_hits
           WHEN api_rate_limits.window_started_at + ($3::bigint * interval '1 millisecond') <= clock_timestamp() THEN 1
           ELSE api_rate_limits.total_hits + 1 END,
         window_started_at = CASE
           WHEN api_rate_limits.blocked_until > clock_timestamp() THEN api_rate_limits.window_started_at
           WHEN api_rate_limits.window_started_at + ($3::bigint * interval '1 millisecond') <= clock_timestamp() THEN clock_timestamp()
           ELSE api_rate_limits.window_started_at END,
         blocked_until = CASE
           WHEN api_rate_limits.blocked_until > clock_timestamp() THEN api_rate_limits.blocked_until
           WHEN (CASE WHEN api_rate_limits.window_started_at + ($3 * interval '1 millisecond') <= clock_timestamp()
           THEN 1 ELSE api_rate_limits.total_hits + 1 END) > $4::integer
             THEN clock_timestamp() + ($5::bigint * interval '1 millisecond')
           ELSE NULL END,
         expires_at = clock_timestamp() + (($3::bigint + $5::bigint) * interval '1 millisecond')
       RETURNING total_hits,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_started_at + ($3::bigint * interval '1 millisecond') - clock_timestamp())) * 1000))::int AS time_to_expire,
         COALESCE(blocked_until > clock_timestamp(), false) AS is_blocked,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (blocked_until - clock_timestamp())) * 1000))::int AS time_to_block_expire`,
      [throttlerName, key, ttl, limit, blockDuration],
    );
    const row = result.rows[0];
    return {
      totalHits: row.total_hits,
      timeToExpire: row.time_to_expire,
      isBlocked: row.is_blocked,
      timeToBlockExpire: row.time_to_block_expire,
    };
  }
}
