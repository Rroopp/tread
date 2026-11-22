import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { EmailOutboxService } from './email-outbox.service';
import { EMAIL_SENDER, EmailSender } from './email-sender';

@Injectable()
export class EmailDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly outbox: EmailOutboxService,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.deliverBatch(), 2_000);
    this.timer.unref();
    void this.deliverBatch();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async deliverBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let message: { id: string; institution_id: string; recipient_email: string; payload_key_id: string; payload_ciphertext: string; payload_iv: string; payload_auth_tag: string } | undefined;
    try {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const selected = await client.query<{ id: string; institution_id: string; recipient_email: string; payload_key_id: string; payload_ciphertext: string; payload_iv: string; payload_auth_tag: string }>(
          `SELECT id, institution_id, recipient_email, payload_key_id, payload_ciphertext, payload_iv, payload_auth_tag
           FROM email_outbox
           WHERE (status IN ('PENDING', 'FAILED') AND next_attempt_at <= now())
              OR (status = 'PROCESSING' AND updated_at < now() - interval '5 minutes')
           ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        message = selected.rows[0];
        if (!message) { await client.query('COMMIT'); return; }
        await client.query(`UPDATE email_outbox SET status = 'PROCESSING', attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1`, [message.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }

      const payload = this.outbox.decryptPayload(message);
      await this.sender.send({
        recipient: message.recipient_email,
        subject: 'Your TREAD institution invitation',
        text: `Use this secure link to accept your invitation: ${payload.invitationUrl}`,
      });
      // The bearer invitation is removed from storage once the email provider accepts the message.
      await this.pool.query(`UPDATE email_outbox SET status = 'SENT', sent_at = now(), last_error_code = NULL,
        payload_ciphertext = '', payload_iv = '', payload_auth_tag = '', updated_at = now()
        WHERE id = $1 AND status = 'PROCESSING'`, [message.id]);
    } catch (error) {
      this.logger.error('Invitation email delivery failed; recipient and message content are suppressed');
      // Failures are retried by the queue; never log provider response bodies which can contain PII.
      if (message) await this.pool.query(
        `UPDATE email_outbox SET status = 'FAILED', last_error_code = 'DELIVERY_FAILED',
          next_attempt_at = now() + make_interval(secs => LEAST(3600, (30 * power(2, LEAST(attempt_count, 7)))::int)), updated_at = now()
         WHERE id = $1 AND status = 'PROCESSING'`, [message.id],
      ).catch(() => undefined);
    } finally { this.running = false; }
  }
}
