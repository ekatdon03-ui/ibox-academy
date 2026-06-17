// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL connection pool (Timeweb managed Postgres) + schema bootstrap.
//
// Connection is configured via env vars (set on Render):
//   DATABASE_URL                  full connection string (preferred), OR
//   PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
//   DATABASE_CA_CERT              CA certificate contents (optional — auto-fetched if absent)
//   DATABASE_SSL=disable          to turn SSL off (not recommended)
// ─────────────────────────────────────────────────────────────────────────────
import { Pool } from 'pg';
import https from 'https';
import { SCHEMA_SQL } from './schema';

// Fetch a URL and return its text body. Used once for the CA cert.
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

let resolvedSsl: any = undefined; // undefined = not yet resolved

async function getSsl(): Promise<any> {
  if (resolvedSsl !== undefined) return resolvedSsl;
  if (process.env.DATABASE_SSL === 'disable') {
    resolvedSsl = false;
    return resolvedSsl;
  }
  const envCa = process.env.DATABASE_CA_CERT;
  if (envCa && envCa.trim()) {
    resolvedSsl = { ca: envCa.replace(/\\n/g, '\n'), rejectUnauthorized: true };
    console.log('[pg] SSL: using DATABASE_CA_CERT from env');
    return resolvedSsl;
  }
  // Auto-fetch Timeweb CA cert so verify-full works without manual setup
  try {
    const cert = await fetchText('https://st.timeweb.com/cloud-static/ca.crt');
    resolvedSsl = { ca: cert, rejectUnauthorized: true };
    console.log('[pg] SSL: fetched Timeweb CA cert from CDN (verify-full)');
  } catch (err: any) {
    console.warn('[pg] SSL: CA cert fetch failed, falling back to no-verify:', err.message);
    resolvedSsl = { rejectUnauthorized: false };
  }
  return resolvedSsl;
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const ssl = await getSsl();
  const common = {
    ssl,
    max: 10,
    keepAlive: true,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  };
  const connectionString = process.env.DATABASE_URL;
  pool = connectionString
    ? new Pool({ connectionString, ...common })
    : new Pool({
        host: process.env.PGHOST,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ...common,
      });
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  return pool;
}

export function dbConfigured(): boolean {
  return !!(process.env.DATABASE_URL || process.env.PGHOST);
}

const RETRYABLE = /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|ENETUNREACH|Connection terminated|timeout expired/i;

// Query with automatic retries on connection-level errors.
export async function query<T = any>(text: string, params?: any[], attempts = 4): Promise<{ rows: T[] }> {
  const p = await getPool();
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await p.query(text, params);
    } catch (e: any) {
      lastErr = e;
      if (!RETRYABLE.test(e.message || '')) throw e;
      await new Promise(r => setTimeout(r, 600 * (i + 1))); // 0.6s, 1.2s, 1.8s, 2.4s
    }
  }
  throw lastErr;
}

let schemaReady = false;
export async function initSchema(): Promise<void> {
  if (schemaReady || !dbConfigured()) return;
  try {
    await query(SCHEMA_SQL);
    schemaReady = true;
    console.log('[pg] schema ready');
  } catch (e: any) {
    console.error('[pg] schema init failed:', e.message);
    throw e;
  }
}
