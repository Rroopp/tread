const test = require('node:test');
const assert = require('node:assert/strict');

test('approval requires latest environment-correct decisions and execution rechecks them', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must contain "test" in its database name');
  process.env.DATABASE_URL = url;
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { TransactionsService } = require('../dist/modules/transactions/transactions.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('TREAD Compliance Test', $1, 'KE', 'ACTIVE') RETURNING id`,
      [`Compliance test ${Date.now()}-${Math.random()}`],
    );
    const institutionId = institution.rows[0].id;
    const sandbox = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`, [institutionId]);
    const production = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'PRODUCTION', 'ACTIVE') RETURNING id`, [institutionId]);
    const transactions = app.get(TransactionsService);
    const advanceToReview = async (environmentId, key) => {
      const tx = await transactions.create({ institutionId, environmentId, assetCode: 'KES', amountMinor: 10n, idempotencyKey: key });
      for (const status of ['QUOTED', 'AWAITING_FUNDING', 'FUNDED', 'COMPLIANCE_PENDING']) {
        await transactions.transition(institutionId, environmentId, tx.id, status);
      }
      return tx.id;
    };

    const sandboxTransactionId = await advanceToReview(sandbox.rows[0].id, `sandbox-${Date.now()}`);
    await pool.query(
      `INSERT INTO transaction_compliance_decisions
        (transaction_id, institution_id, environment_id, check_type, provider_code, decision, decision_mode)
       VALUES ($1,$2,$3,'TRANSACTION_ELIGIBILITY','sandbox-test','ALLOW','SANDBOX_SIMULATED')`,
      [sandboxTransactionId, institutionId, sandbox.rows[0].id],
    );
    await pool.query(`UPDATE financial_transactions SET status='APPROVED' WHERE id=$1`, [sandboxTransactionId]);
    await pool.query(
      `INSERT INTO transaction_compliance_decisions
        (transaction_id, institution_id, environment_id, check_type, provider_code, decision, decision_mode, created_at)
       VALUES ($1,$2,$3,'TRANSACTION_ELIGIBILITY','sandbox-test','DENY','SANDBOX_SIMULATED',now()+interval '1 second')`,
      [sandboxTransactionId, institutionId, sandbox.rows[0].id],
    );
    await assert.rejects(pool.query(`UPDATE financial_transactions SET status='EXECUTING' WHERE id=$1`, [sandboxTransactionId]));

    const productionTransactionId = await advanceToReview(production.rows[0].id, `production-${Date.now()}`);
    await assert.rejects(pool.query(`UPDATE financial_transactions SET status='APPROVED' WHERE id=$1`, [productionTransactionId]));
    const checkTypes = ['SANCTIONS', 'AML', 'JURISDICTION', 'TRANSACTION_ELIGIBILITY'];
    for (const checkType of checkTypes) {
      await pool.query(
        `INSERT INTO transaction_compliance_decisions
          (transaction_id, institution_id, environment_id, check_type, provider_code, decision, decision_mode)
         VALUES ($1,$2,$3,$4,'live-test','ALLOW','LIVE')`,
        [productionTransactionId, institutionId, production.rows[0].id, checkType],
      );
    }
    await pool.query(`UPDATE financial_transactions SET status='APPROVED' WHERE id=$1`, [productionTransactionId]);
    console.log('Compliance gate passed: sandbox and production approval rules are enforced, and execution rechecks latest decisions.');
  } finally { await app.close(); }
});
