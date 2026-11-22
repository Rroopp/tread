import 'dotenv/config';
import { Pool } from 'pg';

const allowedScopes = new Set(['platform:read', 'institutions:read', 'institutions:write', 'transactions:read', 'compliance:read', 'providers:read', 'providers:write']);

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const scopes = [...new Set((process.argv[3] ?? 'platform:read,institutions:read,transactions:read,compliance:read,providers:read,providers:write').split(',').map((item) => item.trim()).filter(Boolean))];
  if (!email || scopes.length === 0 || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error(`Usage: npm run admin:grant -- <verified-user-email> <comma-separated-scopes>\nAllowed scopes: ${[...allowedScopes].join(', ')}`);
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email_normalized = $1 AND status = 'ACTIVE' AND email_verified_at IS NOT NULL FOR UPDATE`, [email],
      );
      if (!user.rows[0]) throw new Error('An active, verified user with this email was not found');
      const userId = user.rows[0].id;
      await client.query(
        `INSERT INTO system_admin_grants (user_id, scopes, granted_by)
         VALUES ($1, $2, $1)
         ON CONFLICT (user_id) DO UPDATE SET scopes = EXCLUDED.scopes, status = 'ACTIVE', granted_by = EXCLUDED.granted_by, updated_at = now()`,
        [userId, scopes],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.grant.created_or_updated', 'system_admin_grant', $1, $2::jsonb)`,
        [userId, JSON.stringify({ email, scopes })],
      );
      await client.query('COMMIT');
      process.stdout.write(`Granted internal admin scopes to ${email}: ${scopes.join(', ')}\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Internal admin grant failed'}\n`); process.exitCode = 1; });
