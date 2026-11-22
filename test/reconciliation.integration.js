const test = require('node:test');
const assert = require('node:assert/strict');

test('reconciliation matches, flags variance, records unmatched evidence, and replays batches', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must point to a database containing "test" in its name');
  process.env.DATABASE_URL = url;
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { TransactionsService } = require('../dist/modules/transactions/transactions.service');
  const { ReconciliationService } = require('../dist/modules/reconciliation/reconciliation.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    const inst = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('TREAD Reconciliation Test', $1, 'KE', 'ACTIVE') RETURNING id`,
      [`Reconciliation test ${Date.now()}-${Math.random()}`],
    );
    const institutionId = inst.rows[0].id;
    const env = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`, [institutionId]);
    const environmentId = env.rows[0].id;
    const transactions = app.get(TransactionsService);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const transaction = await transactions.create({
        institutionId, environmentId, assetCode: 'KES', amountMinor: 1n,
        idempotencyKey: `recon-tx-${Date.now()}-${i}`,
      });
      ids.push(transaction.id);
    }
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const providerCode = 'test-provider';
    const attemptSpecs = [
      { ref: `${runId}-match`, status: 'SUCCEEDED', asset: 'USD', amount: '500' },
      { ref: `${runId}-variance`, status: 'SUCCEEDED', asset: 'USD', amount: '500' },
      { ref: `${runId}-pending`, status: 'SUBMITTED', asset: 'USD', amount: '200' },
    ];
    for (let i = 0; i < attemptSpecs.length; i++) {
      const spec = attemptSpecs[i];
      await pool.query(
        `INSERT INTO provider_attempts
          (institution_id, environment_id, transaction_id, provider_code, attempt_number,
           idempotency_key, request_hash, status, provider_reference,
           settlement_asset_code, settlement_amount_minor)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`,
        [institutionId, environmentId, ids[i], providerCode, `attempt-${i}`, 'a'.repeat(64), spec.status,
          spec.ref, spec.asset, spec.amount],
      );
    }
    const input = {
      institutionId, environmentId, providerCode, idempotencyKey: `batch-${runId}`,
      observations: [
        { providerReference: attemptSpecs[0].ref, status: 'SETTLED', assetCode: 'USD', amountMinor: '500', observedAt: new Date().toISOString() },
        { providerReference: attemptSpecs[1].ref, status: 'SETTLED', assetCode: 'USD', amountMinor: '450', observedAt: new Date().toISOString() },
        { providerReference: `${runId}-missing`, status: 'SETTLED', assetCode: 'USD', amountMinor: '50', observedAt: new Date().toISOString() },
        { providerReference: attemptSpecs[2].ref, status: 'PROCESSING', assetCode: 'USD', amountMinor: '200', observedAt: new Date().toISOString() },
      ],
    };
    const reconciler = app.get(ReconciliationService);
    const batch = await reconciler.reconcileProviderBatch(input);
    assert.equal(batch.matched_count, 1);
    assert.equal(batch.variance_count, 1);
    assert.equal(batch.unmatched_count, 1);
    assert.deepEqual(batch.observations.map((item) => item.result).sort(), ['MATCHED', 'VARIANCE', 'UNMATCHED', 'PENDING'].sort());
    const replay = await reconciler.reconcileProviderBatch(input);
    assert.equal(replay.id, batch.id);
    assert.equal(replay.replayed, true);
    let feedContext;
    const fromFeed = await reconciler.reconcileFromStatementFeed({
      institutionId, environmentId, environment: 'SANDBOX', providerCode,
      idempotencyKey: `feed-${runId}`, period: { from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' },
    }, {
      providerCode,
      async fetchStatement(context, period) {
        feedContext = { context, period };
        return [{ providerReference: attemptSpecs[0].ref, status: 'SETTLED', assetCode: 'USD', amountMinor: '500', observedAt: new Date().toISOString() }];
      },
    });
    assert.equal(fromFeed.matched_count, 1);
    assert.equal(feedContext.context.institutionId, institutionId);
    assert.equal(feedContext.context.environmentId, environmentId);
    assert.equal(feedContext.context.environment, 'SANDBOX');
    await assert.rejects(reconciler.reconcileFromStatementFeed({
      institutionId, environmentId, environment: 'SANDBOX', providerCode,
      idempotencyKey: `bad-feed-${runId}`, period: { from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' },
    }, { providerCode: 'different-provider', fetchStatement: async () => [] }), (error) => error.status === 400);
  } finally {
    await app.close();
  }
});
