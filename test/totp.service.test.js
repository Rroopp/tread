const test = require('node:test');
const assert = require('node:assert/strict');
const { TotpService } = require('../dist/modules/identity/totp.service.js');

test('TOTP matches an RFC 6238 SHA-1 vector and rejects malformed codes', () => {
  const service = new TotpService();
  // RFC secret "12345678901234567890", encoded as base32.
  assert.equal(service.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 30_000), 1);
  assert.equal(service.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287083', 30_000), null);
  assert.equal(service.verify('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082x', 30_000), null);
});

test('recovery codes are random, normalized before hashing, and stored as hashes', () => {
  const service = new TotpService();
  const [first, second] = service.recoveryCodes(2);
  assert.notEqual(first, second);
  assert.match(first, /^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/);
  assert.equal(service.hashRecoveryCode(first), service.hashRecoveryCode(first.toLowerCase().replaceAll('-', '')));
  assert.equal(service.hashRecoveryCode(first).includes(first), false);
});
