import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { UserPrincipal } from '../identity/api-key.types';

export const TRANSACTION_STATUSES = [
  'CREATED',
  'QUOTED',
  'AWAITING_FUNDING',
  'FUNDED',
  'COMPLIANCE_PENDING',
  'APPROVED',
  'EXECUTING',
  'BROADCAST',
  'CONFIRMING',
  'SETTLED',
  'RECONCILED',
  'FAILED',
  'CANCELLED',
  'REQUIRES_REVIEW',
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
const MAX_MINOR_UNITS = 10n ** 38n - 1n;

export interface CreateTransactionInput {
  institutionId: string;
  environmentId: string;
  assetCode?: string;
  idempotencyKey: string;
  clientReference?: string;
  amountMinor?: bigint;
  quoteId?: string;
  actorUserId?: string;
  actorCredentialId?: string;
}

export const TRANSACTION_TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  CREATED: ['QUOTED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'],
  QUOTED: ['AWAITING_FUNDING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'],
  AWAITING_FUNDING: ['FUNDED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'],
  FUNDED: ['COMPLIANCE_PENDING', 'FAILED', 'REQUIRES_REVIEW'],
  COMPLIANCE_PENDING: ['APPROVED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'],
  APPROVED: ['EXECUTING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW'],
  EXECUTING: ['BROADCAST', 'SETTLED', 'FAILED', 'REQUIRES_REVIEW'],
  BROADCAST: ['CONFIRMING', 'SETTLED', 'FAILED', 'REQUIRES_REVIEW'],
  CONFIRMING: ['SETTLED', 'FAILED', 'REQUIRES_REVIEW'],
  SETTLED: ['RECONCILED', 'REQUIRES_REVIEW'],
  RECONCILED: [],
  FAILED: [],
  CANCELLED: [],
  REQUIRES_REVIEW: ['COMPLIANCE_PENDING', 'FAILED', 'CANCELLED'],
};

@Injectable()
export class TransactionsService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async createForDashboard(principal: UserPrincipal, quoteId: string, idempotencyKey: string, clientReference?: string) {
    const environment = await this.pool.query<{ id: string }>(
      `SELECT id FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const environmentId = environment.rows[0]?.id;
    if (!environmentId) throw new ConflictException('No active institution environment is available');
    return this.create({ institutionId: principal.institutionId, environmentId, quoteId,
      idempotencyKey, clientReference, actorUserId: principal.userId });
  }

  async create(input: CreateTransactionInput): Promise<{ id: string; status: TransactionStatus; replayed: boolean }> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 255) {
      throw new BadRequestException('A valid idempotency key is required');
    }
    const hasAmountRequest = !!input.assetCode && input.amountMinor !== undefined && !input.quoteId;
    if (input.quoteId ? (input.assetCode !== undefined || input.amountMinor !== undefined) : !hasAmountRequest) {
      throw new BadRequestException('Provide either quoteId or both assetCode and amountMinor');
    }
    if (input.amountMinor !== undefined && (input.amountMinor <= 0n || input.amountMinor > MAX_MINOR_UNITS)) {
      throw new BadRequestException('Transaction amount must be a positive value of at most 38 minor-unit digits');
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        assetCode: input.assetCode,
        clientReference: input.clientReference ?? null,
        amountMinor: input.amountMinor?.toString() ?? null,
        quoteId: input.quoteId ?? null,
      }))
      .digest('hex');
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO idempotency_records
          (institution_id, environment_id, key, request_hash)
         VALUES ($1, $2, $3, $4)`,
        [input.institutionId, input.environmentId, input.idempotencyKey, requestHash],
      );

      let transactionId: string | undefined;
      let initialStatus: TransactionStatus = 'CREATED';
      if (input.quoteId) {
        const quoteResult = await client.query<{
          source_asset_code: string; destination_asset_code: string;
          source_amount_minor: string; destination_amount_minor: string;
        }>(
          `SELECT source_asset_code, destination_asset_code, source_amount_minor::text, destination_amount_minor::text
           FROM quotes WHERE id = $1 AND institution_id = $2 AND environment_id = $3
             AND status = 'ACTIVE' AND expires_at > now() FOR UPDATE`,
          [input.quoteId, input.institutionId, input.environmentId],
        );
        const quote = quoteResult.rows[0];
        if (!quote) throw new ConflictException('Quote is expired, consumed, or unavailable');
        const transaction = await client.query<{ id: string }>(
          `INSERT INTO financial_transactions
            (institution_id, environment_id, asset_code, client_reference, amount_minor,
             destination_asset_code, destination_amount_minor, quote_id)
           SELECT i.id, e.id, $3, $4, $5, $6, $7, $8
           FROM institutions i JOIN institution_environments e ON e.id = $2 AND e.institution_id = i.id
           JOIN assets a ON a.code = $3 AND a.enabled = true
           WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.status = 'ACTIVE'
           RETURNING id`,
          [input.institutionId, input.environmentId, quote.source_asset_code,
            input.clientReference ?? null, quote.source_amount_minor, quote.destination_asset_code,
            quote.destination_amount_minor, input.quoteId],
        );
        transactionId = transaction.rows[0]?.id;
        if (transactionId) {
          const consumed = await client.query(
            `UPDATE quotes SET status = 'CONSUMED'
             WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'ACTIVE'`,
            [input.quoteId, input.institutionId, input.environmentId],
          );
          if (consumed.rowCount !== 1) throw new ConflictException('Quote is no longer available');
          const updated = await client.query(
            `UPDATE financial_transactions SET status = 'QUOTED'
             WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
            [transactionId, input.institutionId, input.environmentId],
          );
          if (updated.rowCount !== 1) throw new ConflictException('Transaction environment changed while consuming quote');
          await client.query(
            `INSERT INTO transaction_transitions
              (transaction_id, institution_id, from_status, to_status, actor_user_id, actor_credential_id)
             VALUES ($1, $2, 'CREATED', 'QUOTED', $3, $4)`,
            [transactionId, input.institutionId, input.actorUserId ?? null, input.actorCredentialId ?? null],
          );
          initialStatus = 'QUOTED';
        }
      } else {
        const transaction = await client.query<{ id: string }>(
          `INSERT INTO financial_transactions
            (institution_id, environment_id, asset_code, client_reference, amount_minor)
           SELECT i.id, e.id, a.code, $4, $5
           FROM institutions i
           JOIN institution_environments e ON e.institution_id = i.id
           JOIN assets a ON a.code = $3
           WHERE i.id = $1 AND i.status = 'ACTIVE'
             AND e.id = $2 AND e.status = 'ACTIVE' AND a.enabled = true
           RETURNING id`,
          [input.institutionId, input.environmentId, input.assetCode, input.clientReference ?? null, input.amountMinor?.toString()],
        );
        transactionId = transaction.rows[0]?.id;
      }
      if (!transactionId) {
        throw new BadRequestException('Institution, environment, or asset is not enabled');
      }

      await client.query(
        `INSERT INTO transaction_transitions
          (transaction_id, institution_id, from_status, to_status, actor_user_id, actor_credential_id)
         VALUES ($1, $2, NULL, 'CREATED', $3, $4)`,
        [transactionId, input.institutionId, input.actorUserId ?? null, input.actorCredentialId ?? null],
      );
      await client.query(
        `INSERT INTO outbox_events
          (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'financial_transaction', $3, 'transaction.created', $4::jsonb)`,
        [input.institutionId, input.environmentId, transactionId, JSON.stringify({ transactionId, status: initialStatus })],
      );
      if (initialStatus === 'QUOTED') {
        await client.query(
          `INSERT INTO outbox_events
            (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, 'financial_transaction', $3, 'transaction.status_changed', $4::jsonb)`,
          [input.institutionId, input.environmentId, transactionId, JSON.stringify({ transactionId, fromStatus: 'CREATED', status: 'QUOTED' })],
        );
      }
      await client.query(
        `UPDATE idempotency_records
         SET status = 'COMPLETED', response_status = 201,
             response_body = $4::jsonb, resource_id = $5
         WHERE institution_id = $1 AND environment_id = $2 AND key = $3`,
        [
          input.institutionId,
          input.environmentId,
          input.idempotencyKey,
          JSON.stringify({ id: transactionId, status: initialStatus }),
          transactionId,
        ],
      );
      await client.query('COMMIT');
      return { id: transactionId, status: initialStatus, replayed: false };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Keep the original creation error.
      }
      if (this.isPostgresError(error, '23505')) {
        return this.replayOrReject(input, requestHash);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(
    institutionId: string,
    environmentId: string,
    transactionId: string,
    nextStatus: TransactionStatus,
    actorUserId?: string,
    reasonCode?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<{ status: TransactionStatus }>(
        `SELECT status FROM financial_transactions
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3
         FOR UPDATE`,
        [transactionId, institutionId, environmentId],
      );
      const currentStatus = currentResult.rows[0]?.status;
      if (!currentStatus) throw new NotFoundException('Transaction not found');

      if (!TRANSACTION_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
        throw new BadRequestException(`Invalid transaction transition: ${currentStatus} -> ${nextStatus}`);
      }

      const updated = await client.query(
        `UPDATE financial_transactions SET status = $4
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
        [transactionId, institutionId, environmentId, nextStatus],
      );
      if (updated.rowCount !== 1) throw new NotFoundException('Transaction not found');
      await client.query(
        `INSERT INTO transaction_transitions
          (transaction_id, institution_id, from_status, to_status, reason_code, actor_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transactionId, institutionId, currentStatus, nextStatus, reasonCode ?? null, actorUserId ?? null],
      );
      await client.query(
        `INSERT INTO outbox_events
          (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'financial_transaction', $3, 'transaction.status_changed', $4::jsonb)`,
        [institutionId, environmentId, transactionId, JSON.stringify({ transactionId, fromStatus: currentStatus, status: nextStatus })],
      );
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Keep the original transition error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async replayOrReject(
    input: CreateTransactionInput,
    requestHash: string,
  ): Promise<{ id: string; status: TransactionStatus; replayed: boolean }> {
    const result = await this.pool.query<{ request_hash: string; status: string; resource_id: string | null }>(
      `SELECT request_hash, status, resource_id
       FROM idempotency_records
       WHERE institution_id = $1 AND environment_id = $2 AND key = $3`,
      [input.institutionId, input.environmentId, input.idempotencyKey],
    );
    const existing = result.rows[0];
    if (!existing) throw new BadRequestException('Unable to create transaction');
    if (existing.request_hash !== requestHash) {
      throw new ConflictException('Idempotency key was already used with a different request');
    }
    if (existing.status !== 'COMPLETED' || !existing.resource_id) {
      throw new ConflictException('The original idempotent request is still processing');
    }
    const transaction = await this.pool.query<{ status: TransactionStatus }>(
      `SELECT status FROM financial_transactions
       WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [existing.resource_id, input.institutionId, input.environmentId],
    );
    const status = transaction.rows[0]?.status;
    if (!status) throw new ConflictException('The original transaction is no longer available');
    return { id: existing.resource_id, status, replayed: true };
  }

  async findForInstitution(
    institutionId: string,
    environmentId: string,
    transactionId: string,
  ) {
    const result = await this.pool.query<{
      id: string;
      status: TransactionStatus;
      asset_code: string;
      amount_minor: string | null;
      destination_asset_code: string | null;
      destination_amount_minor: string | null;
      created_at: Date;
    }>(
      `SELECT id, status, asset_code, amount_minor::text,
              destination_asset_code, destination_amount_minor::text, created_at
       FROM financial_transactions
       WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [transactionId, institutionId, environmentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const history = await this.pool.query<{
      from_status: TransactionStatus | null;
      to_status: TransactionStatus;
      reason_code: string | null;
      created_at: Date;
    }>(
      `SELECT tt.from_status, tt.to_status, tt.reason_code, tt.created_at
       FROM transaction_transitions tt
       JOIN financial_transactions ft ON ft.id = tt.transaction_id
       WHERE tt.transaction_id = $1 AND ft.institution_id = $2 AND ft.environment_id = $3
       ORDER BY tt.created_at ASC, tt.id ASC`,
      [transactionId, institutionId, environmentId],
    );
    return {
      id: row.id,
      status: row.status,
      assetCode: row.asset_code,
      amountMinor: row.amount_minor,
      destinationAssetCode: row.destination_asset_code,
      destinationAmountMinor: row.destination_amount_minor,
      createdAt: row.created_at,
      history: history.rows.map((transition) => ({
        fromStatus: transition.from_status,
        status: transition.to_status,
        reasonCode: transition.reason_code,
        createdAt: transition.created_at,
      })),
    };
  }

  async listForInstitution(institutionId: string, environmentId: string, limit = 50) {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const result = await this.pool.query<{
      id: string;
      status: TransactionStatus;
      asset_code: string;
      amount_minor: string | null;
      destination_asset_code: string | null;
      destination_amount_minor: string | null;
      created_at: Date;
    }>(
      `SELECT id, status, asset_code, amount_minor::text,
              destination_asset_code, destination_amount_minor::text, created_at
       FROM financial_transactions
       WHERE institution_id = $1 AND environment_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [institutionId, environmentId, boundedLimit],
    );
    return {
      transactions: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        assetCode: row.asset_code,
        amountMinor: row.amount_minor,
        destinationAssetCode: row.destination_asset_code,
        destinationAmountMinor: row.destination_amount_minor,
        createdAt: row.created_at,
      })),
    };
  }

  private isPostgresError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}
