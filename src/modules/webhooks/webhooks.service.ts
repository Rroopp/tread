import { createCipheriv, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { CreateWebhookEndpointDto } from './webhooks.dto';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  async create(institutionId: string, environmentId: string, input: CreateWebhookEndpointDto) {
    const url = this.validateUrl(input.url);
    const key = this.encryptionKey();
    const secret = randomBytes(32).toString('base64url');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO webhook_endpoints
          (institution_id, environment_id, url, description, secret_ciphertext, secret_iv, secret_auth_tag, event_types)
         SELECT i.id, e.id, $3, $4, $5, $6, $7, $8
         FROM institutions i JOIN institution_environments e ON e.institution_id = i.id
         WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.id = $2 AND e.status = 'ACTIVE'
         RETURNING id`,
        [institutionId, environmentId, url.toString(), input.description.trim(), ciphertext.toString('base64'), iv.toString('base64'), authTag.toString('base64'), input.eventTypes],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new ConflictException('Institution environment is not active');
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id)
         VALUES ($1, 'webhook.endpoint_created', 'webhook_endpoint', $2)`,
        [institutionId, id],
      );
      await client.query('COMMIT');
      return { id, url: url.toString(), description: input.description.trim(), eventTypes: input.eventTypes, status: 'ACTIVE', signingSecret: secret };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async activeSandboxEnvironment(institutionId: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT e.id FROM institution_environments e JOIN institutions i ON i.id = e.institution_id
       WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.environment = 'SANDBOX' AND e.status = 'ACTIVE'`,
      [institutionId],
    );
    if (!result.rows[0]) throw new NotFoundException('Active sandbox environment not found');
    return result.rows[0].id;
  }

  async list(institutionId: string, environmentId: string) {
    const result = await this.pool.query(
      `SELECT id, url, description, event_types, status, created_at
       FROM webhook_endpoints WHERE institution_id = $1 AND environment_id = $2
       ORDER BY created_at DESC LIMIT 100`,
      [institutionId, environmentId],
    );
    return { endpoints: result.rows };
  }

  async disable(institutionId: string, environmentId: string, endpointId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE webhook_endpoints SET status = 'DISABLED', updated_at = now()
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'ACTIVE'
         RETURNING id`,
        [endpointId, institutionId, environmentId],
      );
      if (!result.rows[0]) throw new NotFoundException('Active webhook endpoint not found');
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id)
         VALUES ($1, 'webhook.endpoint_disabled', 'webhook_endpoint', $2)`,
        [institutionId, endpointId],
      );
      await client.query('COMMIT');
      return { id: endpointId, status: 'DISABLED' };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async listDeliveries(institutionId: string, environmentId: string, limit: number) {
    const result = await this.pool.query(
      `SELECT id, endpoint_id, outbox_event_id, event_type, status, attempts,
              next_attempt_at, last_http_status, last_error, created_at, delivered_at
       FROM webhook_deliveries WHERE institution_id = $1 AND environment_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [institutionId, environmentId, Math.max(1, Math.min(100, limit))],
    );
    return { deliveries: result.rows };
  }

  validateUrl(rawUrl: string): URL {
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new ConflictException('Webhook URL is invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
      throw new ConflictException('Webhook URL must use HTTPS on the standard port and cannot contain credentials');
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
      throw new ConflictException('Webhook URL host is not allowed');
    }
    const allowedHosts = this.config.get<string>('WEBHOOK_ALLOWED_HOSTS', '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    if (!allowedHosts.includes(hostname)) {
      throw new ConflictException('Webhook URL host is not in WEBHOOK_ALLOWED_HOSTS');
    }
    return url;
  }

  encryptionKey(): Buffer {
    const encoded = this.config.get<string>('WEBHOOK_SECRET_ENCRYPTION_KEY', '');
    const key = Buffer.from(encoded, 'base64');
    if (!encoded || key.length !== 32) {
      throw new ServiceUnavailableException('Webhook secret encryption key must be configured as base64 encoded 32-byte key material');
    }
    return key;
  }
}
