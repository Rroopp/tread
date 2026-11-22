const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('institution activation requires a different second internal administrator', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL database name must contain "test"');
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'development';
  process.env.AUTH_ACCESS_TOKEN_SECRET ||= 'onboarding-integration-only-secret-32-bytes';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { InstitutionsService } = require('../dist/modules/institutions/institutions.service');
  const { AdminOpsService } = require('../dist/modules/admin/admin-ops.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    const reviewerIds = [];
    for (let i = 0; i < 2; i++) {
      const user = await pool.query(
        `INSERT INTO users (email, status, email_verified_at) VALUES ($1, 'ACTIVE', now()) RETURNING id`,
        [`review-${randomUUID()}@test.invalid`],
      );
      reviewerIds.push(user.rows[0].id);
    }
    const institutionService = app.get(InstitutionsService);
    const submitted = await institutionService.submitOnboarding({
      legalName: `Dual Control ${randomUUID()}`, displayName: `Dual ${randomUUID()}`,
      countryCode: 'KE', businessType: 'FINTECH', contactName: 'Test Contact',
      contactEmail: `owner-${randomUUID()}@test.invalid`,
    });
    const admins = app.get(AdminOpsService);
    const first = { userId: reviewerIds[0], email: 'reviewer1@test.invalid', sessionId: randomUUID() };
    const second = { userId: reviewerIds[1], email: 'reviewer2@test.invalid', sessionId: randomUUID() };
    const proposal = await admins.reviewOnboardingApplication(first, submitted.applicationId, 'APPROVE', 'Application evidence reviewed');
    assert.equal(proposal.status, 'APPROVAL_PENDING_CONFIRMATION');
    await assert.rejects(admins.confirmOnboardingApproval(first, proposal.reviewId), (error) => error.status === 409);
    const before = await pool.query(
      `SELECT i.status, a.status AS application_status FROM institutions i
       JOIN institution_onboarding_applications a ON a.institution_id = i.id WHERE a.id = $1`, [submitted.applicationId],
    );
    assert.equal(before.rows[0].status, 'PENDING_REVIEW');
    assert.equal(before.rows[0].application_status, 'APPROVAL_PENDING_CONFIRMATION');
    const confirmed = await admins.confirmOnboardingApproval(second, proposal.reviewId);
    assert.equal(confirmed.status, 'APPROVED');
    assert.equal(confirmed.invitationEmailQueued, true);
    const final = await pool.query(
      `SELECT i.status, a.status AS application_status, e.status AS sandbox_status
       FROM institutions i JOIN institution_onboarding_applications a ON a.institution_id = i.id
       JOIN institution_environments e ON e.institution_id = i.id AND e.environment = 'SANDBOX' WHERE a.id = $1`, [submitted.applicationId],
    );
    assert.deepEqual(final.rows[0], { status: 'ACTIVE', application_status: 'APPROVED', sandbox_status: 'ACTIVE' });
    const institutionId = (await pool.query(`SELECT institution_id FROM institution_onboarding_applications WHERE id = $1`, [submitted.applicationId])).rows[0].institution_id;
    const pendingMail = await pool.query(`SELECT status, recipient_email FROM email_outbox WHERE institution_id = $1`, [institutionId]);
    assert.equal(pendingMail.rows.length, 1);
    const rejected = await institutionService.submitOnboarding({
      legalName: `Rejected ${randomUUID()}`, displayName: `Rejected ${randomUUID()}`,
      countryCode: 'KE', businessType: 'OTHER', contactName: 'Applicant',
      contactEmail: `reject-${randomUUID()}@test.invalid`,
    });
    const rejection = await admins.reviewOnboardingApplication(first, rejected.applicationId, 'REJECT', 'Required documents are missing');
    assert.equal(rejection.status, 'REJECTED');
    const rejectedState = await pool.query(
      `SELECT i.status, a.status AS application_status FROM institutions i
       JOIN institution_onboarding_applications a ON a.institution_id = i.id WHERE a.id = $1`, [rejected.applicationId],
    );
    assert.deepEqual(rejectedState.rows[0], { status: 'CLOSED', application_status: 'REJECTED' });
    console.log('Onboarding dual-control integration passed: proposer cannot confirm, a second admin activates and queues owner email.');
  } finally { await app.close(); }
});
