import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { ConfigService } from '@nestjs/config';
import { EmailOutboxService } from '../email/email-outbox.service';
import { UserPrincipal } from '../identity/api-key.types';
import { TRANSACTION_STATUSES, TransactionStatus } from '../transactions/transactions.service';
import { InstitutionRole } from '../identity/institution-roles.decorator';
import { SubmitInstitutionOnboardingDto } from './onboarding.dto';

@Injectable()
export class InstitutionsService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly emailOutbox: EmailOutboxService,
    private readonly config: ConfigService,
  ) {}

  async submitOnboarding(input: SubmitInstitutionOnboardingDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const institution = await client.query<{ id: string }>(
        `INSERT INTO institutions (legal_name, display_name, country_code, status)
         VALUES ($1, $2, $3, 'PENDING_REVIEW') RETURNING id`,
        [input.legalName.trim(), input.displayName.trim(), input.countryCode.toUpperCase()],
      );
      const institutionId = institution.rows[0].id;
      await client.query(
        `INSERT INTO institution_environments (institution_id, environment, status)
         VALUES ($1, 'SANDBOX', 'DISABLED')`,
        [institutionId],
      );
      const application = await client.query<{ id: string }>(
        `INSERT INTO institution_onboarding_applications
          (institution_id, contact_name, contact_email, business_type)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [institutionId, input.contactName.trim(), input.contactEmail.trim(), input.businessType],
      );
      const applicationId = application.rows[0].id;
      await client.query(
        `INSERT INTO audit_logs (institution_id, action, resource_type, resource_id)
         VALUES ($1, 'institution.onboarding.submitted', 'onboarding_application', $2)`,
        [institutionId, applicationId],
      );
      await client.query(
        `INSERT INTO outbox_events (institution_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'institution_onboarding_application', $2, 'institution.onboarding.submitted', $3::jsonb)`,
        [institutionId, applicationId, JSON.stringify({ applicationId, status: 'PENDING_REVIEW' })],
      );
      await client.query('COMMIT');
      return { applicationId, status: 'PENDING_REVIEW' as const };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async current(principal: UserPrincipal) {
    const result = await this.pool.query<{
      id: string;
      legal_name: string;
      display_name: string;
      country_code: string;
      status: UserPrincipal['institutionStatus'];
      onboarding_status: string | null;
    }>(
      `SELECT i.id, i.legal_name, i.display_name, i.country_code, i.status,
              a.status AS onboarding_status
       FROM institutions i
       LEFT JOIN institution_onboarding_applications a ON a.institution_id = i.id
       WHERE i.id = $1`,
      [principal.institutionId],
    );
    const institution = result.rows[0];
    if (!institution) throw new NotFoundException('Institution not found');
    return {
      ...institution,
      role: principal.role,
    };
  }

  async dashboard(principal: UserPrincipal) {
    const institution = await this.current(principal);
    const environmentResult = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments
       WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`,
      [principal.institutionId],
    );
    const environment = environmentResult.rows[0];
    if (!environment) {
      return { institution, environment: null, accounts: [], transactions: [], teamMemberCount: 0, apiCredentialCount: 0 };
    }
    const [accountResult, transactionResult, counts] = await Promise.all([
      this.pool.query<{
        id: string; account_ref: string; asset_code: string; account_type: string;
        normal_balance: 'DEBIT' | 'CREDIT'; status: string; debit_minor: string;
        credit_minor: string; active_hold_minor: string; created_at: Date;
      }>(
        `SELECT a.id, a.account_ref, a.asset_code, a.account_type, a.normal_balance, a.status, a.created_at,
           COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = a.id AND le.direction = 'DEBIT'), 0)::text AS debit_minor,
           COALESCE((SELECT SUM(le.amount_minor) FROM ledger_entries le WHERE le.account_id = a.id AND le.direction = 'CREDIT'), 0)::text AS credit_minor,
           COALESCE((SELECT SUM(h.amount_minor) FROM account_holds h WHERE h.account_id = a.id AND h.status = 'ACTIVE'
             AND (h.expires_at IS NULL OR h.expires_at > now())), 0)::text AS active_hold_minor
         FROM accounts a WHERE a.institution_id = $1 AND a.environment_id = $2
         ORDER BY a.created_at DESC LIMIT 20`, [principal.institutionId, environment.id]),
      this.pool.query(
        `SELECT id, status, asset_code, amount_minor::text, destination_asset_code,
                destination_amount_minor::text, created_at
         FROM financial_transactions WHERE institution_id = $1 AND environment_id = $2
         ORDER BY created_at DESC, id DESC LIMIT 10`, [principal.institutionId, environment.id]),
      this.pool.query<{ team_count: number; api_key_count: number }>(
        `SELECT
           (SELECT count(*)::int FROM institution_memberships WHERE institution_id = $1 AND status = 'ACTIVE') AS team_count,
           (SELECT count(*)::int FROM api_credentials WHERE institution_id = $1 AND environment_id = $2 AND revoked_at IS NULL) AS api_key_count`,
        [principal.institutionId, environment.id]),
    ]);
    const accounts = accountResult.rows.map((row) => {
      const balance = row.normal_balance === 'DEBIT'
        ? BigInt(row.debit_minor) - BigInt(row.credit_minor)
        : BigInt(row.credit_minor) - BigInt(row.debit_minor);
      return {
        id: row.id, accountRef: row.account_ref, assetCode: row.asset_code, accountType: row.account_type,
        normalBalance: row.normal_balance, status: row.status, createdAt: row.created_at,
        balanceMinor: balance.toString(), availableMinor: (balance - BigInt(row.active_hold_minor)).toString(),
      };
    });
    return {
      institution,
      environment,
      accounts,
      transactions: transactionResult.rows.map((row) => ({
        id: row.id, status: row.status, assetCode: row.asset_code, amountMinor: row.amount_minor,
        destinationAssetCode: row.destination_asset_code, destinationAmountMinor: row.destination_amount_minor,
        createdAt: row.created_at,
      })),
      teamMemberCount: counts.rows[0]?.team_count ?? 0,
      apiCredentialCount: counts.rows[0]?.api_key_count ?? 0,
    };
  }

  async dashboardTransactions(
    principal: UserPrincipal,
    filters: { status?: TransactionStatus; query?: string; limit: number; offset: number },
  ) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const activeEnvironment = environment.rows[0];
    if (!activeEnvironment) return { environment: null, transactions: [], total: 0, limit: filters.limit, offset: filters.offset };
    const search = filters.query?.trim() || null;
    const [items, count] = await Promise.all([
      this.pool.query(
        `SELECT t.id, t.client_reference, t.status, t.asset_code, t.amount_minor::text,
          t.destination_asset_code, t.destination_amount_minor::text, t.quote_id, t.created_at, t.updated_at
         FROM financial_transactions t
         WHERE t.institution_id = $1 AND t.environment_id = $2
           AND ($3::text IS NULL OR t.status = $3)
           AND ($4::text IS NULL OR t.id::text ILIKE '%' || $4 || '%' OR COALESCE(t.client_reference, '') ILIKE '%' || $4 || '%')
         ORDER BY t.created_at DESC, t.id DESC LIMIT $5 OFFSET $6`,
        [principal.institutionId, activeEnvironment.id, filters.status ?? null, search, filters.limit, filters.offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM financial_transactions t
         WHERE t.institution_id = $1 AND t.environment_id = $2
           AND ($3::text IS NULL OR t.status = $3)
           AND ($4::text IS NULL OR t.id::text ILIKE '%' || $4 || '%' OR COALESCE(t.client_reference, '') ILIKE '%' || $4 || '%')`,
        [principal.institutionId, activeEnvironment.id, filters.status ?? null, search],
      ),
    ]);
    return { environment: activeEnvironment.environment, transactions: items.rows, total: Number(count.rows[0]?.total ?? 0), limit: filters.limit, offset: filters.offset };
  }

  async dashboardCompliance(principal: UserPrincipal, limit: number, offset: number) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const active = environment.rows[0];
    if (!active) return { environment: null, decisions: [], total: 0, limit, offset };
    const [rows, count] = await Promise.all([
      this.pool.query(
        `SELECT t.id AS transaction_id, t.status AS transaction_status, t.asset_code, t.amount_minor::text,
           t.created_at AS transaction_created_at, d.checks
         FROM financial_transactions t
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object(
             'checkType', check_type, 'decision', decision, 'decisionMode', decision_mode,
             'providerCode', provider_code, 'reasonCode', reason_code, 'createdAt', created_at
           ) ORDER BY check_type), '[]'::json) AS checks
           FROM (
             SELECT DISTINCT ON (check_type) check_type, decision, decision_mode, provider_code, reason_code, created_at
             FROM transaction_compliance_decisions WHERE transaction_id = t.id
               AND institution_id = t.institution_id AND environment_id = t.environment_id
             ORDER BY check_type, created_at DESC, id DESC
           ) latest
         ) d ON true
         WHERE t.institution_id = $1 AND t.environment_id = $2
         ORDER BY t.created_at DESC, t.id DESC LIMIT $3 OFFSET $4`,
        [principal.institutionId, active.id, limit, offset],
      ),
      this.pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM financial_transactions WHERE institution_id = $1 AND environment_id = $2`, [principal.institutionId, active.id]),
    ]);
    return { environment: active.environment, decisions: rows.rows, total: Number(count.rows[0]?.total ?? 0), limit, offset };
  }

  async dashboardUsage(principal: UserPrincipal) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const active = environment.rows[0];
    if (!active) return { environment: null, billingEnabled: false, plan: null, invoices: [], usage: null };
    const result = await this.pool.query<{ period_start: Date; transaction_requests: string; quotes: string; webhook_deliveries: string; successful_webhooks: string }>(
      `SELECT date_trunc('month', now()) AS period_start,
        (SELECT count(*)::text FROM financial_transactions WHERE institution_id = $1 AND environment_id = $2 AND created_at >= date_trunc('month', now())) AS transaction_requests,
        (SELECT count(*)::text FROM quotes WHERE institution_id = $1 AND environment_id = $2 AND created_at >= date_trunc('month', now())) AS quotes,
        (SELECT count(*)::text FROM webhook_deliveries WHERE institution_id = $1 AND environment_id = $2 AND created_at >= date_trunc('month', now())) AS webhook_deliveries,
        (SELECT count(*)::text FROM webhook_deliveries WHERE institution_id = $1 AND environment_id = $2 AND created_at >= date_trunc('month', now()) AND status = 'DELIVERED') AS successful_webhooks`,
      [principal.institutionId, active.id],
    );
    const usage = result.rows[0];
    return { environment: active.environment, billingEnabled: false, plan: null, invoices: [], usage: {
      periodStart: usage.period_start, transactionRequests: usage.transaction_requests,
      quotes: usage.quotes, webhookDeliveries: usage.webhook_deliveries,
      successfulWebhookDeliveries: usage.successful_webhooks,
      apiRequestCount: null,
    } };
  }

  async dashboardTransaction(principal: UserPrincipal, transactionId: string) {
    const environment = await this.pool.query<{ id: string; environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [principal.institutionId],
    );
    const activeEnvironment = environment.rows[0];
    if (!activeEnvironment) throw new NotFoundException('Transaction not found');
    const transaction = await this.pool.query(
      `SELECT t.id, t.client_reference, t.status, t.asset_code, t.amount_minor::text,
        t.destination_asset_code, t.destination_amount_minor::text, t.quote_id, t.created_at, t.updated_at,
        q.provider_code AS quote_provider, q.quote_mode, q.rate_numerator::text, q.rate_denominator::text,
        q.fee_amount_minor::text, q.expires_at AS quote_expires_at
       FROM financial_transactions t LEFT JOIN quotes q ON q.id = t.quote_id
       WHERE t.id = $1 AND t.institution_id = $2 AND t.environment_id = $3`,
      [transactionId, principal.institutionId, activeEnvironment.id],
    );
    if (!transaction.rows[0]) throw new NotFoundException('Transaction not found');
    const [history, compliance, attempts, journals, reconciliation] = await Promise.all([
      this.pool.query(
        `SELECT from_status, to_status, reason_code, created_at FROM transaction_transitions
         WHERE transaction_id = $1 AND institution_id = $2 ORDER BY created_at, id`, [transactionId, principal.institutionId]),
      this.pool.query(
        `SELECT check_type, provider_code, decision, decision_mode, reason_code, created_at
         FROM transaction_compliance_decisions WHERE transaction_id = $1 AND institution_id = $2
         ORDER BY created_at DESC, id DESC`, [transactionId, principal.institutionId]),
      this.pool.query(
        `SELECT provider_code, attempt_number, status, provider_reference, settlement_asset_code,
          settlement_amount_minor::text, created_at, updated_at, completed_at
         FROM provider_attempts WHERE transaction_id = $1 AND institution_id = $2 AND environment_id = $3
         ORDER BY attempt_number DESC`, [transactionId, principal.institutionId, activeEnvironment.id]),
      this.pool.query(
        `SELECT j.id, j.reference_type, j.reference_id, j.status, j.posted_at,
          COALESCE(json_agg(json_build_object('accountRef', a.account_ref, 'direction', le.direction,
            'amountMinor', le.amount_minor::text, 'assetCode', le.asset_code) ORDER BY le.id)
            FILTER (WHERE le.id IS NOT NULL), '[]'::json) AS entries
         FROM journal_transactions j LEFT JOIN ledger_entries le ON le.journal_transaction_id = j.id
         LEFT JOIN accounts a ON a.id = le.account_id AND a.institution_id = le.institution_id
         WHERE j.financial_transaction_id = $1 AND j.institution_id = $2
         GROUP BY j.id ORDER BY j.created_at`, [transactionId, principal.institutionId]),
      this.pool.query(
        `SELECT provider_code, provider_reference, observed_status, observed_asset_code,
          observed_amount_minor::text, result, observed_at, created_at
         FROM reconciliation_observations WHERE transaction_id = $1 AND institution_id = $2 AND environment_id = $3
         ORDER BY observed_at DESC`, [transactionId, principal.institutionId, activeEnvironment.id]),
    ]);
    return { environment: activeEnvironment.environment, transaction: transaction.rows[0], history: history.rows,
      complianceDecisions: compliance.rows, providerAttempts: attempts.rows, journals: journals.rows, reconciliation: reconciliation.rows };
  }

  async listTeamMembers(institutionId: string) {
    const result = await this.pool.query(
      `SELECT u.id AS user_id, u.email, m.role, m.status, m.created_at
       FROM institution_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.institution_id = $1
       ORDER BY m.created_at ASC
       LIMIT 100`,
      [institutionId],
    );
    return { members: result.rows };
  }

  async listTeamInvitations(institutionId: string) {
    const result = await this.pool.query(
      `SELECT id, email, role, created_at, expires_at
       FROM institution_invitations
       WHERE institution_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 100`,
      [institutionId],
    );
    return { invitations: result.rows };
  }

  async inviteTeamMember(principal: UserPrincipal, email: string, role: InstitutionRole) {
    const ownerRoles: InstitutionRole[] = ['ADMIN', 'OPERATOR', 'VIEWER', 'COMPLIANCE'];
    const adminRoles: InstitutionRole[] = ['OPERATOR', 'VIEWER'];
    const permittedRoles = principal.role === 'OWNER' ? ownerRoles : adminRoles;
    if (!permittedRoles.includes(role)) {
      throw new ForbiddenException('Your institution role cannot assign this team role');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const invitationToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(invitationToken).digest('hex');
    const client = await this.pool.connect();
    let invitationId: string;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      await client.query('BEGIN');
      const institution = await client.query<{ status: string }>(
        `SELECT status FROM institutions WHERE id = $1 FOR UPDATE`,
        [principal.institutionId],
      );
      if (institution.rows[0]?.status !== 'ACTIVE') {
        throw new ConflictException('Only active institutions can invite team members');
      }

      const existingMember = await client.query<{ status: string }>(
        `SELECT m.status
         FROM users u
         JOIN institution_memberships m ON m.user_id = u.id
         WHERE u.email_normalized = $1 AND m.institution_id = $2
         FOR UPDATE OF u, m`,
        [normalizedEmail, principal.institutionId],
      );
      if (existingMember.rows.some((member) => member.status === 'ACTIVE')) {
        throw new ConflictException('This person is already an active institution member');
      }

      const invitation = await client.query<{ id: string }>(
        `INSERT INTO institution_invitations
          (institution_id, email, role, token_hash, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [principal.institutionId, normalizedEmail, role, tokenHash, principal.userId, expiresAt],
      );
      invitationId = invitation.rows[0].id;
      await client.query(
        `INSERT INTO audit_logs
          (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'institution.member.invited', 'invitation', $3)`,
        [principal.institutionId, principal.userId, invitationId],
      );
      await client.query(
        `INSERT INTO outbox_events
          (institution_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'institution_invitation', $2, 'institution.invitation.created', $3::jsonb)`,
        [principal.institutionId, invitationId, JSON.stringify({ invitationId })],
      );
      await this.emailOutbox.enqueueInvitation(
        client, principal.institutionId, normalizedEmail, this.invitationUrl(invitationToken),
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('A pending invitation already exists for this email');
      }
      throw error;
    } finally {
      client.release();
    }

    return {
      invitationId: invitationId!,
      email: normalizedEmail,
      role,
      invitationToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeTeamInvitation(principal: UserPrincipal, invitationId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const revoked = await client.query<{ id: string }>(
        `UPDATE institution_invitations
         SET revoked_at = now()
         WHERE id = $1 AND institution_id = $2
           AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING id`,
        [invitationId, principal.institutionId],
      );
      if (!revoked.rows[0]) throw new NotFoundException('Pending invitation not found');
      await client.query(
        `INSERT INTO audit_logs
          (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'institution.invitation.revoked', 'invitation', $3)`,
        [principal.institutionId, principal.userId, invitationId],
      );
      await client.query('COMMIT');
      return { invitationId, status: 'revoked' as const };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollback(client: import('pg').PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error.
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private invitationUrl(token: string): string {
    const origin = this.config.get<string>('DASHBOARD_PUBLIC_URL') ?? 'http://localhost:3001';
    return `${origin.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(token)}`;
  }
}
