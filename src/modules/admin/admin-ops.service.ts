import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { UserPrincipal } from '../identity/api-key.types';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreateProviderIntegrationDto } from './provider-integration.dto';
import { EmailOutboxService } from '../email/email-outbox.service';

@Injectable()
export class AdminOpsService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly emailOutbox: EmailOutboxService,
    private readonly config: ConfigService,
  ) {}

  async overview(principal: UserPrincipal) {
    const [counts, recent] = await Promise.all([
      this.pool.query(`SELECT
        (SELECT count(*)::int FROM institutions) AS institutions,
        (SELECT count(*)::int FROM institutions WHERE status = 'PENDING_REVIEW') AS onboarding_pending,
        (SELECT count(*)::int FROM financial_transactions WHERE status IN ('COMPLIANCE_PENDING','REQUIRES_REVIEW')) AS transactions_needing_review,
        (SELECT count(*)::int FROM provider_attempts WHERE status IN ('FAILED','UNKNOWN')) AS provider_exceptions,
        (SELECT count(*)::int FROM reconciliation_observations WHERE result IN ('VARIANCE','UNMATCHED')) AS reconciliation_exceptions`),
      this.pool.query(`SELECT id, display_name, country_code, status, created_at FROM institutions ORDER BY created_at DESC LIMIT 8`),
    ]);
    await this.audit(principal, 'admin.ops.overview_read', 'platform', null);
    return { counts: counts.rows[0], recentInstitutions: recent.rows };
  }

  async institutions(principal: UserPrincipal, limit: number) {
    const result = await this.pool.query(
      `SELECT i.id, i.legal_name, i.display_name, i.country_code, i.status, i.created_at,
        (SELECT count(*)::int FROM institution_memberships m WHERE m.institution_id = i.id AND m.status = 'ACTIVE') AS active_members
       FROM institutions i ORDER BY i.created_at DESC LIMIT $1`, [limit],
    );
    await this.audit(principal, 'admin.institutions.listed', 'institutions', null);
    return { institutions: result.rows };
  }

  async onboardingApplications(principal: UserPrincipal, limit: number) {
    const result = await this.pool.query(
      `SELECT a.id AS application_id, a.institution_id, i.display_name, i.legal_name, i.country_code,
        i.status AS institution_status, a.contact_name, a.contact_email, a.business_type,
        a.status AS application_status, a.review_reason, a.submitted_at, pending.id AS review_id
       FROM institution_onboarding_applications a
       JOIN institutions i ON i.id = a.institution_id
       LEFT JOIN LATERAL (SELECT id FROM institution_onboarding_reviews r
         WHERE r.application_id = a.id AND r.status = 'AWAITING_CONFIRMATION' LIMIT 1) pending ON true
       ORDER BY a.submitted_at DESC LIMIT $1`, [limit],
    );
    await this.audit(principal, 'admin.onboarding_applications.listed', 'institution_onboarding_applications', null);
    return { applications: result.rows };
  }

  async reviewOnboardingApplication(
    principal: UserPrincipal, applicationId: string, decision: 'APPROVE' | 'REJECT', reason: string,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 2000) throw new BadRequestException('reason must contain 5 to 2000 characters');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ institution_id: string; application_status: string }>(
        `SELECT a.institution_id, a.status AS application_status
         FROM institution_onboarding_applications a JOIN institutions i ON i.id = a.institution_id
         WHERE a.id = $1 FOR UPDATE OF a, i`, [applicationId],
      );
      const application = selected.rows[0];
      if (!application) throw new NotFoundException('Onboarding application not found');
      if (application.application_status !== 'PENDING_REVIEW') throw new ConflictException('Application is not pending review');
      if (decision === 'APPROVE') {
        const review = await client.query<{ id: string }>(
          `INSERT INTO institution_onboarding_reviews (application_id, decision, reason, proposed_by, status)
           VALUES ($1, 'APPROVE', $2, $3, 'AWAITING_CONFIRMATION') RETURNING id`,
          [applicationId, normalizedReason, principal.userId],
        );
        await client.query(
          `UPDATE institution_onboarding_applications SET status = 'APPROVAL_PENDING_CONFIRMATION', review_reason = $2
           WHERE id = $1`, [applicationId, normalizedReason],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'admin.onboarding.approval_proposed', 'institution_onboarding_application', $2, $3::jsonb)`,
          [principal.userId, applicationId, JSON.stringify({ reviewId: review.rows[0].id, reason: normalizedReason })],
        );
        await client.query('COMMIT');
        return { applicationId, reviewId: review.rows[0].id, status: 'APPROVAL_PENDING_CONFIRMATION' as const };
      }

      await client.query(
        `INSERT INTO institution_onboarding_reviews
          (application_id, decision, reason, proposed_by, status)
         VALUES ($1, 'REJECT', $2, $3, 'REJECTED')`, [applicationId, normalizedReason, principal.userId],
      );
      await client.query(
        `UPDATE institution_onboarding_applications SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), review_reason = $3
         WHERE id = $1`, [applicationId, principal.userId, normalizedReason],
      );
      await client.query(`UPDATE institutions SET status = 'CLOSED', updated_at = now() WHERE id = $1`, [application.institution_id]);
      await client.query(`UPDATE institution_environments SET status = 'DISABLED' WHERE institution_id = $1`, [application.institution_id]);
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.onboarding.rejected', 'institution_onboarding_application', $2, $3::jsonb)`,
        [principal.userId, applicationId, JSON.stringify({ reason: normalizedReason })],
      );
      await client.query('COMMIT');
      return { applicationId, status: 'REJECTED' as const };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async confirmOnboardingApproval(principal: UserPrincipal, reviewId: string) {
    const client = await this.pool.connect();
    const invitationToken = randomBytes(32).toString('base64url');
    const invitationHash = createHash('sha256').update(invitationToken).digest('hex');
    try {
      await client.query('BEGIN');
      const selected = await client.query<{
        application_id: string; institution_id: string; contact_email: string; proposed_by: string; status: string;
      }>(
        `SELECT r.application_id, a.institution_id, a.contact_email, r.proposed_by, r.status
         FROM institution_onboarding_reviews r
         JOIN institution_onboarding_applications a ON a.id = r.application_id
         WHERE r.id = $1 AND r.decision = 'APPROVE'
         FOR UPDATE OF r, a`, [reviewId],
      );
      const review = selected.rows[0];
      if (!review) throw new NotFoundException('Onboarding approval review not found');
      if (review.status !== 'AWAITING_CONFIRMATION') throw new ConflictException('Onboarding approval is no longer awaiting confirmation');
      if (review.proposed_by === principal.userId) throw new ConflictException('A different internal administrator must confirm this approval');

      const confirmation = await client.query(
        `UPDATE institution_onboarding_reviews SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now()
         WHERE id = $1 AND status = 'AWAITING_CONFIRMATION'`, [reviewId, principal.userId],
      );
      if (confirmation.rowCount !== 1) throw new ConflictException('Onboarding approval was already confirmed');
      const approved = await client.query(
        `UPDATE institution_onboarding_applications SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now()
         WHERE id = $1 AND status = 'APPROVAL_PENDING_CONFIRMATION'`, [review.application_id, principal.userId],
      );
      if (approved.rowCount !== 1) throw new ConflictException('Application is not awaiting approval confirmation');
      await client.query(`UPDATE institutions SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [review.institution_id]);
      await client.query(
        `UPDATE institution_environments SET status = 'ACTIVE'
         WHERE institution_id = $1 AND environment = 'SANDBOX'`, [review.institution_id],
      );
      const invitation = await client.query<{ id: string }>(
        `INSERT INTO institution_invitations (institution_id, email, role, token_hash, expires_at)
         VALUES ($1, $2, 'OWNER', $3, now() + interval '7 days') RETURNING id`,
        [review.institution_id, review.contact_email, invitationHash],
      );
      await this.emailOutbox.enqueueInvitation(
        client, review.institution_id, review.contact_email, this.invitationUrl(invitationToken),
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.onboarding.approval_confirmed', 'institution_onboarding_application', $2, $3::jsonb)`,
        [principal.userId, review.application_id, JSON.stringify({ reviewId, invitationId: invitation.rows[0].id })],
      );
      await client.query('COMMIT');
      return { applicationId: review.application_id, status: 'APPROVED', invitationEmailQueued: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async transactions(principal: UserPrincipal, limit: number) {
    const result = await this.pool.query(
      `SELECT t.id, t.institution_id, i.display_name AS institution_name, e.environment,
        t.status, t.asset_code, t.amount_minor::text, t.destination_asset_code,
        t.destination_amount_minor::text, t.created_at
       FROM financial_transactions t JOIN institutions i ON i.id = t.institution_id
       JOIN institution_environments e ON e.id = t.environment_id
       ORDER BY t.created_at DESC, t.id DESC LIMIT $1`, [limit],
    );
    await this.audit(principal, 'admin.transactions.listed', 'financial_transactions', null);
    return { transactions: result.rows };
  }

  async complianceQueue(principal: UserPrincipal, limit: number) {
    const result = await this.pool.query(
      `SELECT DISTINCT ON (t.id) t.id AS transaction_id, t.institution_id, i.display_name AS institution_name,
        e.environment, t.status AS transaction_status, t.asset_code, t.amount_minor::text,
        d.check_type, d.provider_code, d.decision, d.decision_mode, d.reason_code, d.created_at AS decision_at
       FROM financial_transactions t JOIN institutions i ON i.id = t.institution_id
       JOIN institution_environments e ON e.id = t.environment_id
       LEFT JOIN transaction_compliance_decisions d ON d.transaction_id = t.id
       WHERE t.status IN ('COMPLIANCE_PENDING', 'REQUIRES_REVIEW') OR d.decision IN ('DENY', 'REVIEW')
       ORDER BY t.id, d.created_at DESC NULLS LAST LIMIT $1`, [limit],
    );
    await this.audit(principal, 'admin.compliance_queue.read', 'financial_transactions', null);
    return { cases: result.rows };
  }

  async providerOperations(principal: UserPrincipal, limit: number) {
    const [integrations, attempts, exceptions] = await Promise.all([
      this.pool.query(`SELECT id, provider_code, display_name, capability, environment, status, adapter_key,
        secret_reference, last_health_check_at, last_health_status, updated_at
        FROM provider_integrations ORDER BY capability, environment LIMIT $1`, [limit]),
      this.pool.query(`SELECT p.id, p.transaction_id, p.institution_id, i.display_name AS institution_name,
        p.provider_code, p.attempt_number, p.status, p.provider_reference, p.created_at, p.updated_at
        FROM provider_attempts p JOIN institutions i ON i.id = p.institution_id
        ORDER BY p.created_at DESC LIMIT $1`, [limit]),
      this.pool.query(`SELECT id, provider_code, transaction_id, provider_reference, observed_status, result, created_at
        FROM reconciliation_observations WHERE result IN ('VARIANCE', 'UNMATCHED')
        ORDER BY created_at DESC LIMIT $1`, [limit]),
    ]);
    await this.audit(principal, 'admin.providers.operations_read', 'provider_integrations', null);
    return { integrations: integrations.rows, attempts: attempts.rows, reconciliationExceptions: exceptions.rows };
  }

  async createProviderIntegration(principal: UserPrincipal, input: CreateProviderIntegrationDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO provider_integrations
          (provider_code, display_name, capability, environment, adapter_key, secret_reference, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
        [input.providerCode, input.displayName.trim(), input.capability, input.environment, input.adapterKey,
          input.secretReference ?? null, principal.userId],
      );
      const id = result.rows[0].id;
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.provider_integration.created', 'provider_integrations', $2, $3::jsonb)`,
        [principal.userId, id, JSON.stringify({ providerCode: input.providerCode, capability: input.capability, environment: input.environment })],
      );
      await client.query('COMMIT');
      return { id, providerCode: input.providerCode, status: 'DISABLED', secretReference: input.secretReference ?? null };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ConflictException('A provider integration with this code already exists');
      }
      throw error;
    } finally { client.release(); }
  }

  async updateProviderIntegrationStatus(principal: UserPrincipal, id: string, status: 'DISABLED' | 'CONFIGURED') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `UPDATE provider_integrations SET status = $2, updated_by = $3, updated_at = now()
         WHERE id = $1 AND ($2 <> 'CONFIGURED' OR environment = 'SANDBOX' OR secret_reference IS NOT NULL)
         RETURNING id`, [id, status, principal.userId],
      );
      if (!result.rows[0]) throw new NotFoundException('Provider integration not found or missing its production secret reference');
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.provider_integration.status_changed', 'provider_integrations', $2, $3::jsonb)`,
        [principal.userId, id, JSON.stringify({ status })],
      );
      await client.query('COMMIT');
      return { id, status };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async audit(principal: UserPrincipal, action: string, resourceType: string, resourceId: string | null) {
    await this.pool.query(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [principal.userId, action, resourceType, resourceId, JSON.stringify({ email: principal.email, sessionId: principal.sessionId })],
    );
  }

  private invitationUrl(token: string): string {
    const origin = this.config.get<string>('DASHBOARD_PUBLIC_URL') ?? 'http://localhost:3001';
    return `${origin.replace(/\/$/, '')}/accept-invitation?token=${encodeURIComponent(token)}`;
  }
}
