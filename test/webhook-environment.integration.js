const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { WebhookDeliveryWorker } = require('../dist/modules/webhooks/webhook-delivery.worker.js');

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL to a migrated disposable PostgreSQL database');
if (!/(^|[_-])test([_-]|$)/i.test(new URL(url).pathname)) {
  throw new Error('TEST_DATABASE_URL database name must clearly contain "test"');
}

test('outbox fan-out only reaches endpoints in the event environment', async () => {
  const pool = new Pool({ connectionString: url });
  const tag = randomUUID();
  let institutionId;
  try {
    const institution = await pool.query(
      `INSERT INTO institutions (legal_name, display_name, country_code, status)
       VALUES ($1, $2, 'KE', 'ACTIVE') RETURNING id`,
      [`Webhook isolation ${tag}`, `Webhook isolation ${tag}`],
    );
    institutionId = institution.rows[0].id;
    const sandbox = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'SANDBOX', 'ACTIVE') RETURNING id`, [institutionId],
    );
    const production = await pool.query(
      `INSERT INTO institution_environments (institution_id, environment, status)
       VALUES ($1, 'PRODUCTION', 'ACTIVE') RETURNING id`, [institutionId],
    );
    const sandboxEnvironmentId = sandbox.rows[0].id;
    const productionEnvironmentId = production.rows[0].id;
    const endpoints = await pool.query(
      `INSERT INTO webhook_endpoints
        (institution_id, environment_id, url, description, secret_ciphertext, secret_iv, secret_auth_tag, event_types)
       VALUES ($1, $2, 'https://sandbox.example.test/hook', 'sandbox', 'x', 'x', 'x', ARRAY['audit.test']),
              ($1, $3, 'https://production.example.test/hook', 'production', 'x', 'x', 'x', ARRAY['audit.test'])
       RETURNING id, environment_id`,
      [institutionId, sandboxEnvironmentId, productionEnvironmentId],
    );
    const sandboxEndpointId = endpoints.rows.find((row) => row.environment_id === sandboxEnvironmentId).id;
    const productionEndpointId = endpoints.rows.find((row) => row.environment_id === productionEnvironmentId).id;
    const eventIds = [randomUUID(), randomUUID(), randomUUID()];
    await pool.query(
      `INSERT INTO outbox_events
        (id, institution_id, environment_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, 'test', $4, 'audit.test', '{"mode":"sandbox"}'),
              ($5, $2, $6, 'test', $7, 'audit.test', '{"mode":"production"}'),
              ($8, $2, NULL, 'test', $9, 'audit.test', '{"mode":"unspecified"}')`,
      [eventIds[0], institutionId, sandboxEnvironmentId, randomUUID(),
        eventIds[1], productionEnvironmentId, randomUUID(), eventIds[2], randomUUID()],
    );

    const worker = new WebhookDeliveryWorker(pool, {});
    await worker.fanOutOutboxEvents();
    const deliveries = await pool.query(
      `SELECT endpoint_id, outbox_event_id, environment_id FROM webhook_deliveries
       WHERE institution_id = $1 AND outbox_event_id = ANY($2::uuid[])`, [institutionId, eventIds],
    );
    assert.equal(deliveries.rows.length, 2);
    assert.deepEqual(deliveries.rows.map((row) => [row.endpoint_id, row.outbox_event_id, row.environment_id]).sort(), [
      [sandboxEndpointId, eventIds[0], sandboxEnvironmentId],
      [productionEndpointId, eventIds[1], productionEnvironmentId],
    ].sort());
  } finally {
    if (institutionId) {
      await pool.query('DELETE FROM webhook_deliveries WHERE institution_id = $1', [institutionId]);
      await pool.query('DELETE FROM outbox_events WHERE institution_id = $1', [institutionId]);
      await pool.query('DELETE FROM webhook_endpoints WHERE institution_id = $1', [institutionId]);
      await pool.query('DELETE FROM institution_environments WHERE institution_id = $1', [institutionId]);
      await pool.query('DELETE FROM institutions WHERE id = $1', [institutionId]);
    }
    await pool.end();
  }
});
