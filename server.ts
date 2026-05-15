import express from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import { createServer as createViteServer } from 'vite';

// Firebase Admin — for generating custom tokens (Bitrix auth)
let firebaseAdmin: any = null;
function getAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const adminModule = require('firebase-admin');
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!b64) {
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_BASE64 not set — Bitrix auto-login disabled');
      return null;
    }
    const serviceAccount = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    if (!adminModule.apps.length) {
      adminModule.initializeApp({ credential: adminModule.credential.cert(serviceAccount) });
    }
    firebaseAdmin = adminModule;
    return firebaseAdmin;
  } catch (e: any) {
    console.error('Firebase Admin init failed:', e.message);
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // ─────────────────────────────────────────────────────────────────────
  // BITRIX24 AUTO-LOGIN
  // 1. Client sends Bitrix access_token + domain
  // 2. We verify it against the Bitrix REST API
  // 3. We return a Firebase Custom Token with UID = "bitrix_{id}"
  //    so every Bitrix user gets a stable, persistent Firebase identity
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/bitrix-auth', async (req, res) => {
    const { bitrixDomain, accessToken } = req.body;
    if (!bitrixDomain || !accessToken) {
      return res.status(400).json({ error: 'bitrixDomain and accessToken required' });
    }

    const admin = getAdmin();
    if (!admin) {
      return res.status(503).json({ error: 'Firebase Admin not configured on server' });
    }

    try {
      // Verify token by calling Bitrix API server-side (no CORS issues here)
      const domain = bitrixDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const bxRes = await axios.get(`https://${domain}/rest/user.current`, {
        params: { auth: accessToken },
        timeout: 10_000
      });

      const bxUser = bxRes.data?.result;
      if (!bxUser?.ID) {
        return res.status(401).json({ error: 'Invalid Bitrix token' });
      }

      // Stable Firebase UID tied to this Bitrix user
      const firebaseUid = `bitrix_${bxUser.ID}`;

      const customToken = await admin.auth().createCustomToken(firebaseUid, {
        bitrixId: String(bxUser.ID),
        isAdmin: !!bxUser.IS_ADMIN
      });

      res.json({
        customToken,
        profile: {
          id: firebaseUid,
          bitrixId: String(bxUser.ID),
          name: `${bxUser.NAME || ''} ${bxUser.LAST_NAME || ''}`.trim() || 'Сотрудник',
          email: bxUser.EMAIL || '',
          position: bxUser.WORK_POSITION || 'Сотрудник iBOX',
          avatar: bxUser.PERSONAL_PHOTO || '',
          isAdmin: !!bxUser.IS_ADMIN,
          departmentIds: bxUser.UF_DEPARTMENT || []
        }
      });
    } catch (e: any) {
      console.error('Bitrix auth error:', e.message);
      res.status(500).json({ error: 'Bitrix auth failed', details: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // GEMINI API PROXY
  // Browser → POST /api/ai-proxy/v1beta/models/... → Google Gemini
  // The SDK sends apiKey:'proxy' in x-goog-api-key header;
  // we replace it with the real key here.
  // ─────────────────────────────────────────────────────────────────────
  app.all(['/api/ai-proxy', '/api/ai-proxy/*'], async (req, res) => {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      console.error('[AI Proxy] GEMINI_API_KEY not set');
      return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    try {
      // Strip our prefix to get the real Gemini API path
      const proxyPath = req.path.replace(/^\/api\/ai-proxy/, '') || '/';

      // Build query string — drop any 'key' param the SDK might have added
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        if (k !== 'key') searchParams.append(k, String(v));
      }
      searchParams.set('key', GEMINI_KEY);

      const targetUrl = `https://generativelanguage.googleapis.com${proxyPath}?${searchParams}`;
      console.log(`[AI Proxy] ${req.method} ${proxyPath}`);

      const response = await axios({
        method: req.method as any,
        url: targetUrl,
        data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'x-goog-api-key': GEMINI_KEY,
        },
        responseType: 'stream',
        timeout: 180_000
      });

      res.status(response.status);
      if (response.headers['content-type']) res.setHeader('Content-Type', String(response.headers['content-type']));
      response.data.pipe(res);
    } catch (error: any) {
      console.error('[AI Proxy] Error:', error.message);
      if (error.response) {
        console.error('[AI Proxy] Google responded:', error.response.status);
        res.status(error.response.status);
        if (error.response.headers?.['content-type']) res.setHeader('Content-Type', String(error.response.headers['content-type']));
        error.response.data.pipe(res);
      } else {
        res.status(500).json({ error: 'AI proxy failed', details: error.message });
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // AI DIAGNOSTIC — GET /api/test-ai
  // Verifies Gemini connection server-side without going through the proxy
  // ─────────────────────────────────────────────────────────────────────
  app.get('/api/test-ai', async (req, res) => {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.json({ ok: false, error: 'GEMINI_API_KEY not set on server' });
    }
    try {
      const result = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        { contents: [{ role: 'user', parts: [{ text: 'Say "OK" in one word.' }] }] },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 }
      );
      const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '(empty)';
      res.json({ ok: true, response: text, model: 'gemini-2.0-flash' });
    } catch (e: any) {
      const status = e.response?.status;
      const data = e.response?.data;
      res.json({
        ok: false,
        status,
        error: e.message,
        googleError: typeof data === 'object' ? JSON.stringify(data) : data,
        keyPresent: !!GEMINI_KEY,
        keyPrefix: GEMINI_KEY ? GEMINI_KEY.slice(0, 8) + '...' : null,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // PROXY FETCH — for AI media extraction
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/proxy-fetch', async (req, res) => {
    try {
      let { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      if (url.includes('drive.google.com/file/d/')) {
        const fileId = url.split('/d/')[1].split('/')[0];
        url = `https://drive.google.com/uc?export=download&id=${fileId}`;
      } else if (url.includes('drive.google.com/open?id=')) {
        const fileId = url.split('id=')[1].split('&')[0];
        url = `https://drive.google.com/uc?export=download&id=${fileId}`;
      } else if (url.includes('docs.google.com/presentation/d/')) {
        const docId = url.split('/d/')[1].split('/')[0];
        url = `https://docs.google.com/presentation/d/${docId}/export/pdf`;
      } else if (url.includes('docs.google.com/document/d/')) {
        const docId = url.split('/d/')[1].split('/')[0];
        url = `https://docs.google.com/document/d/${docId}/export?format=pdf`;
      }

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' },
        timeout: 30_000
      });

      res.json({
        base64: Buffer.from(response.data).toString('base64'),
        contentType: response.headers['content-type'],
        size: response.data.length
      });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to fetch external content' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // BITRIX24 HANDLER ENTRY POINT (POST /)
  // ─────────────────────────────────────────────────────────────────────
  app.post('/', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    } else {
      res.redirect(302, '/');
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // STATIC / VITE
  // ─────────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (!process.env.GEMINI_API_KEY) console.warn('⚠️  GEMINI_API_KEY not set');
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT_BASE64 not set — Bitrix auto-login disabled');
  });
}

startServer();
