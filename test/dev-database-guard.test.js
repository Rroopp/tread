const test = require('node:test');
const assert = require('node:assert/strict');
const { assertDevelopmentDatabaseSafe } = require('../dist/database/dev-database-guard.js');

const local = {
  NODE_ENV: 'development',
  TREAD_ALLOW_DEV_DATABASE_MUTATIONS: 'true',
  DATABASE_URL: 'postgresql://tread:local-password@localhost:5432/tread',
};

test('requires explicit local database opt-in', () => {
  assert.throws(() => assertDevelopmentDatabaseSafe({ ...local, TREAD_ALLOW_DEV_DATABASE_MUTATIONS: undefined }), /explicitly enable/);
});

test('rejects production runtime even when the local opt-in is set', () => {
  assert.throws(() => assertDevelopmentDatabaseSafe({ ...local, NODE_ENV: 'production' }), /disabled in production/);
});

test('rejects remote database hosts', () => {
  assert.throws(() => assertDevelopmentDatabaseSafe({ ...local, DATABASE_URL: 'postgresql://user:pass@db.prod.example:5432/tread' }), /only permit the local PostgreSQL hosts/);
});

test('rejects production-named local databases', () => {
  assert.throws(() => assertDevelopmentDatabaseSafe({ ...local, DATABASE_URL: 'postgresql://user:pass@localhost:5432/tread_production' }), /reject production database names/);
});

test('accepts explicitly enabled local development database targets', () => {
  assert.doesNotThrow(() => assertDevelopmentDatabaseSafe(local));
  assert.doesNotThrow(() => assertDevelopmentDatabaseSafe({ ...local, DATABASE_URL: 'postgresql://tread:local-password@postgres:5432/tread' }));
});
