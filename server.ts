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

// Named Firestore database — must use the correct databaseId, not "(default)"
const FIRESTORE_DB_ID = 'ai-studio-91afac71-e303-4eb5-9634-9a51b794c3c9';
let adminDb: any = null;
function getAdminDb() {
  const admin = getAdmin();
  if (!admin) return null;
  if (adminDb) return adminDb;
  try {
    // firebase-admin v10+ requires getFirestore(app, databaseId) for named databases.
    // admin.firestore().settings({ databaseId }) does NOT work — it's ignored.
    const { getFirestore } = require('firebase-admin/firestore');
    adminDb = getFirestore(admin.app(), FIRESTORE_DB_ID);
    return adminDb;
  } catch (e: any) {
    console.error('Admin Firestore init failed:', e.message);
    return null;
  }
}

const ADMIN_UIDS = ['bitrix_DxMBjT1L'];
const ADMIN_EMAILS_SERVER = ['oap.ibox.company@gmail.com', 'pem@i-box.company'];

async function verifyAdminToken(authHeader: string | undefined): Promise<string | null> {
  const admin = getAdmin();
  if (!admin || !authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    if (ADMIN_UIDS.includes(decoded.uid) || ADMIN_EMAILS_SERVER.includes(decoded.email || '')) {
      return decoded.uid;
    }
    // Check roles collection
    const db = getAdminDb();
    if (db) {
      const roleDoc = await db.collection('roles').doc(decoded.uid).get();
      if (roleDoc.data()?.role === 'admin') return decoded.uid;
    }
    return null;
  } catch {
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
  // ADMIN BOOTSTRAP — forcefully sets admin role via Firebase Admin SDK
  // GET /api/bootstrap-admin
  // ─────────────────────────────────────────────────────────────────────
  app.get('/api/bootstrap-admin', async (req, res) => {
    const admin = getAdmin();
    if (!admin) {
      return res.json({ ok: false, error: 'Firebase Admin SDK not configured (FIREBASE_SERVICE_ACCOUNT_BASE64 missing)' });
    }
    const db = getAdminDb();
    if (!db) {
      return res.json({ ok: false, error: `Admin Firestore failed — check service account project matches projectId: gen-lang-client-0564430645` });
    }
    const results: any[] = [];

    for (const email of ADMIN_EMAILS_SERVER) {
      try {
        const snap = await db.collection('users').where('email', '==', email).get();
        if (snap.empty) {
          results.push({ email, ok: false, error: 'User not found in Firestore (has not logged in yet)' });
          continue;
        }
        for (const docSnap of snap.docs) {
          const uid = docSnap.id;
          await db.collection('roles').doc(uid).set({ role: 'admin' }, { merge: true });
          await db.collection('users').doc(uid).set({ role: 'admin' }, { merge: true });
          results.push({ email, uid, ok: true });
        }
      } catch (e: any) {
        results.push({ email, ok: false, error: e.message });
      }
    }

    // Also force-set role for known Bitrix UID
    for (const uid of ADMIN_UIDS) {
      try {
        await db.collection('roles').doc(uid).set({ role: 'admin' }, { merge: true });
        results.push({ uid, ok: true, note: 'hardcoded UID' });
      } catch (e: any) {
        results.push({ uid, ok: false, error: e.message });
      }
    }

    try {
      const allUsers = await db.collection('users').limit(20).get();
      const userList = allUsers.docs.map((d: any) => ({ id: d.id, email: d.data().email, name: d.data().name, role: d.data().role }));
      res.json({ ok: true, results, allUsers: userList });
    } catch (_) {
      res.json({ ok: true, results });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // ADMIN FIRESTORE — bypasses client security rules via Admin SDK
  // POST /api/admin/firestore  { operation, collection, docId?, data?, merge? }
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/admin/firestore', async (req, res) => {
    const admin = getAdmin();
    if (!admin) return res.status(503).json({ error: 'Admin SDK not configured' });

    const uid = await verifyAdminToken(req.headers.authorization as string | undefined);
    if (!uid) return res.status(403).json({ error: 'Admin only' });

    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: 'Admin Firestore unavailable' });

    const { operation, collection: coll, docId, data, merge } = req.body;
    if (!coll) return res.status(400).json({ error: 'collection required' });

    try {
      if (operation === 'delete') {
        if (!docId) return res.status(400).json({ error: 'docId required for delete' });
        await db.collection(coll).doc(docId).delete();
        return res.json({ ok: true });
      }
      if (operation === 'set') {
        const ref = docId ? db.collection(coll).doc(docId) : db.collection(coll).doc();
        await ref.set(data, { merge: !!merge });
        return res.json({ ok: true, id: ref.id });
      }
      if (operation === 'update') {
        if (!docId) return res.status(400).json({ error: 'docId required for update' });
        await db.collection(coll).doc(docId).update(data);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'Unknown operation: ' + operation });
    } catch (e: any) {
      console.error('[Admin Firestore]', operation, coll, e.message);
      return res.status(500).json({ error: e.message });
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
  // RESOLVE PUBLIC URL — resolves Yandex Disk and other share links to direct download URLs
  // ─────────────────────────────────────────────────────────────────────
  app.get('/api/resolve-public', async (req: any, res: any) => {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl) { res.status(400).json({ error: 'No URL' }); return; }
    try {
      if (rawUrl.includes('disk.yandex.') || rawUrl.includes('yadi.sk')) {
        const apiResp = await axios.get(
          `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(rawUrl)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' }, timeout: 8000 }
        );
        if (apiResp.data?.href) { res.json({ url: apiResp.data.href }); return; }
      }
    } catch (_) { /* fall through to original URL */ }
    res.json({ url: rawUrl });
  });

  // PROXY FETCH — for AI media extraction
  // ─────────────────────────────────────────────────────────────────────
  app.post('/api/proxy-fetch', async (req, res) => {
    try {
      let { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      // Resolve Yandex Disk share links to direct download URLs
      if (url.includes('disk.yandex.') || url.includes('yadi.sk')) {
        try {
          const yadResp = await axios.get(
            `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }
          );
          if (yadResp.data?.href) url = yadResp.data.href;
        } catch (_) { /* use original URL */ }
      } else if (url.includes('drive.google.com/file/d/')) {
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
  // EXTRACT MEDIA KNOWLEDGE — server-side AI extraction for videos/audio/PDF
  // Uses Gemini Files API for large files and video/audio (speech transcription)
  // POST /api/extract-media-knowledge  { url: string }
  // ─────────────────────────────────────────────────────────────────────

  /** Resolve share links (Yandex Disk, Google Drive) to direct download URLs */
  async function resolveDownloadUrl(raw: string): Promise<string> {
    let url = raw;
    if (url.includes('disk.yandex.') || url.includes('yadi.sk')) {
      try {
        const r = await axios.get(
          `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }
        );
        if (r.data?.href) url = r.data.href;
      } catch {}
    } else if (url.includes('drive.google.com/file/d/')) {
      const id = url.split('/d/')[1]?.split('/')[0];
      if (id) url = `https://drive.google.com/uc?export=download&id=${id}`;
    } else if (url.includes('drive.google.com/open?id=')) {
      const id = url.split('id=')[1]?.split('&')[0];
      if (id) url = `https://drive.google.com/uc?export=download&id=${id}`;
    } else if (url.includes('docs.google.com/presentation/d/')) {
      const id = url.split('/d/')[1]?.split('/')[0];
      if (id) url = `https://docs.google.com/presentation/d/${id}/export/pdf`;
    } else if (url.includes('docs.google.com/document/d/')) {
      const id = url.split('/d/')[1]?.split('/')[0];
      if (id) url = `https://docs.google.com/document/d/${id}/export?format=pdf`;
    }
    return url;
  }

  /** Try to fetch YouTube auto-captions via timedtext API */
  async function getYouTubeTranscript(videoId: string): Promise<string | null> {
    for (const lang of ['ru', 'uk', 'en']) {
      try {
        const r = await axios.get(
          `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
        );
        if (r.data?.events && Array.isArray(r.data.events)) {
          const text = r.data.events
            .filter((e: any) => e.segs)
            .map((e: any) => e.segs.map((s: any) => s.utf8 ?? '').join(''))
            .filter(Boolean)
            .join(' ')
            .trim();
          if (text.length > 50) return `[Транскрипция YouTube (${lang})]:\n\n${text}`;
        }
      } catch {}
    }
    return null;
  }

  /** Upload buffer to Gemini Files API (resumable) and return file URI */
  async function uploadToFilesApi(buf: Buffer, mimeType: string, apiKey: string): Promise<{ uri: string; name: string }> {
    // Step 1: Initiate resumable upload
    const initRes = await axios.post(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${apiKey}`,
      { file: { displayName: 'ibox_media' } },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'X-Goog-Upload-Header-Content-Length': String(buf.length),
        },
        timeout: 20000,
      }
    );
    const uploadUrl = initRes.headers['x-goog-upload-url'] as string;
    if (!uploadUrl) throw new Error('Gemini Files API: no upload URL in response');

    // Step 2: Upload + finalize
    const uploadRes = await axios.put(uploadUrl, buf, {
      headers: {
        'Content-Type': mimeType,
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Length': String(buf.length),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600000,
    });
    const file = uploadRes.data?.file;
    if (!file?.uri) throw new Error('Gemini Files API: upload did not return file URI');

    // Step 3: Poll until ACTIVE
    let state: string = file.state ?? 'PROCESSING';
    let retries = 0;
    while (state === 'PROCESSING' && retries < 60) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const poll = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`,
          { timeout: 10000 }
        );
        state = poll.data?.state ?? 'PROCESSING';
      } catch {}
      retries++;
    }
    if (state !== 'ACTIVE') throw new Error(`Gemini Files API: file stuck in state ${state} after ${retries * 3}s`);
    return { uri: file.uri as string, name: file.name as string };
  }

  const EXTRACT_PROMPT = `Ты — точный конвертер материалов в текст. Задача: извлечь ВЕСЬ контент из этого файла без пропусков.

ОБЯЗАТЕЛЬНО:
- Для видео/аудио: транскрибируй речь полностью и дословно. Если говорят несколько людей — различай их ("Спикер 1:", "Спикер 2:").
- Для презентаций/PDF: обработай КАЖДЫЙ слайд/страницу — не пропускай ни одного.
- Сохраняй исходную структуру: заголовки, списки, таблицы, цифры, факты.
- Нумеруй разделы: "## Слайд 1", "## Часть 2" и т.д.
- Не сокращай и не перефразируй — переноси текст/речь как есть.
- Не добавляй комментарии от себя.`;

  app.post('/api/extract-media-knowledge', async (req: any, res: any) => {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });

    const { url: rawUrl } = req.body as { url?: string };
    if (!rawUrl) return res.status(400).json({ error: 'url required' });

    try {
      // ── YouTube: try captions API first ──
      const ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        const transcript = await getYouTubeTranscript(ytMatch[1]);
        if (transcript) return res.json({ text: transcript });
        return res.status(422).json({
          error: 'Субтитры для этого YouTube-видео недоступны. Включите субтитры на видео или используйте прямую ссылку на файл.',
        });
      }

      // ── Resolve share links ──
      const downloadUrl = await resolveDownloadUrl(rawUrl);

      // ── Download file (large timeout for videos) ──
      let fileBuf: Buffer;
      let mimeType: string;
      try {
        const dlRes = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' },
          timeout: 300000,                    // 5 min
          maxContentLength: 500 * 1024 * 1024, // 500 MB cap
        });
        fileBuf = Buffer.from(dlRes.data);
        mimeType = String(dlRes.headers['content-type'] || '').split(';')[0].trim() || 'application/octet-stream';
      } catch (e: any) {
        return res.status(502).json({ error: `Не удалось скачать файл: ${e.message}` });
      }

      if (mimeType.includes('text/html')) {
        return res.status(422).json({
          error: 'Получена HTML-страница вместо файла. Убедитесь, что доступ открыт «Всем по ссылке».',
        });
      }

      // Normalise unknown binary types by extension
      if (mimeType === 'application/octet-stream' || !mimeType) {
        const ext = rawUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
        const extMap: Record<string, string> = {
          mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo', mov: 'video/quicktime',
          mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
          m4a: 'audio/mp4', aac: 'audio/aac', pdf: 'application/pdf',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
        if (extMap[ext]) mimeType = extMap[ext];
      }

      const isMedia = mimeType.startsWith('video/') || mimeType.startsWith('audio/');
      const isLarge = fileBuf.length > 15 * 1024 * 1024; // > 15 MB → Files API

      let text: string;

      if (isMedia || isLarge) {
        // ── Gemini Files API (handles video/audio + large files) ──
        console.log(`[extract-media] Files API upload: ${(fileBuf.length / 1024 / 1024).toFixed(1)} MB, ${mimeType}`);
        const { uri: fileUri, name: fileName } = await uploadToFilesApi(fileBuf, mimeType, GEMINI_KEY);

        const genRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            contents: [{
              role: 'user',
              parts: [
                { fileData: { mimeType, fileUri } },
                { text: EXTRACT_PROMPT },
              ],
            }],
            generationConfig: { maxOutputTokens: 65536, temperature: 0.1 },
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 300000 }
        );
        text = genRes.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        // Cleanup uploaded file (best-effort)
        axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`, { timeout: 10000 }).catch(() => {});
      } else {
        // ── Inline base64 (small PDFs, images) ──
        console.log(`[extract-media] Inline: ${(fileBuf.length / 1024).toFixed(0)} KB, ${mimeType}`);
        const genRes = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
          {
            contents: [{
              role: 'user',
              parts: [
                { text: EXTRACT_PROMPT },
                { inlineData: { data: fileBuf.toString('base64'), mimeType } },
              ],
            }],
            generationConfig: { maxOutputTokens: 65536, temperature: 0.1 },
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 180000 }
        );
        text = genRes.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }

      if (!text) return res.status(422).json({ error: 'ИИ не смог извлечь контент из файла.' });

      // Strip NotebookLM-style footer if present
      const tail = text.slice(-600);
      const footerIdx = tail.search(/\n[-–—=*]{3,}\s*\n[\s\S]{0,300}NotebookLM/i);
      const cleaned = footerIdx !== -1 ? text.slice(0, text.length - 600 + footerIdx).trim() : text.trim();

      res.json({ text: cleaned });
    } catch (e: any) {
      console.error('[extract-media-knowledge]', e.message);
      res.status(500).json({ error: e.message || 'Extraction failed' });
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
