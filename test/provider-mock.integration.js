const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('KES/USDC mock records success, reversal, retry, and uncertain outcomes without posting money', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL database name must contain "test"');
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'development';
  process.env.AUTH_ACCESS_TOKEN_SECRET ||= 'provider-mock-integration-secret-value-32';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { TransactionsService } = require('../dist/modules/transactions/transactions.service');
  const { ProviderExecutionService } = require('../dist/modules/providers/provider-execution.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    await pool.query(`UPDATE assets SET enabled = true WHERE code = 'USDC'`);
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('Provider Mock Test', $1, 'KE', 'ACTIVE') RETURNING id`, [`Provider ${randomUUID()}`],
    );
    const institutionId = institution.rows[0].id;
    const environment = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`, [institutionId],
    );
    const environmentId = environment.rows[0].id;
    const transactions = app.get(TransactionsService);
    const execution = app.get(ProviderExecutionService);
    const makeInput = async (suffix, options = {}) => {
      const tx = await transactions.create({
        institutionId, environmentId, assetCode: 'USDC', amountMinor: 1_000_000n,
        idempotencyKey: `provider-${suffix}-${randomUUID()}`,
      });
      return {
        context: { institutionId, environmentId, environment: 'SANDBOX', transactionId: tx.id,
          idempotencyKey: `corridor-${suffix}`, correlationId: randomUUID(), timeoutMs: 1000 },
        sourceAssetCode: 'USDC', destinationAssetCode: 'KES', sourceAmountMinor: '1000000', ...options,
      };
    };

    const successInput = await makeInput('success');
    const success = await execution.executeKesUsdcSandbox(successInput);
    assert.equal(success.status, 'SUCCEEDED');
    assert.equal(success.attempts.length, 5);
    assert.equal(success.attempts.every((attempt) => attempt.status === 'SUCCEEDED'), true);
    assert.equal(success.noFundsMoved, true);
    const replay = await execution.executeKesUsdcSandbox(successInput);
    assert.equal(replay.replayed, true);
    assert.equal(replay.attempts.length, 5);
    await assert.rejects(execution.executeKesUsdcSandbox({ ...successInput, sourceAmountMinor: '1000001' }), (error) => error.status === 409);

    const failed = await execution.executeKesUsdcSandbox(await makeInput('reversal', { scenario: 'FAIL_PAYOUT_AND_REVERSE' }));
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.attempts.some((attempt) => attempt.request_metadata.stage === 'REVERSAL' && attempt.status === 'SUCCEEDED'), true);
    assert.equal(failed.noFundsMoved, true);

    const unknownInput = await makeInput('unknown', { scenario: 'TIMEOUT_AT_STAGE', failAt: 'CONVERSION' });
    const unknown = await execution.executeKesUsdcSandbox(unknownInput);
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.reconciliationRequired, true);
    const unknownReplay = await execution.executeKesUsdcSandbox(unknownInput);
    assert.equal(unknownReplay.attempts.length, unknown.attempts.length);
    assert.equal(unknownReplay.attempts.some((attempt) => attempt.status === 'CREATED'), false);

    const retryInput = await makeInput('retry', { scenario: 'RETRYABLE_PAYOUT_ONCE' });
    const firstAttempt = await execution.executeKesUsdcSandbox(retryInput);
    assert.equal(firstAttempt.status, 'FAILED');
    assert.equal(firstAttempt.retry_disposition, 'SAFE_TO_RETRY');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const retried = await execution.executeKesUsdcSandbox(retryInput);
    assert.equal(retried.status, 'SUCCEEDED');
    assert.equal(retried.attempts.filter((attempt) => attempt.request_metadata.stage === 'PAYOUT').length, 2);

    const ledger = await pool.query(`SELECT count(*)::int AS entries FROM ledger_entries WHERE institution_id = $1`, [institutionId]);
    assert.equal(ledger.rows[0].entries, 0, 'mock provider operations do not post ledger entries');
    console.log('Mock corridor integration passed: quote-to-payout lifecycle, failure/reversal, safe retry, unknown reconciliation gate, idempotency, and no ledger posting.');
  } finally { await app.close(); }
});
