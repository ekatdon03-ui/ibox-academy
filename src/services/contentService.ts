// ─────────────────────────────────────────────────────────────────────────────
// Content service — talks to our PostgreSQL-backed REST API (was Firestore).
// Method names/signatures are kept identical so components need no changes.
// ─────────────────────────────────────────────────────────────────────────────
import { api, authToken } from './api';
import { Course, CourseResult, UserProfile, GlossaryTerm, UserCourseProgress } from '../types';

export interface AISettings {
  tutorPrompt: string;
  assistantPrompt: string;
}

export interface QuestionBankInfo {
  id: string;
  title: string;
  courseId?: string;
  count: number;
}

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch (e) { console.warn('[contentService]', (e as Error).message); return fallback; }
};

// POST a multipart form to our API with upload progress + bearer token.
function uploadForm<T = any>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    const t = authToken.get();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(xhr.responseText as any); }
      } else {
        let msg = `${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(form);
  });
}

// PUT a file directly to a presigned S3 URL with upload progress.
function putToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
  acl: string | undefined,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    if (acl) xhr.setRequestHeader('x-amz-acl', acl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`S3 ${xhr.status}: ${xhr.responseText?.slice(0, 200) || ''}`));
    xhr.onerror = () => reject(new Error('network error during S3 upload'));
    xhr.ontimeout = () => reject(new Error('S3 upload timed out'));
    xhr.send(file);
  });
}

export const contentService = {
  // ── Simulator sessions ──────────────────────────────────────────────────
  async saveSimulatorSession(session: any) {
    return safe(api.post('/api/simulator', session), null);
  },
  async getSimulatorSessions(userId: string): Promise<any[]> {
    if (!userId) return [];
    return safe(api.get(`/api/simulator/${encodeURIComponent(userId)}`), []);
  },

  // ── Results ─────────────────────────────────────────────────────────────
  async saveResult(result: CourseResult): Promise<void> {
    if (!result.userId || !result.courseId) return;
    await safe(api.post('/api/results', result), undefined);
  },
  async getAllResults(): Promise<CourseResult[]> {
    return safe(api.get('/api/results'), []);
  },
  async getResultsForUser(userId: string): Promise<CourseResult[]> {
    if (!userId) return [];
    return safe(api.get(`/api/results/user/${encodeURIComponent(userId)}`), []);
  },

  // ── Course assignment ───────────────────────────────────────────────────
  async assignCourseToUser(userId: string, courseId: string) {
    await safe(api.post('/api/assign', { userId, courseId }), undefined);
  },
  async unassignCourseFromUser(userId: string, courseId: string) {
    await safe(api.post('/api/unassign', { userId, courseId }), undefined);
  },
  async massAssignCourse(courseId: string, userIds: string[]): Promise<number> {
    const r = await safe<any>(api.post('/api/mass-assign', { courseId, userIds }), { count: 0 });
    return r?.count || 0;
  },
  async toggleCourseVisibility(courseId: string, hidden: boolean) {
    await safe(api.put(`/api/courses/${courseId}`, { hiddenFromUsers: hidden }), undefined);
  },

  // ── Notifications ───────────────────────────────────────────────────────
  async createNotification(userId: string, title: string, text: string) {
    await safe(api.post('/api/notifications', { userId, title, text }), undefined);
  },
  async getNotifications(userId: string) {
    if (!userId) return [];
    return safe(api.get(`/api/notifications/${encodeURIComponent(userId)}`), []);
  },
  async markNotificationRead(id: string) {
    await safe(api.post('/api/notifications/read', { ids: [id] }), undefined);
  },
  async markNotificationsReadByIds(ids: string[]) {
    if (!ids.length) return;
    await safe(api.post('/api/notifications/read', { ids }), undefined);
  },

  // ── AI settings ─────────────────────────────────────────────────────────
  async getAISettings(): Promise<AISettings> {
    return safe(api.get('/api/ai-settings'), {
      tutorPrompt: 'Ты — дружелюбный наставник iBOX Academy. Твоя роль — симуляция реальных рабочих ситуаций и вопросов. Если пользователь ошибается, задай наводящий вопрос.',
      assistantPrompt: 'Ты — лаконичный ассистент Академии iBOX. Твоя база знаний включает все курсы и глоссарий.',
    });
  },
  async saveAISettings(settings: AISettings): Promise<void> {
    await api.put('/api/ai-settings', settings);
  },

  // ── Courses ─────────────────────────────────────────────────────────────
  async getAllCourses(): Promise<Course[]> {
    return safe(api.get('/api/courses'), []);
  },
  async createCourse(course: Omit<Course, 'id'>): Promise<string> {
    const r = await api.post<{ id: string }>('/api/courses', course);
    return r.id;
  },
  async updateCourse(id: string, updates: Partial<Course>): Promise<void> {
    await api.put(`/api/courses/${id}`, updates);
  },
  async deleteCourse(courseId: string): Promise<void> {
    await api.del(`/api/courses/${courseId}`);
  },

  // ── Progress ────────────────────────────────────────────────────────────
  async getCourseProgress(userId: string, courseId: string): Promise<UserCourseProgress | null> {
    return safe(api.get(`/api/progress/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}`), null);
  },
  async getAllProgressForUser(userId: string): Promise<UserCourseProgress[]> {
    if (!userId) return [];
    return safe(api.get(`/api/progress/user/${encodeURIComponent(userId)}`), []);
  },
  async updateLessonProgress(userId: string, courseId: string, lessonId: string, completed: boolean, totalLessons?: number): Promise<{ firstCompletion: boolean }> {
    return safe(api.post('/api/progress/lesson', { userId, courseId, lessonId, completed, totalLessons }), { firstCompletion: false });
  },

  // ── Glossary ────────────────────────────────────────────────────────────
  async getGlossary(): Promise<GlossaryTerm[]> {
    return safe(api.get('/api/glossary'), []);
  },
  async addGlossaryTerm(term: Omit<GlossaryTerm, 'id'>): Promise<string> {
    const r = await api.post<{ id: string }>('/api/glossary', term);
    return r.id;
  },
  async updateGlossaryTerm(id: string, updates: Partial<GlossaryTerm>): Promise<void> {
    await api.put(`/api/glossary/${id}`, updates);
  },
  async deleteGlossaryTerm(id: string): Promise<void> {
    await api.del(`/api/glossary/${id}`);
  },

  // Pure client-side helper — builds the AI knowledge-base context string
  getKnowledgeBaseContext(courses: Course[], glossary: GlossaryTerm[]) {
    let kb = '=== БАЗА ЗНАНИЙ iBOX ACADEMY ===\n\n';
    kb += '--- ГЛОССАРИЙ ТЕРМИНОВ ---\n';
    glossary.forEach(t => { kb += `${t.term} (${t.category}): ${t.definition}\n`; });
    kb += '\n--- КУРСЫ И УРОКИ ---\n';
    courses.forEach(c => {
      kb += `КУРС: ${c.title}\nОПИСАНИЕ: ${c.description}\n`;
      c.lessons.forEach((l, i) => {
        kb += `  Урок ${i + 1}: ${l.title}\n  СОДЕРЖАНИЕ:\n${l.content}\n`;
        if (l.aiKnowledge) kb += `  БАЗА ЗНАНИЙ (из медиа):\n${l.aiKnowledge}\n`;
        kb += '\n';
      });
      kb += '--------------------\n';
    });
    return kb;
  },

  // ── Users ───────────────────────────────────────────────────────────────
  async getAllUsers(): Promise<UserProfile[]> {
    return safe(api.get('/api/users'), []);
  },
  async resolveUserProfile(userId: string): Promise<UserProfile | null> {
    return safe(api.get(`/api/users/${encodeURIComponent(userId)}`), null);
  },
  async saveProfile(profile: UserProfile): Promise<void> {
    if (!profile.id) return;
    await safe(api.put(`/api/users/${encodeURIComponent(profile.id)}`, profile), undefined);
  },
  async syncUserProfile(profile: UserProfile): Promise<void> {
    return this.saveProfile(profile);
  },
  async deleteUserProfile(userId: string): Promise<void> {
    await safe(api.del(`/api/users/${encodeURIComponent(userId)}`), undefined);
  },
  async setUserRole(userId: string, role: string) {
    await safe(api.post(`/api/users/${encodeURIComponent(userId)}/role`, { role }), undefined);
  },
  async resolveUserRole(userId: string, defaultRole: string): Promise<string> {
    const u = await this.resolveUserProfile(userId);
    return u?.role || defaultRole;
  },
  async syncUserRole(userId: string, role: string) {
    if (!userId || !role) return;
    const current = await this.resolveUserRole(userId, 'employee');
    if (current !== role) await this.setUserRole(userId, role);
  },

  // ── File upload (→ S3) ──────────────────────────────────────────────────
  // Fast path: ask the server for a presigned URL and PUT the file straight to
  // S3 (browser → S3, one hop, with progress). If that fails for any reason
  // (CORS, network), fall back to the server proxy (browser → server → S3).
  async uploadFile(
    file: File,
    onProgress?: (fraction: number) => void
  ): Promise<{ url: string; name: string; size: number; contentType: string }> {
    const contentType = file.type || 'application/octet-stream';
    try {
      const signed = await api.post<{ uploadUrl: string; publicUrl: string; contentType: string; acl: string }>(
        '/api/upload-url', { name: file.name, contentType }
      );
      await putToS3(signed.uploadUrl, file, contentType, signed.acl, onProgress);
      return { url: signed.publicUrl, name: file.name, size: file.size, contentType };
    } catch (e) {
      console.warn('[contentService] direct S3 upload failed, using server proxy:', (e as Error).message);
    }
    // Fallback: server proxy
    const form = new FormData();
    form.append('file', file);
    const r = await api.upload<{ url: string; name: string; size: number; contentType: string }>('/api/upload', form);
    onProgress?.(1);
    return r;
  },

  // ── Question banks (Moodle XML) ─────────────────────────────────────────
  async importMoodleXml(file: File, title?: string, courseId?: string): Promise<{ id: string; title: string; count: number; skipped: number }> {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    if (courseId) form.append('courseId', courseId);
    return api.upload('/api/import-moodle', form);
  },
  async getQuestionBanks(): Promise<QuestionBankInfo[]> {
    return safe(api.get('/api/question-banks'), []);
  },
  async getQuestionBank(id: string): Promise<any | null> {
    return safe(api.get(`/api/question-banks/${id}`), null);
  },
  async deleteQuestionBank(id: string): Promise<void> {
    await safe(api.del(`/api/question-banks/${id}`), undefined);
  },

  // ── SCORM ───────────────────────────────────────────────────────────────
  async importScorm(file: File, title?: string, onProgress?: (fraction: number) => void): Promise<{ id: string; title: string; version: '1.2' | '2004'; launchHref: string; fileCount: number }> {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    return uploadForm('/api/scorm/import', form, onProgress);
  },
  async getScormPackage(id: string): Promise<{ id: string; title: string; version: '1.2' | '2004'; launchHref: string } | null> {
    return safe(api.get(`/api/scorm/${encodeURIComponent(id)}`), null);
  },
  async getScormCmi(id: string): Promise<Record<string, string>> {
    return safe(api.get(`/api/scorm/${encodeURIComponent(id)}/cmi`), {});
  },
  async saveScormCmi(id: string, cmi: Record<string, string>): Promise<void> {
    await safe(api.post(`/api/scorm/${encodeURIComponent(id)}/cmi`, { cmi }), undefined);
  },
  async deleteScormPackage(id: string): Promise<void> {
    await safe(api.del(`/api/scorm/${encodeURIComponent(id)}`), undefined);
  },

  // No-op: initial data now lives in PostgreSQL (migrated from Firebase)
  async migrateInitialData() { /* deprecated */ },
};
