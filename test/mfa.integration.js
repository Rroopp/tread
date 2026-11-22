const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { Pool } = require('pg');

function totp(secret, step) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(output)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test('owner login requires MFA setup; recovery codes are hashed and one-time', async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
  if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL database name must contain "test"');
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'development';
  process.env.AUTH_ACCESS_TOKEN_SECRET ||= 'mfa-integration-only-auth-secret-value';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const { POSTGRES_POOL } = require('../dist/database/database.module');
  const { AuthService } = require('../dist/modules/identity/auth.service');
  const { PasswordHasherService } = require('../dist/modules/identity/password-hasher.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const pool = app.get(POSTGRES_POOL);
  try {
    const password = 'Mfa-test-password-not-a-real-user-938!';
    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ('MFA Integration', $1, 'KE', 'ACTIVE') RETURNING id`, [`MFA ${randomUUID()}`],
    );
    const institutionId = institution.rows[0].id;
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, status, email_verified_at)
       VALUES ($1, $2, 'ACTIVE', now()) RETURNING id`, [`mfa-${randomUUID()}@test.invalid`, passwordHash],
    );
    const userId = user.rows[0].id;
    await pool.query(`INSERT INTO institution_memberships (institution_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [institutionId, userId]);
    const auth = app.get(AuthService);
    const login = await auth.login(`mfa-${'unused'}`, password, institutionId).catch(() => null);
    assert.equal(login, null, 'unknown email does not disclose account state');
    const email = (await pool.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0].email;
    const setupChallenge = await auth.login(email, password, institutionId);
    assert.equal(setupChallenge.mfaSetupRequired, true);
    const setup = await auth.startMfaSetup(setupChallenge.challengeToken);
    const setupCode = totp(setup.secret, Math.floor(Date.now() / 30_000));
    const enabled = await auth.confirmMfaSetup(setupChallenge.challengeToken, setupCode);
    assert.equal(enabled.recoveryCodes.length, 10);
    const persisted = await pool.query(`SELECT code_hash FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId]);
    assert.equal(persisted.rows.length, 10);
    assert.equal(persisted.rows.some((row) => enabled.recoveryCodes.includes(row.code_hash)), false);

    const secondLogin = await auth.login(email, password, institutionId);
    assert.equal(secondLogin.mfaRequired, true);
    const session = await auth.finishMfaLogin(secondLogin.challengeToken, undefined, enabled.recoveryCodes[0]);
    assert.ok(session.accessToken);
    await assert.rejects(
      auth.finishMfaLogin(secondLogin.challengeToken, undefined, enabled.recoveryCodes[0]),
      (error) => error.status === 401,
    );
    console.log('MFA integration passed: privileged setup challenge, hashed recovery storage, and one-time recovery use.');
  } finally { await app.close(); }
});
