import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';

const MAX_MINOR_UNITS = 10n ** 38n - 1n;

export interface ProviderObservationInput {
  providerReference: string;
  status: 'SETTLED' | 'FAILED' | 'PENDING' | 'PROCESSING';
  assetCode: string;
  amountMinor: string;
  observedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderStatementFeed {
  readonly providerCode: string;
  fetchStatement(context: { institutionId: string; environmentId: string; environment: 'SANDBOX' | 'PRODUCTION' }, period: {
    from: string; to: string;
  }): Promise<ProviderObservationInput[]>;
}

@Injectable()
export class ReconciliationService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async reconcileFromStatementFeed(input: {
    institutionId: string;
    environmentId: string;
    environment: 'SANDBOX' | 'PRODUCTION';
    providerCode: string;
    idempotencyKey: string;
    period: { from: string; to: string };
  }, feed: ProviderStatementFeed) {
    if (feed.providerCode !== input.providerCode) throw new BadRequestException('Statement feed provider does not match the requested provider');
    if (!Number.isFinite(Date.parse(input.period.from)) || !Number.isFinite(Date.parse(input.period.to)) ||
        Date.parse(input.period.from) >= Date.parse(input.period.to)) {
      throw new BadRequestException('Statement period must be a valid increasing time range');
    }
    const observations = await feed.fetchStatement({
      institutionId: input.institutionId, environmentId: input.environmentId, environment: input.environment,
    }, input.period);
    return this.reconcileProviderBatch({
      institutionId: input.institutionId, environmentId: input.environmentId,
      providerCode: input.providerCode, idempotencyKey: input.idempotencyKey, observations,
    });
  }

  async reconcileProviderBatch(input: {
    institutionId: string;
    environmentId: string;
    providerCode: string;
    idempotencyKey: string;
    observations: ProviderObservationInput[];
  }) {
    if (!input.providerCode || input.providerCode.length > 80 || !input.idempotencyKey || input.idempotencyKey.length > 255 ||
        input.observations.length < 1 || input.observations.length > 1000) {
      throw new BadRequestException('Provider code, idempotency key, and 1 to 1000 observations are required');
    }
    for (const observation of input.observations) {
      if (!observation.providerReference || observation.providerReference.length > 255 ||
          !/^[A-Z0-9]{2,12}$/.test(observation.assetCode) || !/^(0|[1-9][0-9]{0,37})$/.test(observation.amountMinor) ||
          !Number.isFinite(Date.parse(observation.observedAt))) {
        throw new BadRequestException('A provider observation is invalid');
      }
      if (BigInt(observation.amountMinor) > MAX_MINOR_UNITS) throw new BadRequestException('Provider amount exceeds supported precision');
    }
    const requestHash = createHash('sha256').update(JSON.stringify({
      providerCode: input.providerCode,
      observations: input.observations,
    })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; request_hash: string; status: string }>(
        `SELECT id, request_hash, status FROM reconciliation_batches
         WHERE institution_id = $1 AND environment_id = $2 AND provider_code = $3 AND idempotency_key = $4
         FOR UPDATE`,
        [input.institutionId, input.environmentId, input.providerCode, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const batch = existing.rows[0];
        if (batch.request_hash !== requestHash) throw new ConflictException('Reconciliation idempotency key was reused with different observations');
        await client.query('COMMIT');
        return this.getBatch(input.institutionId, input.environmentId, batch.id, true);
      }

      const batchResult = await client.query<{ id: string }>(
        `INSERT INTO reconciliation_batches
          (institution_id, environment_id, provider_code, idempotency_key, request_hash, status)
         VALUES ($1, $2, $3, $4, $5, 'PROCESSING') RETURNING id`,
        [input.institutionId, input.environmentId, input.providerCode, input.idempotencyKey, requestHash],
      );
      const batchId = batchResult.rows[0].id;
      let matched = 0;
      let variance = 0;
      let unmatched = 0;
      for (const observation of input.observations) {
        const attemptResult = await client.query<{
          id: string; transaction_id: string; status: string;
          settlement_asset_code: string | null; settlement_amount_minor: string | null;
        }>(
          `SELECT id, transaction_id, status, settlement_asset_code, settlement_amount_minor::text
           FROM provider_attempts
           WHERE institution_id = $1 AND environment_id = $2 AND provider_code = $3 AND provider_reference = $4
           FOR UPDATE`,
          [input.institutionId, input.environmentId, input.providerCode, observation.providerReference],
        );
        const attempt = attemptResult.rows[0];
        let result: 'MATCHED' | 'VARIANCE' | 'UNMATCHED' | 'PENDING';
        if (!attempt) {
          result = 'UNMATCHED';
          unmatched++;
        } else if (!attempt.settlement_asset_code || attempt.settlement_amount_minor === null ||
                   !['SUCCEEDED', 'FAILED'].includes(attempt.status) || ['PENDING', 'PROCESSING'].includes(observation.status)) {
          result = 'PENDING';
        } else if (attempt.settlement_asset_code !== observation.assetCode ||
                   BigInt(attempt.settlement_amount_minor) !== BigInt(observation.amountMinor) ||
                   (attempt.status === 'SUCCEEDED') !== (observation.status === 'SETTLED')) {
          result = 'VARIANCE';
          variance++;
        } else {
          result = 'MATCHED';
          matched++;
        }
        await client.query(
          `INSERT INTO reconciliation_observations
            (batch_id, institution_id, environment_id, provider_code, provider_reference,
             provider_attempt_id, transaction_id, observed_status, observed_asset_code,
             observed_amount_minor, expected_asset_code, expected_amount_minor, result, details, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
          [batchId, input.institutionId, input.environmentId, input.providerCode, observation.providerReference,
            attempt?.id ?? null, attempt?.transaction_id ?? null, observation.status, observation.assetCode,
            observation.amountMinor, attempt?.settlement_asset_code ?? null, attempt?.settlement_amount_minor ?? null,
            result, JSON.stringify(observation.metadata ?? {}), new Date(observation.observedAt)],
        );
      }
      const completed = await client.query(
        `UPDATE reconciliation_batches SET status = 'COMPLETED', observation_count = $2,
           matched_count = $3, variance_count = $4, unmatched_count = $5
         WHERE id = $1 AND institution_id = $6 AND environment_id = $7`,
        [batchId, input.observations.length, matched, variance, unmatched, input.institutionId, input.environmentId],
      );
      if (completed.rowCount !== 1) throw new NotFoundException('Reconciliation batch not found in the requested environment');
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'reconciliation.batch_completed', 'reconciliation_batch', $2, $3::jsonb)`,
        [input.institutionId, batchId, JSON.stringify({ providerCode: input.providerCode, observationCount: input.observations.length, matched, variance, unmatched })],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'reconciliation_batch', $3, 'reconciliation.batch_completed', $4::jsonb)`,
        [input.institutionId, input.environmentId, batchId, JSON.stringify({ batchId, matched, variance, unmatched, pending: input.observations.length - matched - variance - unmatched })],
      );
      await client.query('COMMIT');
      return this.getBatch(input.institutionId, input.environmentId, batchId, false);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async getBatch(institutionId: string, environmentId: string, batchId: string, replayed: boolean) {
    const batch = await this.pool.query(
      `SELECT id, provider_code, status, observation_count, matched_count, variance_count,
              unmatched_count, created_at
       FROM reconciliation_batches WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [batchId, institutionId, environmentId],
    );
    const row = batch.rows[0];
    if (!row) throw new NotFoundException('Reconciliation batch not found');
    const observations = await this.pool.query(
      `SELECT id, provider_reference, transaction_id, observed_status, observed_asset_code,
              observed_amount_minor::text, expected_asset_code, expected_amount_minor::text,
              result, observed_at, created_at
       FROM reconciliation_observations WHERE batch_id = $1 AND institution_id = $2 AND environment_id = $3
       ORDER BY created_at, id`,
      [batchId, institutionId, environmentId],
    );
    return { ...row, observations: observations.rows, replayed };
  }
}
