// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL connection pool (Timeweb managed Postgres) + schema bootstrap.
//
// Connection is configured via env vars (set on Render):
//   DATABASE_URL                  full connection string (preferred), OR
//   PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
//   DATABASE_CA_CERT              CA certificate contents (Timeweb .crt), optional
//   DATABASE_SSL=disable          to turn SSL off (not recommended)
// ─────────────────────────────────────────────────────────────────────────────
import { Pool } from 'pg';
import { SCHEMA_SQL } from './schema';

let pool: Pool | null = null;

function buildSsl(): any {
  if (process.env.DATABASE_SSL === 'disable') return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.trim()) {
    // Proper CA verification when Timeweb cert is provided
    return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }
  // Timeweb requires SSL; without a CA we still connect but skip strict verify
  return { rejectUnauthorized: false };
}

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  pool = connectionString
    ? new Pool({ connectionString, ssl: buildSsl(), max: 10 })
    : new Pool({
        host: process.env.PGHOST,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: buildSsl(),
        max: 10,
      });
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  const p = getPool();
  return p.query(text, params);
}

export function dbConfigured(): boolean {
  return !!(process.env.DATABASE_URL || process.env.PGHOST);
}

let schemaReady = false;
export async function initSchema(): Promise<void> {
  if (schemaReady || !dbConfigured()) return;
  try {
    await getPool().query(SCHEMA_SQL);
    schemaReady = true;
    console.log('[pg] schema ready');
  } catch (e: any) {
    console.error('[pg] schema init failed:', e.message);
    throw e;
  }
}
