import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';

export const FORWARD_WORKFLOW_STEPS = [
  'quote_accepted', 'funding_confirmed', 'compliance_cleared', 'approval_cleared',
  'conversion_executed', 'payout_executed', 'settled',
] as const;
export const COMPENSATION_WORKFLOW_STEPS = [
  'compensate_quote_accepted', 'compensate_funding_confirmed', 'compensate_compliance_cleared',
  'compensate_approval_cleared', 'compensate_conversion_executed', 'compensate_payout_executed',
  'compensate_settled',
] as const;
export type WorkflowStepKey = typeof FORWARD_WORKFLOW_STEPS[number] | typeof COMPENSATION_WORKFLOW_STEPS[number];
export type WorkflowScope = { institutionId: string; environmentId: string };
export type WorkflowStepPolicy = { timeoutMs: number; maxAttempts: number; retryPolicy: Record<string, unknown> };
export type WorkflowPolicy = { version: string; steps: Record<WorkflowStepKey, WorkflowStepPolicy> };
export type WorkflowOutcome =
  | { kind: 'DEFINITE_SUCCESS'; providerReference?: string | null; evidence?: Record<string, unknown> }
  | { kind: 'DEFINITE_FAILURE'; retryDisposition: 'SAFE_TO_RETRY' | 'DO_NOT_RETRY'; reason: string; evidence?: Record<string, unknown> }
  | { kind: 'UNKNOWN'; reason: string; evidence?: Record<string, unknown> };

const COMPENSATES: Record<(typeof FORWARD_WORKFLOW_STEPS)[number], (typeof COMPENSATION_WORKFLOW_STEPS)[number]> = {
  quote_accepted: 'compensate_quote_accepted', funding_confirmed: 'compensate_funding_confirmed',
  compliance_cleared: 'compensate_compliance_cleared', approval_cleared: 'compensate_approval_cleared',
  conversion_executed: 'compensate_conversion_executed', payout_executed: 'compensate_payout_executed',
  settled: 'compensate_settled',
};

@Injectable()
export class TransferWorkflowService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async create(input: {
    scope: WorkflowScope; transactionId: string; idempotencyKey: string;
    policy: WorkflowPolicy; simulated: boolean; actorId?: string;
  }) {
    this.validatePolicy(input.policy);
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255) throw new BadRequestException('A workflow idempotency key is required');
    const policyJson = JSON.stringify(input.policy);
    const policyHash = createHash('sha256').update(policyJson).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify({ transactionId: input.transactionId, policyHash, simulated: input.simulated })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const transaction = await client.query<{ id: string; environment: string; status: string; asset_code: string; destination_asset_code: string | null; quote_id: string | null }>(
        `SELECT t.id, t.status, t.asset_code, t.destination_asset_code, t.quote_id, e.environment FROM financial_transactions t JOIN institution_environments e
           ON e.id = t.environment_id AND e.institution_id = t.institution_id
         WHERE t.id = $1 AND t.institution_id = $2 AND t.environment_id = $3 FOR UPDATE OF t`,
        [input.transactionId, input.scope.institutionId, input.scope.environmentId],
      );
      if (!transaction.rowCount) throw new NotFoundException('Transaction not found in the requested tenant environment');
      if (transaction.rows[0].environment !== 'SANDBOX' || !input.simulated) throw new ConflictException('Provider transfer workflows are sandbox-only until live execution is explicitly enabled');
      if (transaction.rows[0].status !== 'QUOTED' || !transaction.rows[0].quote_id ||
        !['KES', 'USDC'].includes(transaction.rows[0].asset_code) || !['KES', 'USDC'].includes(transaction.rows[0].destination_asset_code ?? '') ||
        transaction.rows[0].asset_code === transaction.rows[0].destination_asset_code) {
        throw new ConflictException('A KES/USDC transaction with an accepted quote is required to start this workflow');
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO transfer_workflows
          (institution_id, environment_id, transaction_id, policy_version, policy_snapshot, policy_hash,
           idempotency_key, request_hash, simulated)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [input.scope.institutionId, input.scope.environmentId, input.transactionId, input.policy.version,
          policyJson, policyHash, input.idempotencyKey, requestHash, input.simulated],
      );
      const workflow = inserted.rows[0] ?? (await client.query<{ id: string; request_hash: string }>(
        `SELECT id, request_hash FROM transfer_workflows
         WHERE institution_id = $1 AND environment_id = $2 AND transaction_id = $3 AND workflow_type = 'KES_USDC_OFFRAMP' FOR UPDATE`,
        [input.scope.institutionId, input.scope.environmentId, input.transactionId],
      )).rows[0];
      if (!workflow) throw new ConflictException('Workflow could not be initialized');
      const existing = await client.query<{ request_hash: string }>(
        `SELECT request_hash FROM transfer_workflows WHERE id = $1`, [workflow.id],
      );
      if (existing.rows[0].request_hash !== requestHash) throw new ConflictException('A workflow already exists with different request or policy data');
      if (inserted.rows.length) {
        const ids = new Map<string, string>();
        for (let i = 0; i < FORWARD_WORKFLOW_STEPS.length; i++) {
          const key = FORWARD_WORKFLOW_STEPS[i];
          const policy = input.policy.steps[key];
          const result = await client.query<{ id: string }>(
            `INSERT INTO transfer_workflow_steps
              (workflow_id, institution_id, environment_id, step_key, step_kind, ordinal, status,
               idempotency_key, retry_policy, timeout_ms, max_attempts)
             VALUES ($1,$2,$3,$4,'FORWARD',$5,$6,$7,$8::jsonb,$9,$10) RETURNING id`,
            [workflow.id, input.scope.institutionId, input.scope.environmentId, key, i + 1,
              i === 0 ? 'READY' : 'BLOCKED', `${workflow.id}:${key}:1`, JSON.stringify(policy.retryPolicy), policy.timeoutMs, policy.maxAttempts],
          );
          ids.set(key, result.rows[0].id);
        }
        for (let i = 0; i < COMPENSATION_WORKFLOW_STEPS.length; i++) {
          const key = COMPENSATION_WORKFLOW_STEPS[i];
          const forward = FORWARD_WORKFLOW_STEPS[i];
          const policy = input.policy.steps[key];
          const result = await client.query<{ id: string }>(
            `INSERT INTO transfer_workflow_steps
              (workflow_id, institution_id, environment_id, step_key, step_kind, ordinal, status,
               compensates_step_id, idempotency_key, retry_policy, timeout_ms, max_attempts)
             VALUES ($1,$2,$3,$4,'COMPENSATION',$5,'BLOCKED',$6,$7,$8::jsonb,$9,$10) RETURNING id`,
            [workflow.id, input.scope.institutionId, input.scope.environmentId, key, 101 + i, ids.get(forward),
              `${workflow.id}:${key}:1`, JSON.stringify(policy.retryPolicy), policy.timeoutMs, policy.maxAttempts],
          );
          ids.set(key, result.rows[0].id);
        }
        for (let i = 1; i < FORWARD_WORKFLOW_STEPS.length; i++) {
          await client.query(`UPDATE transfer_workflow_steps SET depends_on_step_id = $1 WHERE id = $2`,
            [ids.get(FORWARD_WORKFLOW_STEPS[i - 1]), ids.get(FORWARD_WORKFLOW_STEPS[i])]);
        }
        await this.event(client, input.scope, workflow.id, null, 'workflow.created', null, 'RUNNING', 'SYSTEM', input.actorId,
          { policyVersion: input.policy.version, simulated: input.simulated });
      }
      await client.query('COMMIT');
      return this.get(input.scope, workflow.id);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async claimNext(scope: WorkflowScope, workerId: string) {
    if (!workerId.trim() || workerId.length > 120) throw new BadRequestException('A valid worker ID is required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<any>(
        `SELECT s.*, w.id AS workflow_ref FROM transfer_workflow_steps s
         JOIN transfer_workflows w ON w.id = s.workflow_id AND w.institution_id = s.institution_id AND w.environment_id = s.environment_id
         WHERE s.institution_id = $1 AND s.environment_id = $2
           AND w.status IN ('RUNNING','COMPENSATION_REQUIRED')
           AND (s.status = 'READY' OR (s.status = 'RETRY_WAIT' AND s.next_attempt_at <= now()))
           AND (s.depends_on_step_id IS NULL OR EXISTS (
             SELECT 1 FROM transfer_workflow_steps d WHERE d.id = s.depends_on_step_id
               AND d.workflow_id = s.workflow_id AND d.institution_id = s.institution_id
               AND d.environment_id = s.environment_id AND d.status IN ('SUCCEEDED','COMPENSATED','SKIPPED')))
         ORDER BY w.created_at, s.ordinal LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,
        [scope.institutionId, scope.environmentId],
      );
      const step = row.rows[0];
      if (!step) { await client.query('COMMIT'); return null; }
      if (step.attempt_count >= step.max_attempts) {
        await this.finishStep(client, scope, step, { kind: 'DEFINITE_FAILURE', retryDisposition: 'DO_NOT_RETRY', reason: 'MAX_ATTEMPTS_EXHAUSTED' }, workerId);
        await client.query('COMMIT');
        return null;
      }
      const attemptNumber = step.attempt_count + 1;
      const requestHash = createHash('sha256').update(JSON.stringify({ workflowId: step.workflow_id, stepKey: step.step_key, generation: step.generation })).digest('hex');
      await client.query(
        `UPDATE transfer_workflow_steps SET status = 'RUNNING', attempt_count = $1, request_hash = $2,
         lease_owner = $3, lease_expires_at = now() + ($4::int * interval '1 millisecond'), updated_at = now()
         WHERE id = $5 AND workflow_id = $6 AND institution_id = $7 AND environment_id = $8`,
        [attemptNumber, requestHash, workerId, step.timeout_ms, step.id, step.workflow_id, scope.institutionId, scope.environmentId],
      );
      const attempt = await client.query<{ id: string }>(
        `INSERT INTO transfer_workflow_attempts
          (step_id, workflow_id, institution_id, environment_id, attempt_number, idempotency_key, request_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'SUBMITTED') RETURNING id`,
        [step.id, step.workflow_id, scope.institutionId, scope.environmentId, attemptNumber, step.idempotency_key, requestHash],
      );
      await this.event(client, scope, step.workflow_id, step.id, 'step.claimed', step.status, 'RUNNING', 'WORKER', undefined,
        { workerId, attemptNumber, attemptId: attempt.rows[0].id });
      await client.query('COMMIT');
      return { ...step, status: 'RUNNING', attemptCount: attemptNumber, attemptId: attempt.rows[0].id,
        idempotencyKey: step.idempotency_key, requestHash, simulated: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async recordOutcome(scope: WorkflowScope, stepId: string, attemptId: string, outcome: WorkflowOutcome, actorId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<any>(
        `SELECT s.*, w.id AS workflow_ref FROM transfer_workflow_steps s JOIN transfer_workflows w
          ON w.id = s.workflow_id AND w.institution_id = s.institution_id AND w.environment_id = s.environment_id
         WHERE s.id = $1 AND s.institution_id = $2 AND s.environment_id = $3 FOR UPDATE OF s,w`,
        [stepId, scope.institutionId, scope.environmentId],
      );
      const step = selected.rows[0];
      if (!step) throw new NotFoundException('Workflow step not found in the requested tenant environment');
      if (step.status !== 'RUNNING') throw new ConflictException('Only a running workflow step can accept an execution outcome');
      const attempt = await client.query(
        `SELECT id FROM transfer_workflow_attempts WHERE id = $1 AND step_id = $2 AND workflow_id = $3
          AND institution_id = $4 AND environment_id = $5 AND status = 'SUBMITTED' FOR UPDATE`,
        [attemptId, stepId, step.workflow_id, scope.institutionId, scope.environmentId],
      );
      if (!attempt.rowCount) throw new ConflictException('Workflow attempt is unavailable or already completed');
      await this.finishStep(client, scope, step, outcome, actorId, attemptId);
      await client.query('COMMIT');
      return this.get(scope, step.workflow_id);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async resolveUnknown(scope: WorkflowScope, stepId: string,
    outcome: Extract<WorkflowOutcome, { kind: 'DEFINITE_SUCCESS' | 'DEFINITE_FAILURE' }>, actorId?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<any>(
        `SELECT s.*, w.id AS workflow_ref FROM transfer_workflow_steps s JOIN transfer_workflows w
          ON w.id = s.workflow_id AND w.institution_id = s.institution_id AND w.environment_id = s.environment_id
         WHERE s.id = $1 AND s.institution_id = $2 AND s.environment_id = $3 AND s.status = 'RECONCILIATION_PENDING'
         FOR UPDATE OF s,w`, [stepId, scope.institutionId, scope.environmentId],
      );
      const step = selected.rows[0];
      if (!step) throw new NotFoundException('Uncertain workflow step not found in the requested tenant environment');
      const pending = await client.query<{ id: string }>(
        `SELECT a.id FROM transfer_workflow_attempts a
         JOIN LATERAL (SELECT r.outcome_class FROM transfer_workflow_attempt_results r
           WHERE r.attempt_id = a.id AND r.step_id = a.step_id AND r.workflow_id = a.workflow_id
             AND r.institution_id = a.institution_id AND r.environment_id = a.environment_id
           ORDER BY r.result_number DESC LIMIT 1) latest ON latest.outcome_class = 'UNKNOWN'
         WHERE a.step_id = $1 AND a.workflow_id = $2 AND a.institution_id = $3 AND a.environment_id = $4
         ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE OF a`,
        [step.id, step.workflow_id, scope.institutionId, scope.environmentId],
      );
      if (!pending.rowCount) throw new ConflictException('Unknown step has no unresolved provider attempt');
      await client.query(`UPDATE transfer_workflow_steps SET status = 'RUNNING', updated_at = now()
        WHERE id = $1 AND workflow_id = $2 AND institution_id = $3 AND environment_id = $4`,
        [step.id, step.workflow_id, scope.institutionId, scope.environmentId]);
      await client.query(`UPDATE transfer_workflows SET status = 'RUNNING', version = version + 1, updated_at = now()
        WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
        [step.workflow_id, scope.institutionId, scope.environmentId]);
      await this.finishStep(client, scope, step, outcome, actorId, pending.rows[0].id);
      await this.event(client, scope, step.workflow_id, step.id, 'step.reconciliation_resolved', 'RECONCILIATION_PENDING', outcome.kind === 'DEFINITE_SUCCESS' ? 'SUCCEEDED' : 'FAILED', 'PROVIDER', actorId,
        { providerReference: outcome.kind === 'DEFINITE_SUCCESS' ? outcome.providerReference ?? null : null });
      await client.query('COMMIT');
      return this.get(scope, step.workflow_id);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async recoverExpiredLeases(scope: WorkflowScope) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query<any>(
        `SELECT s.* FROM transfer_workflow_steps s
         WHERE s.institution_id = $1 AND s.environment_id = $2 AND s.status = 'RUNNING'
           AND s.lease_expires_at <= now() FOR UPDATE SKIP LOCKED`, [scope.institutionId, scope.environmentId],
      );
      for (const step of expired.rows) {
        const active = await client.query<{ id: string }>(
          `SELECT id FROM transfer_workflow_attempts WHERE step_id = $1 AND workflow_id = $2
            AND institution_id = $3 AND environment_id = $4 AND status = 'SUBMITTED' FOR UPDATE`,
          [step.id, step.workflow_id, scope.institutionId, scope.environmentId],
        );
        if (!active.rowCount) continue;
        const outcome: WorkflowOutcome = { kind: 'UNKNOWN', reason: 'WORKER_LEASE_EXPIRED_AFTER_SUBMISSION' };
        await this.finishStep(client, scope, step, outcome, undefined, active.rows[0].id);
      }
      await client.query('COMMIT');
      return { recoveredAsUnknown: expired.rowCount };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async get(scope: WorkflowScope, workflowId: string) {
    const workflow = await this.pool.query(
      `SELECT id, transaction_id, workflow_type, status, policy_version, policy_hash, simulated, version, created_at, updated_at, completed_at
       FROM transfer_workflows WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [workflowId, scope.institutionId, scope.environmentId],
    );
    if (!workflow.rowCount) throw new NotFoundException('Workflow not found in the requested tenant environment');
    const steps = await this.pool.query(
      `SELECT id, step_key, step_kind, ordinal, status, depends_on_step_id, compensates_step_id,
        attempt_count, max_attempts, timeout_ms, retry_disposition, next_attempt_at, unknown_since,
        provider_reference, result, terminal_reason, created_at, updated_at, completed_at
       FROM transfer_workflow_steps WHERE workflow_id = $1 AND institution_id = $2 AND environment_id = $3 ORDER BY ordinal`,
      [workflowId, scope.institutionId, scope.environmentId],
    );
    return { ...workflow.rows[0], steps: steps.rows, noFundsMoved: workflow.rows[0].simulated };
  }

  private async finishStep(client: PoolClient, scope: WorkflowScope, step: any, outcome: WorkflowOutcome, actorId?: string, attemptId?: string) {
    const result = JSON.stringify(outcome.evidence ?? {});
    if (attemptId) await client.query(
      `INSERT INTO transfer_workflow_attempt_results
        (attempt_id, step_id, workflow_id, institution_id, environment_id, result_number, outcome_class, provider_reference, outcome)
       SELECT $1,$2,$3,$4,$5,COALESCE(MAX(result_number),0)+1,$6,$7,$8::jsonb
       FROM transfer_workflow_attempt_results WHERE attempt_id = $1 AND step_id = $2 AND workflow_id = $3
         AND institution_id = $4 AND environment_id = $5`,
      [attemptId, step.id, step.workflow_id, scope.institutionId, scope.environmentId,
        outcome.kind === 'DEFINITE_SUCCESS' ? 'DEFINITE_SUCCESS' : outcome.kind === 'UNKNOWN' ? 'UNKNOWN' : 'DEFINITE_FAILURE',
        outcome.kind === 'DEFINITE_SUCCESS' ? outcome.providerReference ?? null : null, result],
    );
    if (outcome.kind === 'UNKNOWN') {
      await client.query(
        `UPDATE transfer_workflow_steps SET status = 'RECONCILIATION_PENDING', retry_disposition = 'DO_NOT_RETRY',
          unknown_since = now(), lease_owner = NULL, lease_expires_at = NULL, result = $1::jsonb,
          terminal_reason = $2, updated_at = now() WHERE id = $3 AND workflow_id = $4 AND institution_id = $5 AND environment_id = $6`,
        [result, outcome.reason, step.id, step.workflow_id, scope.institutionId, scope.environmentId],
      );
      await client.query(`UPDATE transfer_workflows SET status = 'WAITING_RECONCILIATION', version = version + 1, updated_at = now()
        WHERE id = $1 AND institution_id = $2 AND environment_id = $3`, [step.workflow_id, scope.institutionId, scope.environmentId]);
      await this.event(client, scope, step.workflow_id, step.id, 'step.outcome_unknown', 'RUNNING', 'RECONCILIATION_PENDING', 'SYSTEM', actorId, { reason: outcome.reason });
      return;
    }
    if (outcome.kind === 'DEFINITE_FAILURE') {
      const retryPolicy = step.retry_policy as { retryableErrorCodes?: string[]; backoffMs?: number };
      const retry = outcome.retryDisposition === 'SAFE_TO_RETRY' &&
        Array.isArray(retryPolicy.retryableErrorCodes) && retryPolicy.retryableErrorCodes.includes(outcome.reason) &&
        step.attempt_count < step.max_attempts;
      const status = retry ? 'RETRY_WAIT' : 'FAILED';
      await client.query(
        `UPDATE transfer_workflow_steps SET status = $1, retry_disposition = $2,
          next_attempt_at = CASE WHEN $1 = 'RETRY_WAIT' THEN now() + ($5::int * interval '1 millisecond') ELSE NULL END,
          lease_owner = NULL, lease_expires_at = NULL, result = $3::jsonb, terminal_reason = $4,
          updated_at = now(), completed_at = CASE WHEN $1 = 'FAILED' THEN now() ELSE NULL END
         WHERE id = $6 AND workflow_id = $7 AND institution_id = $8 AND environment_id = $9`,
        [status, retry ? 'SAFE_TO_RETRY' : 'DO_NOT_RETRY', result, outcome.reason, retryPolicy.backoffMs ?? 0, step.id, step.workflow_id, scope.institutionId, scope.environmentId],
      );
      const hasCompensation = !retry ? await this.activateCompensation(client, scope, step.workflow_id) : false;
      const workflowStatus = retry ? 'RUNNING' : hasCompensation ? 'COMPENSATION_REQUIRED' : 'FAILED';
      await client.query(`UPDATE transfer_workflows SET status = $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND institution_id = $3 AND environment_id = $4`, [workflowStatus, step.workflow_id, scope.institutionId, scope.environmentId]);
      await this.event(client, scope, step.workflow_id, step.id, 'step.definite_failure', 'RUNNING', status, 'SYSTEM', actorId, { reason: outcome.reason, retryDisposition: outcome.retryDisposition });
      return;
    }
    await client.query(
      `UPDATE transfer_workflow_steps SET status = $1, retry_disposition = 'NOT_APPLICABLE',
        provider_reference = $2, result = $3::jsonb, lease_owner = NULL, lease_expires_at = NULL,
        unknown_since = NULL, terminal_reason = NULL, updated_at = now(), completed_at = now()
       WHERE id = $4 AND workflow_id = $5 AND institution_id = $6 AND environment_id = $7`,
      [step.step_kind === 'COMPENSATION' ? 'COMPENSATED' : 'SUCCEEDED', outcome.providerReference ?? null, result, step.id, step.workflow_id, scope.institutionId, scope.environmentId],
    );
    if (step.step_kind === 'COMPENSATION' && step.compensates_step_id) {
      await client.query(`UPDATE transfer_workflow_steps SET status = 'COMPENSATED', updated_at = now(), completed_at = now()
        WHERE id = $1 AND workflow_id = $2 AND institution_id = $3 AND environment_id = $4`,
        [step.compensates_step_id, step.workflow_id, scope.institutionId, scope.environmentId]);
      await this.activateCompensation(client, scope, step.workflow_id);
    } else {
      await client.query(
        `UPDATE transfer_workflow_steps SET status = 'READY', updated_at = now()
         WHERE depends_on_step_id = $1 AND workflow_id = $2 AND institution_id = $3 AND environment_id = $4 AND status = 'BLOCKED'`,
        [step.id, step.workflow_id, scope.institutionId, scope.environmentId],
      );
    }
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transfer_workflow_steps WHERE workflow_id = $1 AND institution_id = $2 AND environment_id = $3 AND step_kind = 'FORWARD' AND status <> 'SUCCEEDED'`,
      [step.workflow_id, scope.institutionId, scope.environmentId],
    );
    const allCompensated = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transfer_workflow_steps c JOIN transfer_workflow_steps f
        ON f.id = c.compensates_step_id AND f.workflow_id = c.workflow_id
         AND f.institution_id = c.institution_id AND f.environment_id = c.environment_id
       WHERE c.workflow_id = $1 AND c.institution_id = $2 AND c.environment_id = $3
         AND c.step_kind = 'COMPENSATION' AND f.status IN ('SUCCEEDED','COMPENSATED')
         AND c.status NOT IN ('COMPENSATED','SKIPPED')`,
      [step.workflow_id, scope.institutionId, scope.environmentId],
    );
    const wstatus = Number(remaining.rows[0].count) === 0 ? 'SETTLED' : step.step_kind === 'COMPENSATION' && Number(allCompensated.rows[0].count) === 0 ? 'RECOVERY_COMPLETE' : step.step_kind === 'COMPENSATION' ? 'COMPENSATION_REQUIRED' : 'RUNNING';
    await client.query(`UPDATE transfer_workflows SET status = $1, version = version + 1, updated_at = now(), completed_at = CASE WHEN $1 IN ('SETTLED','RECOVERY_COMPLETE') THEN now() ELSE NULL END
      WHERE id = $2 AND institution_id = $3 AND environment_id = $4`, [wstatus, step.workflow_id, scope.institutionId, scope.environmentId]);
    await this.event(client, scope, step.workflow_id, step.id, step.step_kind === 'COMPENSATION' ? 'step.compensated' : 'step.succeeded', 'RUNNING', step.step_kind === 'COMPENSATION' ? 'COMPENSATED' : 'SUCCEEDED', 'SYSTEM', actorId,
      { providerReference: outcome.providerReference ?? null });
  }

  private async activateCompensation(client: any, scope: WorkflowScope, workflowId: string): Promise<boolean> {
    const previous = await client.query(
      `SELECT c.id FROM transfer_workflow_steps c JOIN transfer_workflow_steps f
         ON f.id = c.compensates_step_id AND f.workflow_id = c.workflow_id
          AND f.institution_id = c.institution_id AND f.environment_id = c.environment_id
       WHERE c.workflow_id = $1 AND c.institution_id = $2 AND c.environment_id = $3
         AND c.step_kind = 'COMPENSATION' AND c.status = 'BLOCKED' AND f.status = 'SUCCEEDED'
         AND NOT EXISTS (
           SELECT 1 FROM transfer_workflow_steps later_comp
           JOIN transfer_workflow_steps later_forward ON later_forward.id = later_comp.compensates_step_id
             AND later_forward.workflow_id = later_comp.workflow_id AND later_forward.institution_id = later_comp.institution_id
             AND later_forward.environment_id = later_comp.environment_id
           WHERE later_comp.workflow_id = c.workflow_id AND later_comp.institution_id = c.institution_id
             AND later_comp.environment_id = c.environment_id AND later_forward.status = 'SUCCEEDED'
             AND later_forward.ordinal > f.ordinal AND later_comp.status NOT IN ('COMPENSATED','SKIPPED'))
       ORDER BY f.ordinal DESC LIMIT 1 FOR UPDATE OF c`, [workflowId, scope.institutionId, scope.environmentId],
    );
    if (previous.rows[0]) await client.query(
      `UPDATE transfer_workflow_steps SET status = 'READY', updated_at = now()
       WHERE id = $1 AND workflow_id = $2 AND institution_id = $3 AND environment_id = $4 AND status = 'BLOCKED'`,
      [previous.rows[0].id, workflowId, scope.institutionId, scope.environmentId],
    );
    return previous.rowCount === 1;
  }

  private async event(client: PoolClient, scope: WorkflowScope, workflowId: string, stepId: string | null,
    type: string, from: string | null, to: string | null, actorType: string, actorId: string | undefined,
    metadata: Record<string, unknown>) {
    const next = await client.query<{ sequence: string }>(
      `SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM transfer_workflow_events WHERE workflow_id = $1 AND institution_id = $2 AND environment_id = $3`,
      [workflowId, scope.institutionId, scope.environmentId],
    );
    await client.query(
      `INSERT INTO transfer_workflow_events
        (workflow_id, step_id, institution_id, environment_id, sequence, event_type, from_status, to_status, actor_type, actor_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [workflowId, stepId, scope.institutionId, scope.environmentId, next.rows[0].sequence, type, from, to, actorType, actorId ?? null, JSON.stringify(metadata)],
    );
  }

  private validatePolicy(policy: WorkflowPolicy) {
    if (!policy.version || policy.version.length > 80) throw new BadRequestException('A versioned workflow policy is required');
    const keys = [...FORWARD_WORKFLOW_STEPS, ...COMPENSATION_WORKFLOW_STEPS];
    for (const key of keys) {
      const item = policy.steps?.[key];
      const retryPolicy = item?.retryPolicy as { retryableErrorCodes?: unknown; backoffMs?: unknown } | undefined;
      if (!item || !Number.isInteger(item.timeoutMs) || item.timeoutMs < 1 || !Number.isInteger(item.maxAttempts) || item.maxAttempts < 1 ||
        !retryPolicy || !Array.isArray(retryPolicy.retryableErrorCodes) || !Number.isInteger(retryPolicy.backoffMs) || Number(retryPolicy.backoffMs) < 0) {
        throw new BadRequestException(`Workflow policy is missing valid timeout, retry policy, or max attempts for ${key}`);
      }
    }
  }
}
