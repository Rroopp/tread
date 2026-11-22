import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { CreateAccountDto } from './accounts.dto';
import { UserPrincipal } from '../identity/api-key.types';

interface AccountRow {
  id: string;
  account_ref: string;
  asset_code: string;
  account_type: 'CUSTOMER' | 'SETTLEMENT' | 'FEE' | 'SUSPENSE';
  normal_balance: 'DEBIT' | 'CREDIT';
  status: 'OPEN' | 'FROZEN' | 'CLOSED';
  created_at: Date;
  debit_minor: string;
  credit_minor: string;
  active_hold_minor: string;
}

@Injectable()
export class AccountsService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async dashboardList(institutionId: string) {
    const environment = await this.dashboardEnvironment(institutionId);
    return environment ? { environment: environment.environment, ...(await this.list(institutionId, environment.id)) } : { environment: null, accounts: [] };
  }

  async dashboardCreate(principal: UserPrincipal, input: CreateAccountDto) {
    const environment = await this.dashboardEnvironment(principal.institutionId);
    if (!environment) throw new ConflictException('No active institution environment is available');
    return this.create(principal.institutionId, environment.id, input);
  }

  async dashboardFind(institutionId: string, accountId: string) {
    const environment = await this.dashboardEnvironment(institutionId);
    if (!environment) throw new NotFoundException('Account not found');
    return this.find(institutionId, environment.id, accountId);
  }

  private async dashboardEnvironment(institutionId: string) {
    const result = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [institutionId],
    );
    return result.rows[0] ?? null;
  }

  async create(institutionId: string, environmentId: string, input: CreateAccountDto) {
    const client = await this.pool.connect();
    const normalBalance = input.accountType === 'FEE' ? 'CREDIT' : 'DEBIT';
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO accounts (institution_id, environment_id, account_ref, asset_code, account_type, normal_balance)
         SELECT i.id, e.id, $3, a.code, $4, $6
         FROM institutions i
         JOIN institution_environments e ON e.institution_id = i.id
         JOIN assets a ON a.code = $5 AND a.enabled = true
         WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.id = $2 AND e.status = 'ACTIVE'
         RETURNING id`,
        [institutionId, environmentId, input.accountRef, input.accountType, input.assetCode, normalBalance],
      );
      const accountId = result.rows[0]?.id;
      if (!accountId) throw new ConflictException('Institution, environment, or asset is not enabled');

      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'account.created', 'account', $2, $3::jsonb)`,
        [institutionId, accountId, JSON.stringify({ accountRef: input.accountRef, assetCode: input.assetCode, accountType: input.accountType })],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'account', $3, 'account.created', $4::jsonb)`,
        [institutionId, environmentId, accountId, JSON.stringify({ accountId, accountRef: input.accountRef, assetCode: input.assetCode, accountType: input.accountType })],
      );
      await client.query('COMMIT');
      return { id: accountId, accountRef: input.accountRef, assetCode: input.assetCode, accountType: input.accountType, normalBalance, status: 'OPEN' as const, replayed: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      if (!this.isUniqueViolation(error)) throw error;
      const existing = await this.pool.query<{ id: string; asset_code: string; account_type: string; normal_balance: 'DEBIT' | 'CREDIT'; status: 'OPEN' | 'FROZEN' | 'CLOSED' }>(
        `SELECT id, asset_code, account_type, normal_balance, status FROM accounts
         WHERE institution_id = $1 AND environment_id = $2 AND account_ref = $3`,
        [institutionId, environmentId, input.accountRef],
      );
      const row = existing.rows[0];
      if (row && row.asset_code === input.assetCode && row.account_type === input.accountType) {
        return { id: row.id, accountRef: input.accountRef, assetCode: input.assetCode, accountType: input.accountType, normalBalance: row.normal_balance, status: row.status, replayed: true };
      }
      throw new ConflictException('Account reference is already in use with different settings');
    } finally {
      client.release();
    }
  }

  async list(institutionId: string, environmentId: string) {
    const result = await this.pool.query<AccountRow>(`${this.accountProjection()}
       WHERE a.institution_id = $1 AND a.environment_id = $2
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 100`, [institutionId, environmentId]);
    return { accounts: result.rows.map((row) => this.mapAccount(row)) };
  }

  async find(institutionId: string, environmentId: string, accountId: string) {
    const result = await this.pool.query<AccountRow>(`${this.accountProjection()}
       WHERE a.institution_id = $1 AND a.environment_id = $2 AND a.id = $3`,
    [institutionId, environmentId, accountId]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Account not found');
    return this.mapAccount(row);
  }

  private accountProjection(): string {
    return `SELECT a.id, a.account_ref, a.asset_code, a.account_type, a.normal_balance, a.status, a.created_at,
       COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
         WHERE le.account_id = a.id AND le.direction = 'DEBIT'), 0)::text AS debit_minor,
       COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le
         WHERE le.account_id = a.id AND le.direction = 'CREDIT'), 0)::text AS credit_minor,
       COALESCE((SELECT SUM(h.amount_minor) FROM account_holds h
         WHERE h.account_id = a.id AND h.status = 'ACTIVE'
           AND (h.expires_at IS NULL OR h.expires_at > now())), 0)::text AS active_hold_minor
       FROM accounts a`;
  }

  private mapAccount(row: AccountRow) {
    return {
      id: row.id,
      accountRef: row.account_ref,
      assetCode: row.asset_code,
      accountType: row.account_type,
      normalBalance: row.normal_balance,
      status: row.status,
      createdAt: row.created_at,
      ledgerTotals: {
        debitMinor: row.debit_minor,
        creditMinor: row.credit_minor,
        activeHoldMinor: row.active_hold_minor,
      },
      balanceMinor: (row.normal_balance === 'DEBIT'
        ? BigInt(row.debit_minor) - BigInt(row.credit_minor)
        : BigInt(row.credit_minor) - BigInt(row.debit_minor)).toString(),
      availableMinor: ((row.normal_balance === 'DEBIT'
        ? BigInt(row.debit_minor) - BigInt(row.credit_minor)
        : BigInt(row.credit_minor) - BigInt(row.debit_minor)) - BigInt(row.active_hold_minor)).toString(),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
