import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';

export type LedgerDirection = 'DEBIT' | 'CREDIT';
const MAX_MINOR_UNITS = 10n ** 38n - 1n;

export interface LedgerPostingLine {
  accountId: string;
  direction: LedgerDirection;
  amountMinor: bigint;
}

export interface PostJournalInput {
  institutionId: string;
  environmentId: string;
  assetCode: string;
  referenceType: string;
  referenceId: string;
  financialTransactionId?: string;
  captureHoldId?: string;
  reversalOfJournalId?: string;
  entries: LedgerPostingLine[];
}

interface LockedAccount {
  id: string;
  status: string;
  normal_balance: LedgerDirection;
  debit_minor: string;
  credit_minor: string;
  active_hold_minor: string;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async postJournal(input: PostJournalInput): Promise<{ journalTransactionId: string; replayed: boolean }> {
    this.validatePosting(input);
    const requestHash = createHash('sha256').update(JSON.stringify({
      institutionId: input.institutionId,
      environmentId: input.environmentId,
      assetCode: input.assetCode,
      financialTransactionId: input.financialTransactionId ?? null,
      captureHoldId: input.captureHoldId ?? null,
      reversalOfJournalId: input.reversalOfJournalId ?? null,
      entries: input.entries
        .map((entry) => ({ accountId: entry.accountId, direction: entry.direction, amountMinor: entry.amountMinor.toString() }))
        .sort((a, b) => `${a.accountId}:${a.direction}:${a.amountMinor}`.localeCompare(`${b.accountId}:${b.direction}:${b.amountMinor}`)),
    })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; request_hash: string | null; status: string }>(
        `SELECT id, request_hash, status FROM journal_transactions
         WHERE institution_id = $1 AND reference_type = $2 AND reference_id = $3 AND asset_code = $4
         FOR UPDATE`,
        [input.institutionId, input.referenceType, input.referenceId, input.assetCode],
      );
      if (existing.rows[0]) {
        const journal = existing.rows[0];
        if (journal.request_hash === requestHash && journal.status === 'POSTED') {
          await client.query('COMMIT');
          return { journalTransactionId: journal.id, replayed: true };
        }
        throw new ConflictException('A journal with this business reference already exists with different contents');
      }
      let captureHold: { account_id: string; amount_minor: string; asset_code: string } | undefined;
      if (input.captureHoldId) {
        const holdResult = await client.query<{ account_id: string; amount_minor: string; asset_code: string }>(
          `SELECT account_id, amount_minor::text, asset_code FROM account_holds
           WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'ACTIVE'
           FOR UPDATE`,
          [input.captureHoldId, input.institutionId, input.environmentId],
        );
        captureHold = holdResult.rows[0];
        if (!captureHold || captureHold.asset_code !== input.assetCode) throw new ConflictException('Active hold not found for this journal asset');
      }
      const accounts = await this.lockAccounts(client, input, input.captureHoldId);
      if (captureHold) {
        const account = accounts.find((row) => row.id === captureHold!.account_id);
        const reducingAmount = input.entries
          .filter((entry) => entry.accountId === captureHold!.account_id && entry.direction !== account?.normal_balance)
          .reduce((sum, entry) => sum + entry.amountMinor, 0n);
        if (reducingAmount !== BigInt(captureHold.amount_minor)) {
          throw new ConflictException('Journal must consume exactly the amount reserved by the hold');
        }
      }

      const journal = await client.query<{ id: string }>(
        `INSERT INTO journal_transactions
          (institution_id, environment_id, asset_code, financial_transaction_id, reference_type, reference_id, request_hash, reversal_of_journal_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.institutionId,
          input.environmentId,
          input.assetCode,
          input.financialTransactionId ?? null,
          input.referenceType,
          input.referenceId,
          requestHash,
          input.reversalOfJournalId ?? null,
        ],
      );
      const journalTransactionId = journal.rows[0].id;

      for (const entry of input.entries) {
        await client.query(
          `INSERT INTO ledger_entries
            (journal_transaction_id, institution_id, environment_id, asset_code, account_id, direction, amount_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            journalTransactionId,
            input.institutionId,
            input.environmentId,
            input.assetCode,
            entry.accountId,
            entry.direction,
            entry.amountMinor.toString(),
          ],
        );
      }

      const posted = await client.query(
        `UPDATE journal_transactions SET status = 'POSTED'
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
        [journalTransactionId, input.institutionId, input.environmentId],
      );
      if (posted.rowCount !== 1) throw new NotFoundException('Journal transaction not found in the requested environment');
      if (input.captureHoldId) {
        const captured = await client.query(
          `UPDATE account_holds SET status = 'CAPTURED', updated_at = now()
           WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status = 'ACTIVE'`,
          [input.captureHoldId, input.institutionId, input.environmentId],
        );
        if (captured.rowCount !== 1) throw new ConflictException('Hold is no longer active in the requested environment');
        await client.query(
          `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'ledger.hold_captured', 'account_hold', $2, $3::jsonb)`,
          [input.institutionId, input.captureHoldId, JSON.stringify({ journalTransactionId })],
        );
        await client.query(
          `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, 'account_hold', $3, 'account_hold.captured', $4::jsonb)`,
          [input.institutionId, input.environmentId, input.captureHoldId, JSON.stringify({ holdId: input.captureHoldId, journalTransactionId })],
        );
      }
      await client.query('COMMIT');
      return { journalTransactionId, replayed: false };
    } catch (error) {
      await this.rollback(client);
      if (this.isUniqueViolation(error)) {
        const existing = await this.pool.query<{ id: string; request_hash: string | null; status: string }>(
          `SELECT id, request_hash, status FROM journal_transactions
           WHERE institution_id = $1 AND reference_type = $2 AND reference_id = $3 AND asset_code = $4`,
          [input.institutionId, input.referenceType, input.referenceId, input.assetCode],
        );
        const journal = existing.rows[0];
        if (journal?.request_hash === requestHash && journal.status === 'POSTED') {
          return { journalTransactionId: journal.id, replayed: true };
        }
        throw new ConflictException('A journal with this business reference already exists with different contents');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private validatePosting(input: PostJournalInput): void {
      if (!input.institutionId || !input.environmentId || !input.assetCode || !input.referenceType || !input.referenceId) {
      throw new BadRequestException('Institution, asset, and business reference are required');
    }
    if (input.entries.length < 2) {
      throw new BadRequestException('A journal requires at least two entries');
    }

    let debits = 0n;
    let credits = 0n;
    for (const entry of input.entries) {
      if (entry.amountMinor <= 0n || entry.amountMinor > MAX_MINOR_UNITS) {
        throw new BadRequestException('Ledger amounts must be positive values of at most 38 minor-unit digits');
      }
      if (entry.direction === 'DEBIT') debits += entry.amountMinor;
      else if (entry.direction === 'CREDIT') credits += entry.amountMinor;
      else throw new BadRequestException('Ledger direction must be DEBIT or CREDIT');
    }
    if (debits !== credits) {
      throw new BadRequestException('Journal debits and credits must balance');
    }
    if (debits > MAX_MINOR_UNITS) {
      throw new BadRequestException('Journal total exceeds supported precision');
    }
  }

  private async lockAccounts(client: PoolClient, input: PostJournalInput, excludedHoldId?: string): Promise<LockedAccount[]> {
    const accountIds = [...new Set(input.entries.map((entry) => entry.accountId))].sort();
    const locked = await client.query<Pick<LockedAccount, 'id' | 'status' | 'normal_balance'>>(
      `SELECT id, status, normal_balance FROM accounts
       WHERE id = ANY($1::uuid[]) AND institution_id = $2 AND environment_id = $3 AND asset_code = $4
       ORDER BY id FOR UPDATE`,
      [accountIds, input.institutionId, input.environmentId, input.assetCode],
    );

    if (locked.rowCount !== accountIds.length) {
      throw new BadRequestException('Every ledger account must belong to the institution and asset');
    }
    if (locked.rows.some((account) => account.status !== 'OPEN')) {
      throw new ConflictException('Ledger entries cannot post to a frozen or closed account');
    }
    // Read balances in a new statement after acquiring account locks. At READ COMMITTED this
    // sees any ledger posting that committed while this transaction waited for those locks.
    const balances = await client.query<Pick<LockedAccount, 'id' | 'debit_minor' | 'credit_minor' | 'active_hold_minor'>>(
      `SELECT a.id,
         COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = a.id AND le.direction = 'DEBIT'), 0)::text AS debit_minor,
         COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = a.id AND le.direction = 'CREDIT'), 0)::text AS credit_minor,
         COALESCE((SELECT SUM(h.amount_minor) FROM account_holds h WHERE h.account_id = a.id AND h.status = 'ACTIVE'
           AND ($5::uuid IS NULL OR h.id <> $5) AND (h.expires_at IS NULL OR h.expires_at > now())), 0)::text AS active_hold_minor
       FROM accounts a WHERE a.id = ANY($1::uuid[]) AND a.institution_id = $2
         AND a.environment_id = $3 AND a.asset_code = $4 ORDER BY a.id`,
      [accountIds, input.institutionId, input.environmentId, input.assetCode, excludedHoldId ?? null],
    );
    const resultRows: LockedAccount[] = locked.rows.map((account) => ({
      ...account,
      ...balances.rows.find((balance) => balance.id === account.id)!,
    }));
    const entriesByAccount = new Map<string, bigint>();
    for (const entry of input.entries) {
      const normal = resultRows.find((account) => account.id === entry.accountId)?.normal_balance;
      if (!normal) continue;
      const delta = entry.direction === normal ? entry.amountMinor : -entry.amountMinor;
      entriesByAccount.set(entry.accountId, (entriesByAccount.get(entry.accountId) ?? 0n) + delta);
    }
    for (const account of resultRows) {
      const current = account.normal_balance === 'DEBIT'
        ? BigInt(account.debit_minor) - BigInt(account.credit_minor)
        : BigInt(account.credit_minor) - BigInt(account.debit_minor);
      const projected = current + (entriesByAccount.get(account.id) ?? 0n);
      const held = BigInt(account.active_hold_minor);
      if (projected < held) {
        throw new ConflictException(`Ledger posting would reduce account ${account.id} below active holds`);
      }
    }
    return resultRows;
  }

  async createHold(input: {
    institutionId: string;
    environmentId: string;
    accountId: string;
    idempotencyKey: string;
    amountMinor: bigint;
    transactionId?: string;
  }): Promise<{ holdId: string; status: 'ACTIVE'; replayed: boolean }> {
    if (!input.idempotencyKey || input.idempotencyKey.length > 255 || input.amountMinor <= 0n || input.amountMinor > MAX_MINOR_UNITS) {
      throw new BadRequestException('Hold key and positive supported amount are required');
    }
    const requestHash = createHash('sha256').update(JSON.stringify({
      accountId: input.accountId,
      amountMinor: input.amountMinor.toString(),
      transactionId: input.transactionId ?? null,
    })).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query<Pick<LockedAccount, 'id' | 'status' | 'normal_balance'>>(
        `SELECT id, status, normal_balance FROM accounts
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 FOR UPDATE`,
        [input.accountId, input.institutionId, input.environmentId],
      );
      const row = account.rows[0];
      if (!row) throw new BadRequestException('Account is not available in this institution environment');
      if (row.status !== 'OPEN') throw new ConflictException('Cannot place a hold on a frozen or closed account');
      const priorHold = await client.query<{ id: string; request_hash: string; status: 'ACTIVE' | 'RELEASED' | 'CAPTURED' }>(
        `SELECT id, request_hash, status FROM account_holds
         WHERE institution_id = $1 AND environment_id = $2 AND idempotency_key = $3`,
        [input.institutionId, input.environmentId, input.idempotencyKey],
      );
      if (priorHold.rows[0]) {
        const existing = priorHold.rows[0];
        if (existing.request_hash !== requestHash) throw new ConflictException('Hold idempotency key was reused with different contents');
        if (existing.status !== 'ACTIVE') throw new ConflictException(`The original hold is ${existing.status.toLowerCase()}`);
        await client.query('COMMIT');
        return { holdId: existing.id, status: 'ACTIVE', replayed: true };
      }
      const totals = await client.query<{ debit_minor: string; credit_minor: string; active_hold_minor: string }>(
        `SELECT
           COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = $1 AND le.direction = 'DEBIT'), 0)::text AS debit_minor,
           COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = $1 AND le.direction = 'CREDIT'), 0)::text AS credit_minor,
           COALESCE((SELECT SUM(h.amount_minor) FROM account_holds h WHERE h.account_id = $1 AND h.status = 'ACTIVE'
             AND (h.expires_at IS NULL OR h.expires_at > now())), 0)::text AS active_hold_minor`, [row.id]);
      const total = totals.rows[0];
      const balance = row.normal_balance === 'DEBIT'
        ? BigInt(total.debit_minor) - BigInt(total.credit_minor)
        : BigInt(total.credit_minor) - BigInt(total.debit_minor);
      const available = balance - BigInt(total.active_hold_minor);
      if (input.amountMinor > available) throw new ConflictException('Insufficient available ledger balance for this hold');

      const hold = await client.query<{ id: string }>(
        `INSERT INTO account_holds
          (institution_id, environment_id, account_id, asset_code, transaction_id,
           amount_minor, idempotency_key, request_hash)
         SELECT a.institution_id, a.environment_id, a.id, a.asset_code, $4, $5, $6, $7
         FROM accounts a WHERE a.id = $1 AND a.institution_id = $2 AND a.environment_id = $3
         RETURNING id`,
        [input.accountId, input.institutionId, input.environmentId, input.transactionId ?? null,
          input.amountMinor.toString(), input.idempotencyKey, requestHash],
      );
      const holdId = hold.rows[0].id;
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'ledger.hold_created', 'account_hold', $2, $3::jsonb)`,
        [input.institutionId, holdId, JSON.stringify({ accountId: input.accountId, amountMinor: input.amountMinor.toString() })],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'account_hold', $3, 'account_hold.created', $4::jsonb)`,
        [input.institutionId, input.environmentId, holdId, JSON.stringify({ holdId, accountId: input.accountId, amountMinor: input.amountMinor.toString() })],
      );
      await client.query('COMMIT');
      return { holdId, status: 'ACTIVE', replayed: false };
    } catch (error) {
      await this.rollback(client);
      if (this.isUniqueViolation(error)) {
        const existing = await this.pool.query<{ id: string; request_hash: string; status: 'ACTIVE' | 'RELEASED' | 'CAPTURED' }>(
          `SELECT id, request_hash, status FROM account_holds
           WHERE institution_id = $1 AND environment_id = $2 AND idempotency_key = $3`,
          [input.institutionId, input.environmentId, input.idempotencyKey],
        );
        const row = existing.rows[0];
        if (row?.request_hash === requestHash && row.status === 'ACTIVE') return { holdId: row.id, status: 'ACTIVE', replayed: true };
        if (row && row.request_hash !== requestHash) throw new ConflictException('Hold idempotency key was reused with different contents');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reverseJournal(input: {
    institutionId: string;
    environmentId: string;
    journalTransactionId: string;
    referenceId: string;
  }): Promise<{ journalTransactionId: string; replayed: boolean }> {
    const original = await this.pool.query<{
      id: string; asset_code: string; financial_transaction_id: string | null; status: string;
    }>(
      `SELECT id, asset_code, financial_transaction_id, status FROM journal_transactions
       WHERE id = $1 AND institution_id = $2 AND environment_id = $3`,
      [input.journalTransactionId, input.institutionId, input.environmentId],
    );
    const journal = original.rows[0];
    if (!journal || journal.status !== 'POSTED') throw new ConflictException('Posted journal not found in this environment');
    const entries = await this.pool.query<{ account_id: string; direction: LedgerDirection; amount_minor: string }>(
      `SELECT account_id, direction, amount_minor::text FROM ledger_entries
       WHERE journal_transaction_id = $1 ORDER BY id`,
      [journal.id],
    );
    return this.postJournal({
      institutionId: input.institutionId,
      environmentId: input.environmentId,
      assetCode: journal.asset_code,
      financialTransactionId: journal.financial_transaction_id ?? undefined,
      referenceType: 'REVERSAL',
      referenceId: input.referenceId,
      reversalOfJournalId: journal.id,
      entries: entries.rows.map((entry) => ({
        accountId: entry.account_id,
        direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amountMinor: BigInt(entry.amount_minor),
      })),
    });
  }

  async releaseHold(institutionId: string, environmentId: string, accountId: string, holdId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ status: 'ACTIVE' | 'RELEASED' | 'CAPTURED'; account_id: string }>(
        `SELECT status, account_id FROM account_holds
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND account_id = $4 FOR UPDATE`,
        [holdId, institutionId, environmentId, accountId],
      );
      const hold = result.rows[0];
      if (!hold) throw new ConflictException('Hold not found');
      if (hold.status === 'CAPTURED') throw new ConflictException('A captured hold cannot be released');
      if (hold.status === 'ACTIVE') {
        const released = await client.query(
          `UPDATE account_holds SET status = 'RELEASED', updated_at = now()
           WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND account_id = $4 AND status = 'ACTIVE'`,
          [holdId, institutionId, environmentId, accountId],
        );
        if (released.rowCount !== 1) throw new ConflictException('Hold is no longer active in the requested account');
        await client.query(
          `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id)
           VALUES ($1, 'ledger.hold_released', 'account_hold', $2)`, [institutionId, holdId]);
        await client.query(
          `INSERT INTO outbox_events (institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, $2, 'account_hold', $3, 'account_hold.released', $4::jsonb)`,
          [institutionId, environmentId, holdId, JSON.stringify({ holdId, accountId: hold.account_id })]);
      }
      await client.query('COMMIT');
      return { holdId, status: 'RELEASED' as const, replayed: hold.status === 'RELEASED' };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original posting error if the connection has already failed.
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
