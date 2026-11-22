import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run admin:revoke -- <user-email>');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(`SELECT id FROM users WHERE email_normalized = $1 FOR UPDATE`, [email]);
      if (!user.rows[0]) throw new Error('User was not found');
      await client.query(`UPDATE system_admin_grants SET status = 'DISABLED', updated_at = now() WHERE user_id = $1`, [user.rows[0].id]);
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.grant.revoked', 'system_admin_grant', $1, $2::jsonb)`,
        [user.rows[0].id, JSON.stringify({ email })],
      );
      await client.query('COMMIT');
      process.stdout.write(`Disabled internal admin grant for ${email}\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Internal admin revoke failed'}\n`); process.exitCode = 1; });
