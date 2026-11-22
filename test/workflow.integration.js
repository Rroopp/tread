const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

test('durable workflow persists step state, resumes safely after a crash, and enforces tenant scope', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL database name must contain "test"');
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'development';
  process.env.AUTH_ACCESS_TOKEN_SECRET ||= 'workflow-integration-secret-value-32';
  process.env.SANDBOX_RATES_JSON = JSON.stringify({ 'KES:USDC': { numerator: '1', denominator: '1' } });
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { TransactionsService } = require('../dist/modules/transactions/transactions.service');
  const { QuotesService } = require('../dist/modules/quotes/quotes.service');
  const { TransferWorkflowService, FORWARD_WORKFLOW_STEPS, COMPENSATION_WORKFLOW_STEPS } = require('../dist/modules/workflows/transfer-workflow.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    await pool.query(`UPDATE assets SET enabled = true WHERE code IN ('KES','USDC')`);
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('Workflow Test', $1, 'KE', 'ACTIVE') RETURNING id`, [`Workflow ${randomUUID()}`],
    );
    const institutionId = institution.rows[0].id;
    const env = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`, [institutionId],
    );
    const environmentId = env.rows[0].id;
    const scope = { institutionId, environmentId };
    const transactions = app.get(TransactionsService);
    const quotes = app.get(QuotesService);
    const workflows = app.get(TransferWorkflowService);
    const makeTransaction = async () => {
      const quote = await quotes.create(institutionId, environmentId, 'SANDBOX', {
        sourceAssetCode: 'KES', destinationAssetCode: 'USDC', sourceAmountMinor: '2500000',
      });
      return (await transactions.create({ institutionId, environmentId, quoteId: quote.quoteId, idempotencyKey: `wf-tx-${randomUUID()}` })).id;
    };
    const makePolicy = () => {
      const steps = {};
      for (const key of [...FORWARD_WORKFLOW_STEPS, ...COMPENSATION_WORKFLOW_STEPS]) {
        steps[key] = { timeoutMs: 5000, maxAttempts: 2, retryPolicy: { retryableErrorCodes: ['MOCK_TRANSIENT'], backoffMs: 0 } };
      }
      return { version: 'sandbox-test-v1', steps };
    };

    const crashWorkflow = await workflows.create({ scope, transactionId: await makeTransaction(), idempotencyKey: `wf-${randomUUID()}`, policy: makePolicy(), simulated: true });
    assert.equal(crashWorkflow.steps.length, 14);
    assert.equal(crashWorkflow.steps[0].step_key, 'quote_accepted');
    assert.equal(crashWorkflow.steps[0].status, 'READY');
    assert.ok(crashWorkflow.steps.every((step) => step.timeout_ms === 5000 && step.max_attempts === 2));
    const claimed = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(claimed.step_key, 'quote_accepted');
    const replayedCreate = await workflows.create({ scope, transactionId: crashWorkflow.transaction_id, idempotencyKey: `wf-${randomUUID()}`, policy: makePolicy(), simulated: true });
    assert.equal(replayedCreate.id, crashWorkflow.id);
    await pool.query(`UPDATE transfer_workflow_steps SET lease_expires_at = now() - interval '1 second' WHERE id = $1 AND institution_id = $2 AND environment_id = $3`, [claimed.id, institutionId, environmentId]);
    const recovered = await workflows.recoverExpiredLeases(scope);
    assert.equal(recovered.recoveredAsUnknown, 1);
    const afterCrash = await workflows.get(scope, crashWorkflow.id);
    assert.equal(afterCrash.status, 'WAITING_RECONCILIATION');
    assert.equal(afterCrash.steps[0].status, 'RECONCILIATION_PENDING');
    assert.equal(afterCrash.steps[1].status, 'BLOCKED');
    assert.equal(await workflows.claimNext(scope, 'workflow-test-worker'), null, 'unknown outcome must block resubmission and downstream work');
    const attempts = await pool.query(`SELECT count(*)::int AS count FROM transfer_workflow_attempts WHERE workflow_id = $1 AND institution_id = $2 AND environment_id = $3`, [crashWorkflow.id, institutionId, environmentId]);
    assert.equal(attempts.rows[0].count, 1);
    const resolved = await workflows.resolveUnknown(scope, claimed.id, { kind: 'DEFINITE_SUCCESS', providerReference: 'mock-reconciled-reference' });
    assert.equal(resolved.steps[0].status, 'SUCCEEDED');
    const resumed = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(resumed.step_key, 'funding_confirmed', 'definitively reconciled work resumes at the next blocked step');
    await workflows.recordOutcome(scope, resumed.id, resumed.attemptId, { kind: 'DEFINITE_SUCCESS', providerReference: 'mock-funding' });
    for (const stepKey of FORWARD_WORKFLOW_STEPS.slice(2)) {
      const step = await workflows.claimNext(scope, 'workflow-test-worker');
      assert.equal(step.step_key, stepKey);
      await workflows.recordOutcome(scope, step.id, step.attemptId, { kind: 'DEFINITE_SUCCESS', providerReference: `mock-${stepKey}` });
    }
    await assert.rejects(workflows.get({ institutionId: randomUUID(), environmentId }, crashWorkflow.id), (error) => error.status === 404);

    const successWorkflow = await workflows.create({ scope, transactionId: await makeTransaction(), idempotencyKey: `wf-${randomUUID()}`, policy: makePolicy(), simulated: true });
    for (const stepKey of FORWARD_WORKFLOW_STEPS) {
      const step = await workflows.claimNext(scope, 'workflow-test-worker');
      assert.equal(step.step_key, stepKey);
      const result = await workflows.recordOutcome(scope, step.id, step.attemptId, { kind: 'DEFINITE_SUCCESS', providerReference: `sandbox-${stepKey}` });
      assert.equal(result.steps.find((item) => item.step_key === stepKey).status, 'SUCCEEDED');
    }
    const settled = await workflows.get(scope, successWorkflow.id);
    assert.equal(settled.status, 'SETTLED');
    assert.equal(settled.noFundsMoved, true);

    const recoveryWorkflow = await workflows.create({ scope, transactionId: await makeTransaction(), idempotencyKey: `wf-${randomUUID()}`, policy: makePolicy(), simulated: true });
    const quoteStep = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(quoteStep.step_key, 'quote_accepted');
    await workflows.recordOutcome(scope, quoteStep.id, quoteStep.attemptId, { kind: 'DEFINITE_SUCCESS', providerReference: 'mock-quote' });
    const fundingStep = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(fundingStep.step_key, 'funding_confirmed');
    await workflows.recordOutcome(scope, fundingStep.id, fundingStep.attemptId,
      { kind: 'DEFINITE_FAILURE', retryDisposition: 'SAFE_TO_RETRY', reason: 'MOCK_TRANSIENT' });
    const retry = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(retry.step_key, 'funding_confirmed');
    assert.equal(retry.idempotencyKey, fundingStep.idempotencyKey, 'retries retain the same provider idempotency key');
    await workflows.recordOutcome(scope, retry.id, retry.attemptId,
      { kind: 'DEFINITE_FAILURE', retryDisposition: 'DO_NOT_RETRY', reason: 'MOCK_REJECTED' });
    const compensation = await workflows.claimNext(scope, 'workflow-test-worker');
    assert.equal(compensation.step_key, 'compensate_quote_accepted');
    await workflows.recordOutcome(scope, compensation.id, compensation.attemptId,
      { kind: 'DEFINITE_SUCCESS', providerReference: 'mock-quote-release' });
    const recoveredWorkflow = await workflows.get(scope, recoveryWorkflow.id);
    assert.equal(recoveredWorkflow.status, 'RECOVERY_COMPLETE');
    assert.equal(recoveredWorkflow.steps.find((step) => step.step_key === 'quote_accepted').status, 'COMPENSATED');
    console.log('Workflow integration passed: persisted steps, stable retry key, crash-to-unknown recovery, dependent-step blocking, tenant isolation, sandbox completion.');
  } finally { await app.close(); }
});
