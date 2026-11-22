import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { PasswordHasherService } from '../modules/identity/password-hasher.service';
import { POSTGRES_POOL } from './database.module';
import { assertDevelopmentDatabaseSafe } from './dev-database-guard';

async function seedDevelopmentUser() {
  assertDevelopmentDatabaseSafe();
  const email = `operator.${randomBytes(5).toString('hex')}@tread.local`;
  const password = randomBytes(24).toString('base64url');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const pool = app.get<Pool>(POSTGRES_POOL);
    const passwordHash = await app.get(PasswordHasherService).hash(password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const institution = await client.query<{ id: string }>(
        `SELECT id FROM institutions WHERE display_name = 'TREAD Local Sandbox Institution'
         AND country_code = 'KE' AND status = 'ACTIVE' FOR UPDATE`,
      );
      const institutionId = institution.rows[0]?.id;
      if (!institutionId) throw new Error('Run npm run dev:seed first to create the local sandbox institution');
      const environment = await client.query(
        `SELECT 1 FROM institution_environments WHERE institution_id = $1
         AND environment = 'SANDBOX' AND status = 'ACTIVE'`, [institutionId],
      );
      if (!environment.rowCount) throw new Error('The local sandbox environment is not active');
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, status, email_verified_at)
         VALUES ($1, $2, 'ACTIVE', now()) RETURNING id`, [email, passwordHash],
      );
      const userId = user.rows[0].id;
      await client.query(
        `INSERT INTO institution_memberships (institution_id, user_id, role, status)
         VALUES ($1, $2, 'OWNER', 'ACTIVE')`, [institutionId, userId],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'development.operator_seeded', 'user', $3, jsonb_build_object('email', $4::text))`,
        [institutionId, userId, userId, email],
      );
      await client.query('COMMIT');
      process.stdout.write(`Local sandbox operator created. Sign in at http://localhost:3001/login\nInstitution ID: ${institutionId}\nEmail: ${email}\nPassword: ${password}\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } finally { await app.close(); }
}

void seedDevelopmentUser().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Development user seed failed'}\n`);
  process.exitCode = 1;
});
