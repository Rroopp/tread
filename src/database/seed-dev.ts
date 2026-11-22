import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { POSTGRES_POOL } from './database.module';
import { ApiKeyService } from '../modules/identity/api-key.service';
import { assertDevelopmentDatabaseSafe } from './dev-database-guard';

async function seedDevelopmentInstitution(): Promise<void> {
  assertDevelopmentDatabaseSafe();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const pool = app.get<Pool>(POSTGRES_POOL);
    const client = await pool.connect();
    let institutionId: string;
    let environmentId: string;
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM institutions
         WHERE display_name = 'TREAD Local Sandbox Institution' AND country_code = 'KE'
         FOR UPDATE`,
      );
      institutionId = existing.rows[0]?.id;
      if (institutionId) {
        await client.query(
          `UPDATE institutions SET status = 'ACTIVE', updated_at = now() WHERE id = $1`,
          [institutionId],
        );
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO institutions (legal_name, display_name, country_code, status)
           VALUES ('TREAD Local Sandbox Institution Ltd', 'TREAD Local Sandbox Institution', 'KE', 'ACTIVE')
           RETURNING id`,
        );
        institutionId = created.rows[0].id;
      }

      const environment = await client.query<{ id: string }>(
        `INSERT INTO institution_environments (institution_id, environment, status)
         VALUES ($1, 'SANDBOX', 'ACTIVE')
         ON CONFLICT (institution_id, environment)
         DO UPDATE SET status = 'ACTIVE'
         RETURNING id`,
        [institutionId],
      );
      environmentId = environment.rows[0].id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const credentials = await app.get(ApiKeyService).issue(
      institutionId,
      environmentId,
      'Local development sandbox key',
      ['transactions:read', 'transactions:write', 'accounts:read', 'accounts:write', 'quotes:read', 'quotes:write', 'transactions:sandbox_simulate', 'webhooks:read', 'webhooks:write'],
    );
    console.log('Local sandbox institution ready. Store this key securely; it is shown once:');
    console.log(credentials.token);
  } finally {
    await app.close();
  }
}

void seedDevelopmentInstitution().catch((error: unknown) => {
  console.error('Development seed failed', error);
  process.exitCode = 1;
});
