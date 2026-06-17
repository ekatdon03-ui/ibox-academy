// ─────────────────────────────────────────────────────────────────────────────
// JWT auth — replaces Firebase Auth. Bitrix login is verified server-side
// (see /api/bitrix-auth in server.ts), then we issue our own signed JWT.
//
// Env: JWT_SECRET (required for real auth; falls back to a dev secret otherwise)
// ─────────────────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TTL = '30d';

export const ADMIN_UIDS = ['bitrix_DxMBjT1L'];
export const ADMIN_EMAILS = ['oap.ibox.company@gmail.com', 'pem@i-box.company'];

export interface AuthClaims {
  uid: string;
  bitrixId?: string;
  email?: string;
  role?: string;
  isAdmin?: boolean;
}

export function signToken(claims: AuthClaims): string {
  return jwt.sign(claims, SECRET, { expiresIn: TTL });
}

export function verifyToken(token: string): AuthClaims | null {
  try {
    return jwt.verify(token, SECRET) as AuthClaims;
  } catch {
    return null;
  }
}

function claimsFromHeader(authHeader?: string): AuthClaims | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.slice(7));
}

export function isAdminClaims(c: AuthClaims | null): boolean {
  if (!c) return false;
  return c.role === 'admin' || c.isAdmin === true ||
    ADMIN_UIDS.includes(c.uid) || ADMIN_EMAILS.includes(c.email || '');
}

// Express middleware: requires a valid token, attaches req.user
export function requireAuth(req: any, res: any, next: any) {
  const c = claimsFromHeader(req.headers.authorization);
  if (!c) return res.status(401).json({ error: 'Unauthorized' });
  req.user = c;
  next();
}

// Express middleware: requires admin
export function requireAdmin(req: any, res: any, next: any) {
  const c = claimsFromHeader(req.headers.authorization);
  if (!isAdminClaims(c)) return res.status(403).json({ error: 'Admin only' });
  req.user = c;
  next();
}

// Soft auth: attach req.user if a valid token is present, never blocks
export function softAuth(req: any, _res: any, next: any) {
  req.user = claimsFromHeader(req.headers.authorization);
  next();
}
