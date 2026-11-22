import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { TransactionStatus } from './transactions.service';

type SandboxComplianceOutcome = 'ALLOW' | 'DENY' | 'REVIEW';

@Injectable()
export class SandboxSimulationService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  async fundAndScreen(institutionId: string, environmentId: string, transactionId: string) {
    const outcome = this.config.get<SandboxComplianceOutcome>('SANDBOX_COMPLIANCE_OUTCOME', 'REVIEW');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ status: TransactionStatus; environment: string }>(
        `SELECT t.status, e.environment
         FROM financial_transactions t
         JOIN institution_environments e ON e.id = t.environment_id AND e.institution_id = t.institution_id
         WHERE t.id = $1 AND t.institution_id = $2 AND t.environment_id = $3
         FOR UPDATE OF t`,
        [transactionId, institutionId, environmentId],
      );
      const transaction = result.rows[0];
      if (!transaction) throw new ConflictException('Transaction not found');
      if (transaction.environment !== 'SANDBOX') throw new ForbiddenException('Sandbox simulation is only available in the sandbox environment');

      const sequence: TransactionStatus[] = ['QUOTED', 'AWAITING_FUNDING', 'FUNDED', 'COMPLIANCE_PENDING'];
      let status = transaction.status;
      if (status !== 'COMPLIANCE_PENDING') {
        const currentIndex = status === 'CREATED' ? -1 : sequence.indexOf(status);
        if (status !== 'CREATED' && currentIndex === -1) throw new BadRequestException(`Sandbox funding simulation cannot continue from ${status}`);
        for (const nextStatus of sequence.slice(currentIndex + 1)) {
          await this.recordTransition(client, institutionId, environmentId, transactionId, status, nextStatus);
          status = nextStatus;
        }
      }
      if (status !== 'COMPLIANCE_PENDING') {
        throw new BadRequestException(`Sandbox funding simulation cannot continue from ${status}`);
      }

      const decision = await client.query<{ id: string }>(
        `INSERT INTO transaction_compliance_decisions
          (transaction_id, institution_id, environment_id, check_type, provider_code, decision, decision_mode, reason_code)
         VALUES ($1, $2, $3, 'TRANSACTION_ELIGIBILITY', 'sandbox_simulated_policy', $4, 'SANDBOX_SIMULATED', 'SANDBOX_DEMO')
         RETURNING id`,
        [transactionId, institutionId, environmentId, outcome],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'compliance.sandbox_simulated', 'financial_transaction', $2, $3::jsonb)`,
        [institutionId, transactionId, JSON.stringify({ decision: outcome, decisionId: decision.rows[0].id })],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'financial_transaction', $3, 'transaction.compliance_decided', $4::jsonb)`,
        [institutionId, environmentId, transactionId, JSON.stringify({ transactionId, decision: outcome, mode: 'SANDBOX_SIMULATED' })],
      );

      if (outcome === 'ALLOW' || outcome === 'DENY') {
        const finalStatus: TransactionStatus = outcome === 'ALLOW' ? 'APPROVED' : 'FAILED';
        await this.recordTransition(client, institutionId, environmentId, transactionId, status, finalStatus, `SANDBOX_${outcome}`);
        status = finalStatus;
      }
      await client.query('COMMIT');
      return { transactionId, status, complianceDecision: outcome, mode: 'SANDBOX_SIMULATED' as const };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordTransition(
    client: import('pg').PoolClient,
    institutionId: string,
    environmentId: string,
    transactionId: string,
    fromStatus: TransactionStatus,
    toStatus: TransactionStatus,
    reasonCode?: string,
  ) {
    const updated = await client.query(`UPDATE financial_transactions SET status = $3 WHERE id = $1 AND institution_id = $2 AND environment_id = $4`,
      [transactionId, institutionId, toStatus, environmentId]);
    if (updated.rowCount !== 1) throw new ConflictException('Transaction environment changed during sandbox simulation');
    await client.query(
      `INSERT INTO transaction_transitions (transaction_id, institution_id, from_status, to_status, reason_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, institutionId, fromStatus, toStatus, reasonCode ?? null],
    );
    await client.query(
      `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, 'financial_transaction', $3, 'transaction.status_changed', $4::jsonb)`,
      [institutionId, environmentId, transactionId, JSON.stringify({ transactionId, fromStatus, status: toStatus, simulated: true })],
    );
  }
}
