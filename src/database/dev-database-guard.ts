import { URL } from 'node:url';

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

export function assertDevelopmentDatabaseSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Development database commands are disabled in production');
  }
  if (env.TREAD_ALLOW_DEV_DATABASE_MUTATIONS !== 'true') {
    throw new Error('Set TREAD_ALLOW_DEV_DATABASE_MUTATIONS=true to explicitly enable local development database commands');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  let database: URL;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('Development database commands require PostgreSQL');
  }

  const host = database.hostname.toLowerCase();
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, '')).toLowerCase();
  if (!LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error('Development database commands only permit the local PostgreSQL hosts localhost, loopback, or the local Compose postgres service');
  }
  if (!databaseName || /(^|[_-])(prod|production)([_-]|$)/.test(databaseName)) {
    throw new Error('Development database commands reject production database names');
  }
}
