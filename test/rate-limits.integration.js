const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { PostgresThrottlerStorage } = require('../dist/modules/identity/postgres-throttler.storage.js');

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL database name must contain "test"');

test('shared throttler storage enforces limits across storage instances', async () => {
  const poolA = new Pool({ connectionString: url });
  const poolB = new Pool({ connectionString: url });
  const name = `rate-test-${randomUUID()}`;
  const key = createHash('sha256').update(name).digest('hex');
  const a = new PostgresThrottlerStorage(poolA);
  const b = new PostgresThrottlerStorage(poolB);
  try {
    assert.equal((await a.increment(key, 60_000, 2, 60_000, name)).isBlocked, false);
    assert.equal((await b.increment(key, 60_000, 2, 60_000, name)).isBlocked, false);
    assert.equal((await a.increment(key, 60_000, 2, 60_000, name)).isBlocked, true);
    assert.equal((await b.increment(key, 60_000, 2, 60_000, name)).isBlocked, true);
    const otherKey = createHash('sha256').update(`${name}:other`).digest('hex');
    assert.equal((await b.increment(otherKey, 60_000, 2, 60_000, name)).isBlocked, false);
  } finally {
    a.onModuleDestroy(); b.onModuleDestroy();
    await poolA.query('DELETE FROM api_rate_limits WHERE throttler_name = $1', [name]);
    await Promise.all([poolA.end(), poolB.end()]);
  }
});
