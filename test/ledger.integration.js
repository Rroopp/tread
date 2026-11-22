const test = require('node:test');
const assert = require('node:assert/strict');

test('ledger locks balances, reserves holds, captures, reverses, and replays idempotently', async () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL database name must clearly contain "test"; refusing to write elsewhere');
  }
  process.env.DATABASE_URL = testDatabaseUrl;
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { AccountsService } = require('../dist/modules/accounts/accounts.service');
  const { LedgerService } = require('../dist/modules/ledger/ledger.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('TREAD Ledger Test', $1, 'KE', 'ACTIVE') RETURNING id`,
      [`Ledger test ${Date.now()}-${Math.random()}`],
    );
    const institutionId = institution.rows[0].id;
    const environment = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`,
      [institutionId],
    );
    const environmentId = environment.rows[0].id;
    const accounts = app.get(AccountsService);
    const settlement = await accounts.create(institutionId, environmentId, {
      accountRef: 'settlement', assetCode: 'KES', accountType: 'SETTLEMENT',
    });
    const fee = await accounts.create(institutionId, environmentId, {
      accountRef: 'fee', assetCode: 'KES', accountType: 'FEE',
    });
    const ledger = app.get(LedgerService);

    await ledger.postJournal({
      institutionId, environmentId, assetCode: 'KES', referenceType: 'TEST', referenceId: 'fund-1',
      entries: [
        { accountId: settlement.id, direction: 'DEBIT', amountMinor: 1000n },
        { accountId: fee.id, direction: 'CREDIT', amountMinor: 1000n },
      ],
    });

    const holdInput = { institutionId, environmentId, accountId: settlement.id, idempotencyKey: 'hold-1', amountMinor: 400n };
    const [hold, holdReplay] = await Promise.all([
      ledger.createHold(holdInput),
      ledger.createHold(holdInput),
    ]);
    assert.equal(holdReplay.holdId, hold.holdId);
    assert.equal([hold.replayed, holdReplay.replayed].filter((value) => value === false).length, 1);
    assert.equal([hold.replayed, holdReplay.replayed].filter((value) => value === true).length, 1);
    const heldBalance = await accounts.find(institutionId, environmentId, settlement.id);
    assert.equal(heldBalance.balanceMinor, '1000');
    assert.equal(heldBalance.availableMinor, '600');

    await assert.rejects(ledger.postJournal({
      institutionId, environmentId, assetCode: 'KES', referenceType: 'TEST', referenceId: 'overspend',
      entries: [
        { accountId: settlement.id, direction: 'CREDIT', amountMinor: 700n },
        { accountId: fee.id, direction: 'DEBIT', amountMinor: 700n },
      ],
    }));

    const capture = await ledger.postJournal({
      institutionId, environmentId, assetCode: 'KES', referenceType: 'TEST', referenceId: 'capture-1',
      captureHoldId: hold.holdId,
      entries: [
        { accountId: settlement.id, direction: 'CREDIT', amountMinor: 400n },
        { accountId: fee.id, direction: 'DEBIT', amountMinor: 400n },
      ],
    });
    const reversalInput = {
      institutionId, environmentId, journalTransactionId: capture.journalTransactionId, referenceId: 'reverse-capture-1',
    };
    const reversal = await ledger.reverseJournal(reversalInput);
    const reversalReplay = await ledger.reverseJournal(reversalInput);
    assert.equal(reversalReplay.journalTransactionId, reversal.journalTransactionId);
    assert.equal(reversalReplay.replayed, true);
    const restoredBalance = await accounts.find(institutionId, environmentId, settlement.id);
    assert.equal(restoredBalance.availableMinor, '1000');
    const competing = await Promise.allSettled([
      ledger.createHold({ institutionId, environmentId, accountId: settlement.id, idempotencyKey: 'race-hold-a', amountMinor: 600n }),
      ledger.createHold({ institutionId, environmentId, accountId: settlement.id, idempotencyKey: 'race-hold-b', amountMinor: 600n }),
    ]);
    assert.equal(competing.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(competing.filter((item) => item.status === 'rejected').length, 1);
    const winningHold = competing.find((item) => item.status === 'fulfilled').value;
    await ledger.releaseHold(institutionId, environmentId, settlement.id, winningHold.holdId);
  } finally {
    await app.close();
  }
});
