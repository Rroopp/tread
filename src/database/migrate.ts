import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = new Pool({ connectionString, max: 1, application_name: 'tread-migrations' });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [731904221]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationDirectory = join(process.cwd(), 'database', 'migrations');
    const files = (await readdir(migrationDirectory))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    const appliedResult = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationDirectory, file), 'utf8');
      console.log(`Applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Database migrations are up to date.');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [731904221]);
    } finally {
      client.release();
      await pool.end();
    }
  }
}

void migrate().catch((error: unknown) => {
  console.error('Database migration failed', error);
  process.exitCode = 1;
});
