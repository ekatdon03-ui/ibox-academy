// ─────────────────────────────────────────────────────────────────────────────
// REST API client. Holds the JWT (issued by /api/bitrix-auth) and attaches it
// as a Bearer token on every request. Replaces the Firebase client SDK.
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'academy_token';

let token: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;

export const authToken = {
  get: () => token,
  set: (t: string | null) => {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  },
};

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function handle(resp: Response): Promise<any> {
  if (!resp.ok) {
    let msg = `${resp.status}`;
    try { const d = await resp.json(); msg = d.error || JSON.stringify(d); } catch (_) {}
    throw new Error(msg);
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}

export const api = {
  async get<T = any>(path: string): Promise<T> {
    return handle(await fetch(path, { headers: authHeaders() }));
  },
  async post<T = any>(path: string, body?: any): Promise<T> {
    return handle(await fetch(path, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
  },
  async put<T = any>(path: string, body?: any): Promise<T> {
    return handle(await fetch(path, {
      method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }));
  },
  async del<T = any>(path: string): Promise<T> {
    return handle(await fetch(path, { method: 'DELETE', headers: authHeaders() }));
  },
  // Multipart upload (files, Moodle XML)
  async upload<T = any>(path: string, form: FormData): Promise<T> {
    return handle(await fetch(path, { method: 'POST', headers: authHeaders(), body: form }));
  },
};
