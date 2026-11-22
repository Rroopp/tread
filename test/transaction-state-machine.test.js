const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSACTION_TRANSITIONS } = require('../dist/modules/transactions/transactions.service.js');

test('a funded transaction must enter compliance review before approval', () => {
  assert.deepEqual(TRANSACTION_TRANSITIONS.FUNDED, ['COMPLIANCE_PENDING', 'FAILED', 'REQUIRES_REVIEW']);
  assert.equal(TRANSACTION_TRANSITIONS.FUNDED.includes('APPROVED'), false);
});

test('a transaction under review cannot skip directly to approval or execution', () => {
  assert.deepEqual(TRANSACTION_TRANSITIONS.REQUIRES_REVIEW, ['COMPLIANCE_PENDING', 'FAILED', 'CANCELLED']);
});

test('execution follows an approved transaction only', () => {
  assert.deepEqual(TRANSACTION_TRANSITIONS.APPROVED, ['EXECUTING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW']);
  assert.equal(TRANSACTION_TRANSITIONS.CREATED.includes('EXECUTING'), false);
});
