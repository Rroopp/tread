import { createDecipheriv, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { WebhooksService } from './webhooks.service';

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  outbox_event_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
  url: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
  endpoint_status: string;
  created_at: Date;
}

@Injectable()
export class WebhookDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.runCycle(), 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.fanOutOutboxEvents();
      for (let i = 0; i < 10; i++) {
        const delivery = await this.claimDelivery();
        if (!delivery) break;
        await this.deliver(delivery);
      }
    } catch (error) {
      this.logger.error('Webhook worker cycle failed', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
    }
  }

  private async fanOutOutboxEvents(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const events = await client.query<{ id: string; institution_id: string | null; environment_id: string | null; event_type: string; payload: unknown }>(
        `SELECT id, institution_id, environment_id, event_type, payload
         FROM outbox_events WHERE published_at IS NULL
         ORDER BY occurred_at, id LIMIT 50 FOR UPDATE SKIP LOCKED`,
      );
      for (const event of events.rows) {
        if (event.institution_id && event.environment_id) {
          const endpoints = await client.query<{ id: string; environment_id: string }>(
            `SELECT id, environment_id FROM webhook_endpoints
             WHERE institution_id = $1 AND environment_id = $2
               AND status = 'ACTIVE' AND $3 = ANY(event_types)`,
            [event.institution_id, event.environment_id, event.event_type],
          );
          for (const endpoint of endpoints.rows) {
            await client.query(
              `INSERT INTO webhook_deliveries
                (institution_id, environment_id, endpoint_id, outbox_event_id, event_type, payload)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               ON CONFLICT (endpoint_id, outbox_event_id) DO NOTHING`,
              [event.institution_id, endpoint.environment_id, endpoint.id, event.id, event.event_type, JSON.stringify(event.payload)],
            );
          }
        }
        await client.query('UPDATE outbox_events SET published_at = now() WHERE id = $1', [event.id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimDelivery(): Promise<DeliveryRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<DeliveryRow>(
        `SELECT d.id, d.endpoint_id, d.outbox_event_id, d.event_type, d.payload, d.status,
                d.attempts, e.url, e.secret_ciphertext, e.secret_iv, e.secret_auth_tag,
                e.status AS endpoint_status, d.created_at
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE ((d.status IN ('PENDING', 'RETRYING') AND d.next_attempt_at <= now())
             OR (d.status = 'DELIVERING' AND d.lease_until < now()))
         ORDER BY d.next_attempt_at, d.created_at
         LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      if (row.endpoint_status !== 'ACTIVE') {
        await client.query(`UPDATE webhook_deliveries SET status = 'DEAD', last_error = 'endpoint_disabled', lease_until = NULL WHERE id = $1`, [row.id]);
        await client.query('COMMIT');
        return null;
      }
      const claimed = await client.query<DeliveryRow>(
        `UPDATE webhook_deliveries SET status = 'DELIVERING', attempts = attempts + 1,
           lease_until = now() + interval '30 seconds'
         WHERE id = $1 RETURNING id, endpoint_id, outbox_event_id, event_type, payload,
           status, attempts, created_at`,
        [row.id],
      );
      await client.query('COMMIT');
      return { ...row, ...claimed.rows[0] };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async deliver(delivery: DeliveryRow): Promise<void> {
    let status: number | null = null;
    let failure: string | null = null;
    try {
      const endpoint = this.webhooks.validateUrl(delivery.url);
      const key = this.webhooks.encryptionKey();
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(delivery.secret_iv, 'base64'));
      decipher.setAuthTag(Buffer.from(delivery.secret_auth_tag, 'base64'));
      const secret = Buffer.concat([
        decipher.update(Buffer.from(delivery.secret_ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const envelope = {
        id: delivery.outbox_event_id,
        type: delivery.event_type,
        createdAt: delivery.created_at.toISOString(),
        data: delivery.payload,
      };
      const body = JSON.stringify(envelope);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
      status = await this.postPinned(endpoint, body, {
          'Content-Type': 'application/json',
          'Tread-Event-Id': delivery.outbox_event_id,
          'Tread-Signature': `t=${timestamp},v1=${signature}`,
      });
      if (status < 200 || status >= 300) failure = `http_${status}`;
    } catch (error) {
      failure = error instanceof Error ? error.name : 'delivery_error';
    }
    const delivered = status !== null && status >= 200 && status < 300;
    const maxAttempts = 8;
    const dead = !delivered && delivery.attempts >= maxAttempts;
    const delaySeconds = Math.min(3_600, 5 * 2 ** Math.min(delivery.attempts - 1, 10));
    await this.pool.query(
      `UPDATE webhook_deliveries
       SET status = $2, last_http_status = $3, last_error = $4, lease_until = NULL,
           delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE delivered_at END,
           next_attempt_at = CASE WHEN $2 = 'RETRYING' THEN now() + ($5 * interval '1 second') ELSE next_attempt_at END
       WHERE id = $1`,
      [delivery.id, delivered ? 'DELIVERED' : dead ? 'DEAD' : 'RETRYING', status, failure, delaySeconds],
    );
  }

  private async postPinned(endpoint: URL, body: string, headers: Record<string, string>): Promise<number> {
    const hostname = endpoint.hostname.toLowerCase();
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, family: 4, verbatim: true });
    const ipv4 = addresses.filter((entry) => entry.family === 4);
    if (ipv4.length === 0 || ipv4.some(({ address }) => !isPublicIpv4(address))) {
      throw new Error('webhook_host_not_public');
    }

    const target = ipv4[0].address;
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({
        protocol: 'https:',
        hostname: target,
        port: 443,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: 'POST',
        servername: hostname,
        headers: { ...headers, Host: hostname },
        timeout: 8_000,
        checkServerIdentity: (_host, cert) => checkServerIdentity(hostname, cert),
      }, (response) => {
        let responseBytes = 0;
        response.on('data', (chunk: Buffer) => {
          responseBytes += chunk.length;
          if (responseBytes > 64 * 1024) req.destroy(new Error('webhook_response_too_large'));
        });
        response.on('end', () => resolve(response.statusCode ?? 0));
        response.on('aborted', () => reject(new Error('webhook_response_aborted')));
        response.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('webhook_timeout')));
      req.on('error', reject);
      const deadline = setTimeout(() => req.destroy(new Error('webhook_deadline_exceeded')), 8_000);
      req.on('close', () => clearTimeout(deadline));
      req.end(body);
    });
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && octets[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && octets[2] === 100) ||
    (a === 203 && b === 0 && octets[2] === 113) ||
    a >= 224
  );
}
