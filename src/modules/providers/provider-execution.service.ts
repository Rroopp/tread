import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { CorridorStage, KesUsdcSandboxAdapter, MOCK_KES_USDC_ADAPTER, ProviderContext } from './provider-contracts';

const STAGES: CorridorStage[] = ['QUOTE', 'FUNDING_CONFIRMATION', 'COMPLIANCE', 'CONVERSION', 'PAYOUT'];
type Scenario = 'SUCCESS' | 'FAIL_PAYOUT_AND_REVERSE' | 'FAIL_AT_STAGE' | 'TIMEOUT_AT_STAGE' | 'RETRYABLE_PAYOUT_ONCE';

export interface SandboxCorridorInput {
  context: ProviderContext;
  sourceAssetCode: 'KES' | 'USDC';
  destinationAssetCode: 'KES' | 'USDC';
  sourceAmountMinor: string;
  scenario?: Scenario;
  failAt?: CorridorStage;
}

@Injectable()
export class ProviderExecutionService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(MOCK_KES_USDC_ADAPTER) private readonly adapter: KesUsdcSandboxAdapter,
  ) {}

  async executeKesUsdcSandbox(input: SandboxCorridorInput) {
    const { context } = input;
    if (context.environment !== 'SANDBOX') throw new ForbiddenException('Provider mock execution is sandbox-only');
    if (!(['KES', 'USDC'].includes(input.sourceAssetCode) && ['KES', 'USDC'].includes(input.destinationAssetCode)) ||
        input.sourceAssetCode === input.destinationAssetCode) throw new BadRequestException('Only the KES/USDC sandbox corridor is supported');
    if (!/^[1-9][0-9]{0,37}$/.test(input.sourceAmountMinor)) throw new BadRequestException('sourceAmountMinor must be a positive integer');
    const allowedScenarios: Scenario[] = ['SUCCESS', 'FAIL_PAYOUT_AND_REVERSE', 'FAIL_AT_STAGE', 'TIMEOUT_AT_STAGE', 'RETRYABLE_PAYOUT_ONCE'];
    if (input.scenario && !allowedScenarios.includes(input.scenario)) throw new BadRequestException('Unsupported sandbox scenario');
    if (input.failAt && ![...STAGES, 'REVERSAL'].includes(input.failAt)) throw new BadRequestException('Unsupported sandbox failure stage');
    if (!context.idempotencyKey.trim() || context.idempotencyKey.length > 255 || !Number.isInteger(context.timeoutMs) || context.timeoutMs < 1 || context.timeoutMs > 120_000) {
      throw new BadRequestException('A bounded timeout and idempotency key are required');
    }
    const scenario = input.scenario ?? 'SUCCESS';
    const requestHash = createHash('sha256').update(JSON.stringify({
      transactionId: context.transactionId, sourceAssetCode: input.sourceAssetCode,
      destinationAssetCode: input.destinationAssetCode, sourceAmountMinor: input.sourceAmountMinor,
      scenario, failAt: input.failAt ?? null,
    })).digest('hex');

    const client = await this.pool.connect();
    let operation: { id: string; request_hash: string; status: string; retry_disposition: string; next_attempt_at: Date | null; updated_at: Date };
    let isNewOperation = false;
    try {
      await client.query('BEGIN');
      const transaction = await client.query<{ id: string; environment: string; asset_code: string }>(
        `SELECT t.id, t.asset_code, e.environment FROM financial_transactions t
         JOIN institution_environments e ON e.id = t.environment_id AND e.institution_id = t.institution_id
         WHERE t.id = $1 AND t.institution_id = $2 AND t.environment_id = $3 FOR UPDATE OF t`,
        [context.transactionId, context.institutionId, context.environmentId],
      );
      if (!transaction.rows[0]) throw new NotFoundException('Transaction not found in the requested institution environment');
      if (transaction.rows[0].environment !== 'SANDBOX') throw new ForbiddenException('Mock provider execution cannot run in production');
      if (transaction.rows[0].asset_code !== input.sourceAssetCode) throw new BadRequestException('Source asset does not match the transaction asset');

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO provider_operations
          (institution_id, environment_id, transaction_id, provider_code, idempotency_key, request_hash,
           source_asset_code, destination_asset_code, source_amount_minor, status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROCESSING', $10::jsonb)
         ON CONFLICT (institution_id, environment_id, provider_code, idempotency_key) DO NOTHING RETURNING id`,
        [context.institutionId, context.environmentId, context.transactionId, this.adapter.code, context.idempotencyKey,
          requestHash, input.sourceAssetCode, input.destinationAssetCode, input.sourceAmountMinor,
          JSON.stringify({ simulated: true, corridor: 'KES_USDC', noFundsMoved: true })],
      );
      isNewOperation = inserted.rows.length === 1;
      const selected = inserted.rows[0]
        ? await client.query<typeof operation>(
          `SELECT id, request_hash, status, retry_disposition, next_attempt_at, updated_at FROM provider_operations WHERE id = $1 FOR UPDATE`, [inserted.rows[0].id])
        : await client.query<typeof operation>(
          `SELECT id, request_hash, status, retry_disposition, next_attempt_at, updated_at FROM provider_operations
           WHERE institution_id = $1 AND environment_id = $2 AND provider_code = $3 AND idempotency_key = $4 FOR UPDATE`,
          [context.institutionId, context.environmentId, this.adapter.code, context.idempotencyKey]);
      operation = selected.rows[0];
      if (!operation) throw new ConflictException('Provider operation could not be initialized');
      if (operation.request_hash !== requestHash) throw new ConflictException('Provider idempotency key was reused with different request data');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }

    if (operation.status === 'UNKNOWN' || operation.status === 'SUCCEEDED') return this.getOperation(context, operation.id, true);
    if (operation.status === 'PROCESSING' && !isNewOperation) {
      const leaseMs = Math.max(context.timeoutMs + 10_000, 15_000);
      if (Date.now() - operation.updated_at.getTime() < leaseMs) return this.getOperation(context, operation.id, true);
      const activeAttempts = await this.pool.query<{ id: string }>(
        `SELECT id FROM provider_attempts WHERE operation_id = $1 AND institution_id = $2 AND environment_id = $3
         AND status IN ('CREATED', 'SUBMITTED')`, [operation.id, context.institutionId, context.environmentId],
      );
      if (activeAttempts.rowCount) {
        await this.pool.query(
          `UPDATE provider_attempts SET status = 'UNKNOWN', completed_at = now(), updated_at = now(),
             response_metadata = COALESCE(response_metadata, '{}'::jsonb) || '{"errorCode":"WORKER_LOST_OUTCOME_UNKNOWN","simulated":true}'::jsonb
           WHERE operation_id = $1 AND institution_id = $2 AND environment_id = $3 AND status IN ('CREATED', 'SUBMITTED')`,
          [operation.id, context.institutionId, context.environmentId],
        );
        await this.pool.query(
          `UPDATE provider_operations SET status = 'UNKNOWN', retry_disposition = 'DO_NOT_RETRY',
             updated_at = now(), completed_at = now(), metadata = metadata || '{"reconciliationRequired":true}'::jsonb
           WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'PROCESSING'`,
          [operation.id, context.institutionId, context.environmentId],
        );
        return this.getOperation(context, operation.id, true);
      }
      const reclaimed = await this.pool.query(
        `UPDATE provider_operations SET updated_at = now() WHERE id = $1 AND institution_id = $2
         AND environment_id = $3 AND status = 'PROCESSING' AND updated_at = $4`,
        [operation.id, context.institutionId, context.environmentId, operation.updated_at],
      );
      if (reclaimed.rowCount !== 1) return this.getOperation(context, operation.id, true);
      isNewOperation = true;
    }
    if (operation.status === 'FAILED' && operation.retry_disposition !== 'SAFE_TO_RETRY') return this.getOperation(context, operation.id, true);
    if (operation.status === 'FAILED' && operation.next_attempt_at && operation.next_attempt_at > new Date()) {
      return this.getOperation(context, operation.id, true);
    }
    if (operation.status === 'FAILED') {
      const claimed = await this.pool.query(
        `UPDATE provider_operations SET status = 'PROCESSING', next_attempt_at = NULL, updated_at = now()
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'FAILED'
           AND retry_disposition = 'SAFE_TO_RETRY' AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
        [operation.id, context.institutionId, context.environmentId],
      );
      if (claimed.rowCount !== 1) return this.getOperation(context, operation.id, true);
    }

    const history = await this.pool.query<{ stage: CorridorStage; status: string; retry_disposition: string; attempt_number: number }>(
      `SELECT request_metadata->>'stage' AS stage, status, response_metadata->>'retryDisposition' AS retry_disposition, attempt_number
       FROM provider_attempts WHERE operation_id = $1 AND institution_id = $2 AND environment_id = $3
       ORDER BY attempt_number`, [operation.id, context.institutionId, context.environmentId],
    );
    const latestByStage = new Map<CorridorStage, typeof history.rows[number]>();
    for (const row of history.rows) latestByStage.set(row.stage, row);
    const firstIncompleteIndex = STAGES.findIndex((stage) => latestByStage.get(stage)?.status !== 'SUCCEEDED');
    if (firstIncompleteIndex < 0) return this.completeOperation(context, operation.id, 'SUCCEEDED', 'NOT_APPLICABLE', null, true);
    const stages = STAGES.slice(firstIncompleteIndex);

    let terminalStatus: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' = 'SUCCEEDED';
    let retryDisposition: 'SAFE_TO_RETRY' | 'DO_NOT_RETRY' | 'NOT_APPLICABLE' = 'NOT_APPLICABLE';
    let failedAt: CorridorStage | null = null;
    for (const stage of stages) {
      const previous = latestByStage.get(stage);
      if (previous?.status === 'FAILED' && previous.retry_disposition !== 'SAFE_TO_RETRY') {
        terminalStatus = 'FAILED'; failedAt = stage; retryDisposition = 'DO_NOT_RETRY'; break;
      }
      const attemptNumber = history.rows.filter((row) => row.stage === stage).length + 1;
      if (attemptNumber > 3) {
        return this.completeOperation(context, operation.id, 'FAILED', 'DO_NOT_RETRY', null, false, stage);
      }
      const attempt = await this.createAttempt(input, operation.id, stage, attemptNumber);
      const result = await this.adapter.runStage({
        context, stage, sourceAssetCode: input.sourceAssetCode, destinationAssetCode: input.destinationAssetCode,
        sourceAmountMinor: input.sourceAmountMinor, attemptNumber, scenario, failAt: input.failAt,
      });
      const status = result.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
      await this.pool.query(
        `UPDATE provider_attempts SET status = $1, provider_reference = $2,
          settlement_asset_code = $3, settlement_amount_minor = $4, response_metadata = $5::jsonb,
          completed_at = now(), updated_at = now()
         WHERE id = $6 AND operation_id = $7 AND transaction_id = $8 AND institution_id = $9 AND environment_id = $10`,
        [status, result.providerReference, result.assetCode, result.amountMinor,
          JSON.stringify({ ...result, simulated: true, noFundsMoved: true }), attempt.id, operation.id,
          context.transactionId, context.institutionId, context.environmentId],
      );
      latestByStage.set(stage, { stage, status, retry_disposition: result.retryDisposition, attempt_number: attemptNumber });
      history.rows.push({ stage, status, retry_disposition: result.retryDisposition, attempt_number: attemptNumber });
      if (result.outcome === 'UNKNOWN') {
        terminalStatus = 'UNKNOWN'; failedAt = stage; retryDisposition = 'DO_NOT_RETRY'; break;
      }
      if (result.outcome === 'FAILED') {
        failedAt = stage; retryDisposition = result.retryDisposition;
        if (stage === 'PAYOUT' && scenario === 'FAIL_PAYOUT_AND_REVERSE') {
          const reversalAttemptNo = history.rows.filter((row) => row.stage === 'REVERSAL').length + 1;
          const reversalAttempt = await this.createAttempt(input, operation.id, 'REVERSAL', reversalAttemptNo);
          const reversal = await this.adapter.runStage({
            context, stage: 'REVERSAL', sourceAssetCode: input.sourceAssetCode, destinationAssetCode: input.destinationAssetCode,
            sourceAmountMinor: input.sourceAmountMinor, attemptNumber: reversalAttemptNo, scenario, failAt: input.failAt,
          });
          await this.updateAttemptResult(reversalAttempt.id, operation.id, input, reversal);
        }
        terminalStatus = 'FAILED';
        break;
      }
    }
    const nextAttempt = retryDisposition === 'SAFE_TO_RETRY' ? new Date(Date.now() + 1000) : null;
    return this.completeOperation(context, operation.id, terminalStatus, retryDisposition, nextAttempt, false, failedAt);
  }

  private async createAttempt(input: SandboxCorridorInput, operationId: string, stage: CorridorStage, stageAttempt: number) {
    const client = await this.pool.connect();
    let attemptNumber: number;
    let attemptId = '';
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id FROM financial_transactions WHERE id = $1 AND institution_id = $2 AND environment_id = $3 FOR UPDATE`,
        [input.context.transactionId, input.context.institutionId, input.context.environmentId],
      );
      if (locked.rowCount !== 1) throw new NotFoundException('Transaction not found in the requested tenant environment');
      const number = await client.query<{ attempt_number: number }>(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number FROM provider_attempts
         WHERE transaction_id = $1 AND institution_id = $2 AND environment_id = $3 AND provider_code = $4`,
        [input.context.transactionId, input.context.institutionId, input.context.environmentId, this.adapter.code],
      );
      attemptNumber = Number(number.rows[0].attempt_number);
      const idempotencyKey = `${operationId}:${stage.toLowerCase()}:${stageAttempt}`;
      const request = { stage, sourceAssetCode: input.sourceAssetCode, destinationAssetCode: input.destinationAssetCode,
        amountMinor: input.sourceAmountMinor, simulated: true };
      const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      const result = await client.query<{ id: string }>(
        `INSERT INTO provider_attempts (institution_id, environment_id, transaction_id, provider_code,
          attempt_number, idempotency_key, request_hash, status, request_metadata, operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CREATED',$8::jsonb,$9) RETURNING id`,
        [input.context.institutionId, input.context.environmentId, input.context.transactionId, this.adapter.code,
          attemptNumber, idempotencyKey, requestHash, JSON.stringify({ ...request, stageAttempt }), operationId],
      );
      attemptId = result.rows[0].id;
      await client.query(
        `UPDATE provider_operations SET updated_at = now()
         WHERE id = $1 AND transaction_id = $2 AND institution_id = $3 AND environment_id = $4 AND status = 'PROCESSING'`,
        [operationId, input.context.transactionId, input.context.institutionId, input.context.environmentId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return { id: attemptId, attemptNumber };
  }

  private async updateAttemptResult(attemptId: string, operationId: string, input: SandboxCorridorInput,
    result: Awaited<ReturnType<KesUsdcSandboxAdapter['runStage']>>) {
    await this.pool.query(
      `UPDATE provider_attempts SET status = $1, provider_reference = $2, settlement_asset_code = $3,
        settlement_amount_minor = $4, response_metadata = $5::jsonb, completed_at = now(), updated_at = now()
       WHERE id = $6 AND operation_id = $7 AND transaction_id = $8 AND institution_id = $9 AND environment_id = $10`,
      [result.outcome === 'SUCCEEDED' ? 'SUCCEEDED' : result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED',
        result.providerReference, result.assetCode, result.amountMinor,
        JSON.stringify({ ...result, simulated: true, noFundsMoved: true }), attemptId, operationId,
        input.context.transactionId, input.context.institutionId, input.context.environmentId],
    );
  }

  private async completeOperation(context: ProviderContext, operationId: string, status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN',
    disposition: 'SAFE_TO_RETRY' | 'DO_NOT_RETRY' | 'NOT_APPLICABLE', nextAttemptAt: Date | null, replayed: boolean, failedAt?: CorridorStage | null) {
    const updated = await this.pool.query(
      `UPDATE provider_operations SET status = $1, retry_disposition = $2, next_attempt_at = $3,
        metadata = metadata || $4::jsonb, updated_at = now(), completed_at = now()
       WHERE id = $5 AND transaction_id = $6 AND institution_id = $7 AND environment_id = $8 AND status = 'PROCESSING'`,
      [status, disposition, nextAttemptAt, JSON.stringify({ failedAt: failedAt ?? null, simulated: true, noFundsMoved: true }),
        operationId, context.transactionId, context.institutionId, context.environmentId],
    );
    if (updated.rowCount !== 1) throw new NotFoundException('Provider operation not found in the requested tenant environment');
    return this.getOperation(context, operationId, replayed);
  }

  private async getOperation(context: ProviderContext, operationId: string, replayed: boolean) {
    const result = await this.pool.query(
      `SELECT id, provider_code, status, retry_disposition, next_attempt_at, metadata, created_at, completed_at
       FROM provider_operations WHERE id = $1 AND transaction_id = $2 AND institution_id = $3 AND environment_id = $4`,
      [operationId, context.transactionId, context.institutionId, context.environmentId],
    );
    const operation = result.rows[0];
    if (!operation) throw new NotFoundException('Provider operation not found');
    const attempts = await this.pool.query(
      `SELECT id, attempt_number, status, provider_reference, request_metadata, response_metadata, created_at, completed_at
       FROM provider_attempts WHERE operation_id = $1 AND transaction_id = $2 AND institution_id = $3 AND environment_id = $4
       ORDER BY attempt_number`, [operationId, context.transactionId, context.institutionId, context.environmentId],
    );
    return { ...operation, attempts: attempts.rows, replayed, simulated: true, noFundsMoved: true,
      reconciliationRequired: operation.status === 'UNKNOWN' };
  }
}
