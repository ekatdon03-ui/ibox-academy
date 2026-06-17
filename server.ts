import express from 'express';
import path from 'path';
import cors from 'cors';
import axios from 'axios';
import multer from 'multer';
import { spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { initSchema, dbConfigured } from './server/db';
import * as repo from './server/repo';
import { uploadToS3, s3Configured } from './server/s3';
import { signToken, requireAdmin, isAdminClaims, verifyToken, ADMIN_UIDS, ADMIN_EMAILS } from './server/auth';
import { parseMoodleXml } from './server/moodle';

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

// Legacy admin email list kept for the bootstrap-admin diagnostic endpoint.
const ADMIN_EMAILS_SERVER = ADMIN_EMAILS;

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Bootstrap PostgreSQL schema (no-op if DB env not set yet)
  await initSchema().catch((e) => console.error('[startup] schema init error:', e.message));

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

      // Stable UID tied to this Bitrix user (kept identical to the old scheme
      // so existing data / assignments keep matching).
      const uid = `bitrix_${bxUser.ID}`;
      const email = bxUser.EMAIL || '';
      const isHardcodedAdmin = ADMIN_UIDS.includes(uid) || ADMIN_EMAILS.includes(email) || !!bxUser.IS_ADMIN;

      // Resolve department name (best-effort)
      let department = 'Общий отдел';
      try {
        const deptId = bxUser.UF_DEPARTMENT?.[0];
        if (deptId) {
          const dRes = await axios.get(`https://${domain}/rest/department.get`, {
            params: { auth: accessToken, ID: deptId }, timeout: 8000,
          });
          const d = dRes.data?.result?.[0];
          if (d?.NAME) department = d.NAME;
        }
      } catch (_) {}

      let profile: any = {
        id: uid,
        bitrixId: String(bxUser.ID),
        name: `${bxUser.NAME || ''} ${bxUser.LAST_NAME || ''}`.trim() || 'Сотрудник',
        email,
        position: bxUser.WORK_POSITION || 'Сотрудник iBOX',
        avatar: bxUser.PERSONAL_PHOTO || '',
        department,
      };

      // Persist / merge profile in Postgres (preserves assignedCourses etc. on conflict)
      if (dbConfigured()) {
        try {
          const existing = await repo.resolveUserProfile(uid);
          const dbRole = await repo.resolveUserRole(uid, existing?.role || 'employee');
          const role = isHardcodedAdmin ? 'admin' : dbRole;
          profile = { ...(existing || {}), ...profile, role,
            assignedCourses: existing?.assignedCourses || [] };
          await repo.saveProfile(profile);
          if (role === 'admin' || role === 'manager') await repo.setUserRole(uid, role);
        } catch (e: any) {
          console.warn('[bitrix-auth] profile persist failed:', e.message);
          profile.role = isHardcodedAdmin ? 'admin' : 'employee';
        }
      } else {
        profile.role = isHardcodedAdmin ? 'admin' : 'employee';
      }

      const token = signToken({ uid, bitrixId: String(bxUser.ID), email, role: profile.role, isAdmin: isHardcodedAdmin });
      res.json({ token, profile });
    } catch (e: any) {
      console.error('Bitrix auth error:', e.message);
      res.status(500).json({ error: 'Bitrix auth failed', details: e.message });
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // REST API — PostgreSQL-backed (replaces Firestore)
  // Public reads (courses/glossary) are open; writes require admin JWT.
  // ═════════════════════════════════════════════════════════════════════
  const wrap = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (e: any) { console.error('[api]', req.method, req.path, e.message); res.status(500).json({ error: e.message }); }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

  // Soft auth: attach req.user from a valid JWT if present; never blocks the request.
  // (The app runs only inside Bitrix and every client gets a token at login.)
  const requireAuthSoft = (req: any, _res: any, next: any) => {
    const h = req.headers.authorization;
    req.user = h?.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
    next();
  };

  // ── File upload → S3 ──────────────────────────────────────────────────
  app.post('/api/upload', requireAdmin, upload.single('file'), wrap(async (req, res) => {
    if (!s3Configured()) return res.status(503).json({ error: 'S3 не настроен на сервере' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const url = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url, name: req.file.originalname, size: req.file.size, contentType: req.file.mimetype });
  }));

  // ── Courses ───────────────────────────────────────────────────────────
  app.get('/api/courses', wrap(async (_req, res) => res.json(await repo.getAllCourses())));
  app.post('/api/courses', requireAdmin, wrap(async (req, res) => res.json({ id: await repo.createCourse(req.body) })));
  app.put('/api/courses/:id', requireAdmin, wrap(async (req, res) => { await repo.updateCourse(req.params.id, req.body); res.json({ ok: true }); }));
  app.delete('/api/courses/:id', requireAdmin, wrap(async (req, res) => { await repo.deleteCourse(req.params.id); res.json({ ok: true }); }));

  // ── Glossary ──────────────────────────────────────────────────────────
  app.get('/api/glossary', wrap(async (_req, res) => res.json(await repo.getGlossary())));
  app.post('/api/glossary', requireAdmin, wrap(async (req, res) => res.json({ id: await repo.addGlossaryTerm(req.body) })));
  app.put('/api/glossary/:id', requireAdmin, wrap(async (req, res) => { await repo.updateGlossaryTerm(req.params.id, req.body); res.json({ ok: true }); }));
  app.delete('/api/glossary/:id', requireAdmin, wrap(async (req, res) => { await repo.deleteGlossaryTerm(req.params.id); res.json({ ok: true }); }));

  // ── Results ───────────────────────────────────────────────────────────
  app.get('/api/results', requireAdmin, wrap(async (_req, res) => res.json(await repo.getAllResults())));
  app.get('/api/results/me', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getResultsForUser(req.user?.uid))));
  app.get('/api/results/user/:userId', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getResultsForUser(req.params.userId))));
  app.post('/api/results', requireAuthSoft, wrap(async (req, res) => { await repo.saveResult({ ...req.body, userId: req.body.userId || req.user?.uid }); res.json({ ok: true }); }));

  // ── Progress ──────────────────────────────────────────────────────────
  app.get('/api/progress/:userId/:courseId', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getCourseProgress(req.params.userId, req.params.courseId))));
  app.get('/api/progress/user/:userId', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getAllProgressForUser(req.params.userId))));
  app.post('/api/progress/lesson', requireAuthSoft, wrap(async (req, res) => {
    const { userId, courseId, lessonId, completed, totalLessons } = req.body;
    res.json(await repo.updateLessonProgress(userId || req.user?.uid, courseId, lessonId, completed, totalLessons));
  }));

  // ── Users ─────────────────────────────────────────────────────────────
  app.get('/api/users', requireAuthSoft, wrap(async (_req, res) => res.json(await repo.getAllUsers())));
  app.get('/api/users/:id', requireAuthSoft, wrap(async (req, res) => res.json(await repo.resolveUserProfile(req.params.id))));
  app.put('/api/users/:id', requireAuthSoft, wrap(async (req, res) => {
    // Users may edit their own profile; admins may edit anyone
    if (req.params.id !== req.user?.uid && !isAdminClaims(req.user)) return res.status(403).json({ error: 'forbidden' });
    await repo.saveProfile({ ...req.body, id: req.params.id }); res.json({ ok: true });
  }));
  app.delete('/api/users/:id', requireAdmin, wrap(async (req, res) => { await repo.deleteUserProfile(req.params.id); res.json({ ok: true }); }));
  app.post('/api/users/:id/role', requireAdmin, wrap(async (req, res) => { await repo.setUserRole(req.params.id, req.body.role); res.json({ ok: true }); }));
  app.post('/api/assign', requireAdmin, wrap(async (req, res) => { await repo.assignCourseToUser(req.body.userId, req.body.courseId); res.json({ ok: true }); }));
  app.post('/api/unassign', requireAdmin, wrap(async (req, res) => { await repo.unassignCourseFromUser(req.body.userId, req.body.courseId); res.json({ ok: true }); }));
  app.post('/api/mass-assign', requireAdmin, wrap(async (req, res) => res.json({ count: await repo.massAssignCourse(req.body.courseId, req.body.userIds || []) })));

  // ── Notifications ─────────────────────────────────────────────────────
  app.get('/api/notifications/:userId', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getNotifications(req.params.userId))));
  app.post('/api/notifications', requireAuthSoft, wrap(async (req, res) => { await repo.createNotification(req.body.userId, req.body.title, req.body.text); res.json({ ok: true }); }));
  app.post('/api/notifications/read', requireAuthSoft, wrap(async (req, res) => { await repo.markNotificationsRead(req.body.ids || []); res.json({ ok: true }); }));

  // ── AI settings ───────────────────────────────────────────────────────
  app.get('/api/ai-settings', wrap(async (_req, res) => res.json(await repo.getAISettings())));
  app.put('/api/ai-settings', requireAdmin, wrap(async (req, res) => { await repo.saveAISettings(req.body); res.json({ ok: true }); }));

  // ── Simulator sessions ────────────────────────────────────────────────
  app.post('/api/simulator', requireAuthSoft, wrap(async (req, res) => res.json({ id: await repo.saveSimulatorSession({ ...req.body, userId: req.body.userId || req.user?.uid }) })));
  app.get('/api/simulator/:userId', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getSimulatorSessions(req.params.userId))));

  // ── Question banks (Moodle XML import) ────────────────────────────────
  app.get('/api/question-banks', requireAdmin, wrap(async (_req, res) => res.json(await repo.getQuestionBanks())));
  app.get('/api/question-banks/:id', requireAuthSoft, wrap(async (req, res) => res.json(await repo.getQuestionBank(req.params.id))));
  app.delete('/api/question-banks/:id', requireAdmin, wrap(async (req, res) => { await repo.deleteQuestionBank(req.params.id); res.json({ ok: true }); }));
  app.post('/api/import-moodle', requireAdmin, upload.single('file'), wrap(async (req, res) => {
    const xml = req.file ? req.file.buffer.toString('utf-8') : req.body?.xml;
    if (!xml) return res.status(400).json({ error: 'xml file or body required' });
    const parsed = parseMoodleXml(xml);
    if (!parsed.questions.length) return res.status(422).json({ error: 'Не найдено поддерживаемых вопросов в XML (нужны multichoice / truefalse).', skipped: parsed.skipped });
    const title = req.body?.title || req.file?.originalname?.replace(/\.xml$/i, '') || 'Банк вопросов';
    const id = await repo.createQuestionBank({ title, courseId: req.body?.courseId, questions: parsed.questions });
    res.json({ id, title, count: parsed.questions.length, skipped: parsed.skipped });
  }));

  // ═════════════════════════════════════════════════════════════════════
  // ONE-TIME MIGRATION: Firestore → PostgreSQL (+ base64 files → S3)
  // POST /api/migrate-firebase   (admin JWT required)
  // Idempotent-ish: re-running overwrites rows with same ids. Nothing is lost.
  // ═════════════════════════════════════════════════════════════════════
  async function dataUrlToS3(value: any, nameHint: string): Promise<any> {
    if (typeof value !== 'string' || !value.startsWith('data:')) return value;
    if (!s3Configured()) return value; // leave as-is if S3 not ready
    try {
      const m = value.match(/^data:([^;]+);base64,(.*)$/s);
      if (!m) return value;
      const [, mime, b64] = m;
      const buf = Buffer.from(b64, 'base64');
      const ext = (mime.split('/')[1] || 'bin').split('+')[0];
      return await uploadToS3(buf, `${nameHint}.${ext}`, mime);
    } catch (e: any) {
      console.warn('[migrate] data-url upload failed:', e.message);
      return value;
    }
  }

  // Guard: allow an admin JWT OR a matching one-time MIGRATION_KEY (so the
  // migration can be triggered from a browser URL once, then the key removed).
  const migrateGuard = (req: any, res: any, next: any) => {
    const key = req.query?.key || req.body?.key;
    if (process.env.MIGRATION_KEY && key && key === process.env.MIGRATION_KEY) return next();
    const h = req.headers.authorization;
    const claims = h?.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
    if (isAdminClaims(claims)) return next();
    return res.status(403).json({ error: 'forbidden — нужен ключ миграции или админ-токен' });
  };

  app.all('/api/migrate-firebase', migrateGuard, wrap(async (_req, res) => {
    const fdb = getAdminDb();
    if (!fdb) return res.status(503).json({ error: 'Firebase Admin/Firestore not configured (FIREBASE_SERVICE_ACCOUNT_BASE64 missing)' });
    if (!dbConfigured()) return res.status(503).json({ error: 'PostgreSQL not configured' });
    await initSchema();

    const stats: Record<string, number> = {};
    const getAll = async (coll: string) => (await fdb.collection(coll).get()).docs;

    // Courses (+ embedded lessons; upload any base64 files to S3)
    let n = 0;
    for (const d of await getAll('courses')) {
      const c: any = { id: d.id, ...d.data() };
      c.thumbnail = await dataUrlToS3(c.thumbnail, `thumb_${d.id}`);
      c.fileUrl = await dataUrlToS3(c.fileUrl, `course_${d.id}`);
      if (Array.isArray(c.lessons)) {
        for (const l of c.lessons) {
          if (Array.isArray(l.fileUrls)) {
            const out: string[] = [];
            for (let i = 0; i < l.fileUrls.length; i++) out.push(await dataUrlToS3(l.fileUrls[i], `lesson_${l.id || ''}_${i}`));
            l.fileUrls = out;
          }
          if (l.fileUrl) l.fileUrl = await dataUrlToS3(l.fileUrl, `lesson_${l.id || ''}`);
        }
      }
      await repo.createCourse(c);
      n++;
    }
    stats.courses = n;

    // Glossary
    n = 0;
    for (const d of await getAll('glossary')) { await repo.addGlossaryTerm({ id: d.id, ...d.data() }); n++; }
    stats.glossary = n;

    // Users (+ avatar base64 → S3)
    n = 0;
    for (const d of await getAll('users')) {
      const u: any = { id: d.id, ...d.data() };
      u.avatar = await dataUrlToS3(u.avatar, `avatar_${d.id}`);
      await repo.saveProfile(u); n++;
    }
    stats.users = n;

    // Roles
    n = 0;
    for (const d of await getAll('roles')) { const r: any = d.data(); if (r?.role) { await repo.setUserRole(d.id, r.role); n++; } }
    stats.roles = n;

    // Results
    n = 0;
    for (const d of await getAll('results')) {
      const r: any = d.data();
      if (r.userId && r.courseId) { await repo.saveResult(r); n++; }
    }
    stats.results = n;

    // Progress
    n = 0;
    for (const d of await getAll('progress')) {
      const p: any = d.data();
      if (p.userId && p.courseId) { await repo.saveProgressRaw(p); n++; }
    }
    stats.progress = n;

    // Notifications
    n = 0;
    for (const d of await getAll('notifications')) {
      const nt: any = d.data();
      if (nt.userId) {
        await repo.createNotificationRaw({
          id: d.id, userId: nt.userId, title: nt.title || '', text: nt.text || '',
          read: !!nt.read,
          createdAt: nt.createdAt?.seconds ? new Date(nt.createdAt.seconds * 1000) : new Date(),
        });
        n++;
      }
    }
    stats.notifications = n;

    // Simulator sessions
    n = 0;
    for (const d of await getAll('simulator_sessions')) {
      const s: any = d.data();
      if (s.userId) { await repo.saveSimulatorSession(s); n++; }
    }
    stats.simulator_sessions = n;

    // AI settings
    try {
      const s = await fdb.collection('settings').doc('ai_prompts').get();
      if (s.exists) { await repo.saveAISettings(s.data()); stats.settings = 1; }
    } catch (_) {}

    res.json({ ok: true, migrated: stats });
  }));

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
  // EXTRACT MEDIA KNOWLEDGE
  // POST /api/extract-media-knowledge  { url: string }
  //
  // Strategy by URL type:
  //   YouTube     → Gemini native fileData.fileUri (no download, any length)
  //   Video/Audio → stream download → ffmpeg audio extraction (48 kbps mono)
  //                 → Gemini Files API upload. Audio from a 5 GB / 3-hour
  //                 video is only ~60 MB — well inside Gemini's 2 GB limit.
  //   PDF / image → inline base64 (fast path for small docs)
  // ─────────────────────────────────────────────────────────────────────

  // Lazy-load ffmpeg binary path (ffmpeg-static npm package)
  let _ffmpegPath: string | null | undefined = undefined;
  function getFfmpeg(): string | null {
    if (_ffmpegPath !== undefined) return _ffmpegPath;
    try {
      _ffmpegPath = require('ffmpeg-static') as string;
      console.log('[ffmpeg] binary at', _ffmpegPath);
    } catch {
      _ffmpegPath = null;
      console.warn('[ffmpeg] ffmpeg-static not available');
    }
    return _ffmpegPath;
  }

  /**
   * Pipe a readable video/audio stream through ffmpeg and return the
   * extracted audio as a Buffer (MP3, 48 kbps mono 22 kHz — speech quality).
   * A 5 GB / 3-hour video produces ~60 MB of audio.
   */
  function extractAudio(videoStream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const ffmpegBin = getFfmpeg();
      if (!ffmpegBin) return reject(new Error('ffmpeg-static not installed on server'));

      const ff = spawn(ffmpegBin, [
        '-i', 'pipe:0',    // stdin
        '-vn',             // drop video track entirely
        '-acodec', 'mp3',
        '-b:a', '48k',     // 48 kbps — clear speech, tiny file
        '-ac', '1',        // mono
        '-ar', '22050',    // 22 kHz sample rate (enough for human speech)
        '-f', 'mp3',
        'pipe:1',          // stdout
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const audioBufs: Buffer[] = [];
      const errBufs:   Buffer[] = [];

      ff.stdout.on('data', (d: Buffer) => audioBufs.push(d));
      ff.stderr.on('data', (d: Buffer) => errBufs.push(d));

      ff.on('close', (code) => {
        const audioBuffer = Buffer.concat(audioBufs);
        if (code === 0 && audioBuffer.length > 0) {
          console.log(`[ffmpeg] audio extracted: ${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB`);
          resolve(audioBuffer);
        } else {
          const errMsg = Buffer.concat(errBufs).toString().slice(-400);
          reject(new Error(`ffmpeg exit ${code}: ${errMsg}`));
        }
      });

      ff.on('error', reject);

      // Pipe video stream into ffmpeg stdin; ignore broken-pipe errors
      (videoStream as any).pipe(ff.stdin);
      ff.stdin.on('error', () => {});
    });
  }

  /** Upload a Buffer to Gemini Files API (resumable) and return file URI + name */
  async function uploadBufferToFilesApi(
    buf: Buffer,
    mimeType: string,
    apiKey: string
  ): Promise<{ uri: string; name: string }> {
    // Initiate
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
    if (!uploadUrl) throw new Error('Gemini Files API: no upload URL');

    // Upload + finalise
    const uploadRes = await axios.put(uploadUrl, buf, {
      headers: {
        'Content-Type': mimeType,
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Length': String(buf.length),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600000, // 10 min — audio buffer is at most ~200 MB
    });

    const file = uploadRes.data?.file;
    if (!file?.uri) throw new Error('Gemini Files API: no file URI in response');

    // Poll until ACTIVE
    let state: string = file.state ?? 'PROCESSING';
    let tries = 0;
    while (state === 'PROCESSING' && tries < 120) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const poll = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`,
          { timeout: 10000 }
        );
        state = poll.data?.state ?? 'PROCESSING';
      } catch {}
      tries++;
    }
    if (state !== 'ACTIVE') throw new Error(`Gemini: file stuck in state ${state}`);
    return { uri: file.uri as string, name: file.name as string };
  }

  /** Resolve share links to direct download URLs */
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

  /** Detect MIME type from URL extension when Content-Type is unhelpful */
  function mimeFromExt(url: string): string {
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      mp4: 'video/mp4', webm: 'video/webm', avi: 'video/x-msvideo',
      mov: 'video/quicktime', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
      m4a: 'audio/mp4', aac: 'audio/aac',
      pdf: 'application/pdf',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return map[ext] || '';
  }

  const EXTRACT_PROMPT = `Ты — точный конвертер материалов в текст. Извлеки ВЕСЬ контент без пропусков.

ПРАВИЛА:
- Видео/аудио: транскрибируй речь дословно. Разных спикеров обозначай ("Спикер 1:", "Спикер 2:").
- Презентации/PDF: обработай КАЖДЫЙ слайд / страницу — ни одного не пропускай.
- Сохраняй структуру: заголовки, списки, таблицы, числа, факты.
- Нумеруй разделы: "## Слайд 1", "## Часть 2" и т.д.
- Не сокращай и не перефразируй — текст/речь как есть.
- Никаких собственных комментариев.`;

  app.post('/api/extract-media-knowledge', async (req: any, res: any) => {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });

    const { url: rawUrl } = req.body as { url?: string };
    if (!rawUrl) return res.status(400).json({ error: 'url required' });

    const geminiGenerate = async (parts: any[]): Promise<string> => {
      const r = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          contents: [{ role: 'user', parts }],
          generationConfig: { maxOutputTokens: 65536, temperature: 0.1 },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 600000 }
      );
      return r.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    };

    try {
      // ── 1. YouTube → Gemini native fileData.fileUri (no download, any length) ──
      if (rawUrl.match(/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/)) {
        console.log('[extract-media] YouTube native →', rawUrl);
        const text = await geminiGenerate([
          { fileData: { mimeType: 'video/mp4', fileUri: rawUrl } },
          { text: EXTRACT_PROMPT },
        ]);
        if (!text) {
          return res.status(422).json({
            error: 'ИИ не смог транскрибировать YouTube-видео. Проверьте, что видео публичное.',
          });
        }
        return res.json({ text: text.trim() });
      }

      // ── 2. Resolve share links (Yandex Disk, Google Drive) ──
      const downloadUrl = await resolveDownloadUrl(rawUrl);

      // ── 3. Determine file type from extension ──
      const hintMime = mimeFromExt(rawUrl) || mimeFromExt(downloadUrl);
      const looksLikeMedia =
        hintMime.startsWith('video/') || hintMime.startsWith('audio/') ||
        /\.(mp4|webm|avi|mov|mkv|m4v|mp3|wav|ogg|m4a|aac|flac|wma)(\?|$)/i.test(rawUrl);

      if (looksLikeMedia) {
        // ── VIDEO / AUDIO PATH ─────────────────────────────────────────────────
        // Stream download → ffmpeg (extract audio at 48 kbps mono) → Gemini Files API
        // Audio from a 5 GB / 3-hour video is only ~60 MB → no size issues.
        console.log('[extract-media] video/audio path for', rawUrl.slice(0, 80));

        // Start streaming download (no size limit, long timeout)
        const dlRes = await axios.get(downloadUrl, {
          responseType: 'stream',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' },
          timeout: 7200000,           // 2 h inactivity
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        // Detect HTML error page (Google Drive virus scan, etc.)
        const ct = (dlRes.headers['content-type'] as string | undefined) || '';
        if (ct.includes('text/html')) {
          return res.status(422).json({
            error: 'Получена HTML-страница вместо файла. Убедитесь, что доступ открыт «Всем по ссылке».',
          });
        }

        // For pure audio files (mp3/wav/etc.) skip ffmpeg, just buffer and upload
        const isRawAudio = hintMime.startsWith('audio/') ||
          /\.(mp3|wav|ogg|m4a|aac|flac|wma)(\?|$)/i.test(rawUrl);

        let audioBuffer: Buffer;
        let audioMime: string;

        if (isRawAudio) {
          // Already audio — buffer it directly (audio files are much smaller than video)
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            dlRes.data.on('data', (d: Buffer) => chunks.push(d));
            dlRes.data.on('end', resolve);
            dlRes.data.on('error', reject);
          });
          audioBuffer = Buffer.concat(chunks);
          audioMime = ct.split(';')[0].trim() || hintMime || 'audio/mpeg';
        } else {
          // Video → extract audio via ffmpeg (handles any size, any format)
          audioBuffer = await extractAudio(dlRes.data);
          audioMime = 'audio/mpeg';
        }

        console.log(`[extract-media] uploading audio ${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB to Gemini Files API`);

        const { uri: fileUri, name: fileName } =
          await uploadBufferToFilesApi(audioBuffer, audioMime, GEMINI_KEY);

        const text = await geminiGenerate([
          { fileData: { mimeType: audioMime, fileUri } },
          { text: EXTRACT_PROMPT },
        ]);

        // Clean up uploaded file (best-effort)
        axios.delete(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`,
          { timeout: 10000 }
        ).catch(() => {});

        if (!text) return res.status(422).json({ error: 'ИИ не смог транскрибировать аудио из файла.' });
        return res.json({ text: text.trim() });
      }

      // ── 4. PDF / image / document path ────────────────────────────────────────
      const dlRes = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' },
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      let mimeType =
        (dlRes.headers['content-type'] as string | undefined)?.split(';')[0]?.trim() ||
        hintMime || 'application/octet-stream';

      if (mimeType.includes('text/html')) {
        return res.status(422).json({
          error: 'Получена HTML-страница вместо файла. Убедитесь, что доступ открыт «Всем по ссылке».',
        });
      }

      const fileBuf = Buffer.from(dlRes.data);

      if (fileBuf.length > 15 * 1024 * 1024) {
        // Large document → Files API
        const { uri: fileUri, name: fileName } =
          await uploadBufferToFilesApi(fileBuf, mimeType, GEMINI_KEY);
        const text = await geminiGenerate([
          { fileData: { mimeType, fileUri } },
          { text: EXTRACT_PROMPT },
        ]);
        axios.delete(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`, { timeout: 10000 }).catch(() => {});
        if (!text) return res.status(422).json({ error: 'ИИ не смог извлечь контент.' });
        return res.json({ text: text.trim() });
      }

      // Small file → inline base64 (fastest path)
      console.log(`[extract-media] inline ${(fileBuf.length / 1024).toFixed(0)} KB, ${mimeType}`);
      const text = await geminiGenerate([
        { text: EXTRACT_PROMPT },
        { inlineData: { data: fileBuf.toString('base64'), mimeType } },
      ]);
      if (!text) return res.status(422).json({ error: 'ИИ не смог извлечь контент из файла.' });

      // Strip NotebookLM-style footer
      const tail = text.slice(-600);
      const fi = tail.search(/\n[-–—=*]{3,}\s*\n[\s\S]{0,300}NotebookLM/i);
      const cleaned = fi !== -1 ? text.slice(0, text.length - 600 + fi).trim() : text.trim();
      res.json({ text: cleaned });

    } catch (e: any) {
      console.error('[extract-media-knowledge]', e.message);
      res.status(500).json({ error: e.message || 'Extraction failed' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // MEDIA PROXY — streams any URL through our server, stripping
  // X-Frame-Options / CSP frame-ancestors so the browser can embed it.
  // Used for Yandex Disk PDFs and other files that block iframe.
  // GET /api/proxy-media?url=...
  // ─────────────────────────────────────────────────────────────────────
  app.get('/api/proxy-media', async (req: any, res: any) => {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).send('url required');
    try {
      const upstream = await axios.get(url, {
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ibox-academy/1.0)' },
        timeout: 60000,
        maxContentLength: Infinity, // no limit — large files stream through
      });

      // Forward useful headers, but NEVER forward the blocking ones
      const BLOCKED = new Set(['x-frame-options', 'content-security-policy',
        'x-content-type-options', 'strict-transport-security']);
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (!BLOCKED.has(k.toLowerCase()) && v) res.setHeader(k, v as string);
      }
      res.setHeader('Content-Disposition', 'inline');
      // Explicitly allow embedding
      res.removeHeader('X-Frame-Options');

      upstream.data.pipe(res);
    } catch (e: any) {
      res.status(502).send('proxy-media failed: ' + e.message);
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
