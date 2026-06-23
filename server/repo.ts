// ─────────────────────────────────────────────────────────────────────────────
// Data-access layer. Maps PostgreSQL rows <-> the app's existing shapes
// (Course with nested lessons[], camelCase fields) so the frontend barely changes.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from './db';

export function genId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const j = (v: any) => JSON.stringify(v ?? null);

// Coerce to a finite integer or a default (NaN/""/garbage -> default).
// `?? 0` does NOT catch NaN, which Postgres rejects for integer columns.
function intOr<T extends number | null>(v: any, def: T): number | T {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

// ── Courses (+ nested lessons) ───────────────────────────────────────────────
function rowToCourse(r: any, lessons: any[]): any {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    thumbnail: r.thumbnail,
    isPublic: r.is_public,
    hiddenFromUsers: r.hidden_from_users,
    type: r.type || undefined,
    fileUrl: r.file_url || undefined,
    hasSimulator: r.has_simulator ?? undefined,
    simulatorMode: r.simulator_mode || undefined,
    simulatorTurns: r.simulator_turns ?? undefined,
    testMode: r.test_mode || undefined,
    testConfig: r.test_config || { type: 'none', questions: [] },
    assignedToUsers: r.assigned_to_users || [],
    assignedToDepartments: r.assigned_to_departments || [],
    lessons,
  };
}

function rowToLesson(r: any): any {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    fileUrls: r.file_urls || [],
    fileUrl: (r.file_urls && r.file_urls[0]) || undefined,
    aiKnowledge: r.ai_knowledge || undefined,
    testConfig: r.test_config || undefined,
    scormPackageId: r.scorm_package_id || undefined,
  };
}

export async function getAllCourses(): Promise<any[]> {
  const courses = (await query('SELECT * FROM courses ORDER BY created_at ASC')).rows;
  const lessons = (await query('SELECT * FROM lessons ORDER BY course_id, position ASC')).rows;
  const byCourse: Record<string, any[]> = {};
  for (const l of lessons) (byCourse[l.course_id] ||= []).push(rowToLesson(l));
  return courses.map((c) => rowToCourse(c, byCourse[c.id] || []));
}

async function writeLessons(courseId: string, lessons: any[] = []) {
  await query('DELETE FROM lessons WHERE course_id = $1', [courseId]);
  const seen = new Set<string>();
  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i];
    // Lesson id must be unique within the course. Fall back to a stable
    // position id, and disambiguate any in-array duplicates.
    let id = l.id || `${i}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const fileUrls = l.fileUrls?.length ? l.fileUrls : (l.fileUrl ? [l.fileUrl] : []);
    await query(
      `INSERT INTO lessons (id, course_id, position, title, content, file_urls, ai_knowledge, test_config, scorm_package_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9)
       ON CONFLICT (course_id, id) DO UPDATE SET
         position = EXCLUDED.position, title = EXCLUDED.title, content = EXCLUDED.content,
         file_urls = EXCLUDED.file_urls, ai_knowledge = EXCLUDED.ai_knowledge,
         test_config = EXCLUDED.test_config, scorm_package_id = EXCLUDED.scorm_package_id`,
      [id, courseId, i, l.title || '', l.content || '', j(fileUrls), l.aiKnowledge || null,
       l.testConfig ? j(l.testConfig) : null, l.scormPackageId || null]
    );
  }
}

export async function createCourse(course: any): Promise<string> {
  const id = course.id || genId('course_');
  await query(
    `INSERT INTO courses (id, title, description, category, thumbnail, is_public, hidden_from_users,
       type, file_url, has_simulator, simulator_mode, simulator_turns, test_mode, test_config,
       assigned_to_users, assigned_to_departments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category,
       thumbnail = EXCLUDED.thumbnail, is_public = EXCLUDED.is_public,
       hidden_from_users = EXCLUDED.hidden_from_users, type = EXCLUDED.type,
       file_url = EXCLUDED.file_url, has_simulator = EXCLUDED.has_simulator,
       simulator_mode = EXCLUDED.simulator_mode, simulator_turns = EXCLUDED.simulator_turns,
       test_mode = EXCLUDED.test_mode, test_config = EXCLUDED.test_config,
       assigned_to_users = EXCLUDED.assigned_to_users,
       assigned_to_departments = EXCLUDED.assigned_to_departments`,
    [id, course.title || '', course.description || '', course.category || '', course.thumbnail || '',
     !!course.isPublic, !!course.hiddenFromUsers, course.type || null, course.fileUrl || null,
     course.hasSimulator ?? null, course.simulatorMode || null, intOr(course.simulatorTurns, null),
     course.testMode || null, j(course.testConfig || { type: 'none', questions: [] }),
     j(course.assignedToUsers || []), j(course.assignedToDepartments || [])]
  );
  await writeLessons(id, course.lessons || []);
  return id;
}

export async function updateCourse(id: string, u: any): Promise<void> {
  const map: Record<string, string> = {
    title: 'title', description: 'description', category: 'category', thumbnail: 'thumbnail',
    isPublic: 'is_public', hiddenFromUsers: 'hidden_from_users', type: 'type', fileUrl: 'file_url',
    hasSimulator: 'has_simulator', simulatorMode: 'simulator_mode', simulatorTurns: 'simulator_turns',
    testMode: 'test_mode',
  };
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    if (k in u) { sets.push(`${col} = $${i++}`); vals.push(u[k]); }
  }
  if ('testConfig' in u) { sets.push(`test_config = $${i++}::jsonb`); vals.push(j(u.testConfig)); }
  if ('assignedToUsers' in u) { sets.push(`assigned_to_users = $${i++}::jsonb`); vals.push(j(u.assignedToUsers)); }
  if ('assignedToDepartments' in u) { sets.push(`assigned_to_departments = $${i++}::jsonb`); vals.push(j(u.assignedToDepartments)); }
  if (sets.length) {
    vals.push(id);
    await query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  }
  if ('lessons' in u) await writeLessons(id, u.lessons || []);
}

export async function deleteCourse(id: string): Promise<void> {
  await query('DELETE FROM courses WHERE id = $1', [id]); // lessons cascade
}

// ── Glossary ─────────────────────────────────────────────────────────────────
export async function getGlossary(): Promise<any[]> {
  return (await query('SELECT * FROM glossary ORDER BY term ASC')).rows
    .map((r) => ({ id: r.id, term: r.term, definition: r.definition, category: r.category }));
}
export async function addGlossaryTerm(t: any): Promise<string> {
  const id = t.id || genId('gl_');
  await query(
    `INSERT INTO glossary (id, term, definition, category) VALUES ($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET
       term=EXCLUDED.term, definition=EXCLUDED.definition, category=EXCLUDED.category`,
    [id, t.term || '', t.definition || '', t.category || '']);
  return id;
}
export async function updateGlossaryTerm(id: string, u: any): Promise<void> {
  await query('UPDATE glossary SET term=COALESCE($2,term), definition=COALESCE($3,definition), category=COALESCE($4,category) WHERE id=$1',
    [id, u.term ?? null, u.definition ?? null, u.category ?? null]);
}
export async function deleteGlossaryTerm(id: string): Promise<void> {
  await query('DELETE FROM glossary WHERE id = $1', [id]);
}

// ── Results ──────────────────────────────────────────────────────────────────
export async function saveResult(r: any): Promise<void> {
  if (!r.userId || !r.courseId) return;
  await query(
    `INSERT INTO results (user_id, course_id, score, progress, tutor_rating, created_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       score = GREATEST(results.score, EXCLUDED.score),
       progress = GREATEST(results.progress, EXCLUDED.progress),
       tutor_rating = COALESCE(EXCLUDED.tutor_rating, results.tutor_rating),
       created_at = now()`,
    [r.userId, r.courseId, intOr(r.score, 0), intOr(r.progress, 0), intOr(r.tutorRating, null)]
  );
}
function rowToResult(r: any): any {
  return { userId: r.user_id, courseId: r.course_id, score: r.score, progress: r.progress,
    tutorRating: r.tutor_rating ?? undefined, timestamp: r.created_at?.toISOString?.() || r.created_at };
}
export async function getAllResults(): Promise<any[]> {
  return (await query('SELECT * FROM results')).rows.map(rowToResult);
}
export async function getResultsForUser(userId: string): Promise<any[]> {
  return (await query('SELECT * FROM results WHERE user_id = $1', [userId])).rows.map(rowToResult);
}

// ── Progress ─────────────────────────────────────────────────────────────────
function rowToProgress(r: any): any {
  return { userId: r.user_id, courseId: r.course_id, status: r.status, lessons: r.lessons || [],
    overallProgress: r.overall_progress, lastUpdated: r.last_updated?.toISOString?.() || r.last_updated };
}
export async function getCourseProgress(userId: string, courseId: string): Promise<any | null> {
  const rows = (await query('SELECT * FROM progress WHERE user_id=$1 AND course_id=$2', [userId, courseId])).rows;
  return rows[0] ? rowToProgress(rows[0]) : null;
}
export async function getAllProgressForUser(userId: string): Promise<any[]> {
  return (await query('SELECT * FROM progress WHERE user_id=$1', [userId])).rows.map(rowToProgress);
}
export async function updateLessonProgress(
  userId: string, courseId: string, lessonId: string, completed: boolean, totalLessons?: number
): Promise<{ firstCompletion: boolean }> {
  const existing = await getCourseProgress(userId, courseId);
  let firstCompletion = false;
  let lessons: any[] = existing?.lessons || [];
  const idx = lessons.findIndex((l) => l.lessonId === lessonId);
  if (idx > -1) {
    firstCompletion = completed && !lessons[idx].completed;
    lessons[idx].completed = completed;
  } else {
    firstCompletion = completed;
    lessons.push({ lessonId, completed });
  }
  let lessonCount = totalLessons;
  if (!lessonCount) {
    const c = (await query('SELECT COUNT(*)::int AS n FROM lessons WHERE course_id=$1', [courseId])).rows[0];
    lessonCount = c?.n || 1;
  }
  const done = lessons.filter((l) => l.completed).length;
  const overall = Math.round((done / (lessonCount || 1)) * 100);
  const status = overall === 100 ? 'completed' : overall > 0 ? 'in-progress' : 'not-started';
  await query(
    `INSERT INTO progress (user_id, course_id, status, lessons, overall_progress, last_updated)
     VALUES ($1,$2,$3,$4::jsonb,$5, now())
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       status=EXCLUDED.status, lessons=EXCLUDED.lessons,
       overall_progress=EXCLUDED.overall_progress, last_updated=now()`,
    [userId, courseId, status, j(lessons), overall]
  );
  return { firstCompletion };
}

// ── Users ────────────────────────────────────────────────────────────────────
function rowToUser(r: any): any {
  return { id: r.id, name: r.name, position: r.position, role: r.role, avatar: r.avatar || undefined,
    department: r.department || undefined, email: r.email || undefined, bitrixId: r.bitrix_id || undefined,
    assignedCourses: r.assigned_courses || [] };
}
export async function getAllUsers(): Promise<any[]> {
  const all = (await query('SELECT * FROM users')).rows.map(rowToUser);
  // Dedup: prefer bitrix_-prefixed over plain numeric duplicate
  const bitrixIds = new Set(all.filter((u) => u.id.startsWith('bitrix_')).map((u) => u.id.slice(7)));
  return all.filter((u) => !(/^\d+$/.test(u.id) && bitrixIds.has(u.id)));
}
export async function resolveUserProfile(userId: string): Promise<any | null> {
  const rows = (await query('SELECT * FROM users WHERE id=$1', [userId])).rows;
  return rows[0] ? rowToUser(rows[0]) : null;
}
export async function saveProfile(p: any): Promise<void> {
  if (!p.id) return;
  await query(
    `INSERT INTO users (id, name, position, role, avatar, department, email, bitrix_id, assigned_courses)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name=COALESCE(EXCLUDED.name, users.name),
       position=COALESCE(EXCLUDED.position, users.position),
       role=COALESCE(EXCLUDED.role, users.role),
       avatar=COALESCE(EXCLUDED.avatar, users.avatar),
       department=COALESCE(EXCLUDED.department, users.department),
       email=COALESCE(EXCLUDED.email, users.email),
       bitrix_id=COALESCE(EXCLUDED.bitrix_id, users.bitrix_id),
       assigned_courses=COALESCE(EXCLUDED.assigned_courses, users.assigned_courses)`,
    [p.id, p.name || '', p.position || '', p.role || 'employee', p.avatar || null,
     p.department || null, p.email || null, p.bitrixId || null,
     p.assignedCourses ? j(p.assignedCourses) : j([])]
  );
}
export async function deleteUserProfile(userId: string): Promise<void> {
  await query('DELETE FROM users WHERE id=$1', [userId]);
}
export async function assignCourseToUser(userId: string, courseId: string): Promise<void> {
  const u = await resolveUserProfile(userId);
  const assigned = new Set(u?.assignedCourses || []);
  assigned.add(courseId);
  await query(
    `INSERT INTO users (id, assigned_courses) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET assigned_courses=$2::jsonb`,
    [userId, j([...assigned])]
  );
}
export async function unassignCourseFromUser(userId: string, courseId: string): Promise<void> {
  const u = await resolveUserProfile(userId);
  const assigned = (u?.assignedCourses || []).filter((c: string) => c !== courseId);
  await query('UPDATE users SET assigned_courses=$2::jsonb WHERE id=$1', [userId, j(assigned)]);
}
export async function massAssignCourse(courseId: string, userIds: string[]): Promise<number> {
  let count = 0;
  for (const uid of userIds) {
    const u = await resolveUserProfile(uid);
    if (!u) continue;
    const assigned = new Set(u.assignedCourses || []);
    if (!assigned.has(courseId)) { assigned.add(courseId); count++;
      await query('UPDATE users SET assigned_courses=$2::jsonb WHERE id=$1', [uid, j([...assigned])]); }
  }
  return count;
}

// ── Roles ────────────────────────────────────────────────────────────────────
export async function setUserRole(userId: string, role: string): Promise<void> {
  await query(`INSERT INTO roles (user_id, role) VALUES ($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role`, [userId, role]);
  await query('UPDATE users SET role=$2 WHERE id=$1', [userId, role]);
}
export async function resolveUserRole(userId: string, def = 'employee'): Promise<string> {
  const rows = (await query('SELECT role FROM roles WHERE user_id=$1', [userId])).rows;
  return rows[0]?.role || def;
}

// ── Notifications ────────────────────────────────────────────────────────────
export async function createNotification(userId: string, title: string, text: string): Promise<void> {
  await query('INSERT INTO notifications (id, user_id, title, text, read) VALUES ($1,$2,$3,$4,false)',
    [genId('ntf_'), userId, title, text]);
}
export async function getNotifications(userId: string): Promise<any[]> {
  return (await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows
    .map((r) => ({ id: r.id, userId: r.user_id, title: r.title, text: r.text, read: r.read,
      time: r.created_at ? new Date(r.created_at).toLocaleString() : 'Только что',
      createdAt: r.created_at }));
}
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await query('UPDATE notifications SET read=true WHERE id = ANY($1)', [ids]);
}

// Raw upsert of a full progress doc (used by Firebase migration — preserves data verbatim).
export async function saveProgressRaw(p: any): Promise<void> {
  await query(
    `INSERT INTO progress (user_id, course_id, status, lessons, overall_progress, last_updated)
     VALUES ($1,$2,$3,$4::jsonb,$5, COALESCE($6, now()))
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       status=EXCLUDED.status, lessons=EXCLUDED.lessons,
       overall_progress=EXCLUDED.overall_progress, last_updated=EXCLUDED.last_updated`,
    [p.userId, p.courseId, p.status || 'in-progress', j(p.lessons || []),
     intOr(p.overallProgress, 0), p.lastUpdated ? new Date(p.lastUpdated) : null]
  );
}

// Raw insert of a notification preserving id/read/timestamp (used by migration).
export async function createNotificationRaw(n: any): Promise<void> {
  await query(
    `INSERT INTO notifications (id, user_id, title, text, read, created_at)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()))
     ON CONFLICT (id) DO NOTHING`,
    [n.id || genId('ntf_'), n.userId, n.title || '', n.text || '', !!n.read, n.createdAt || null]
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
const DEFAULT_AI = {
  tutorPrompt: 'Ты — дружелюбный наставник iBOX Academy. Твоя роль — симуляция реальных рабочих ситуаций и вопросов. Если пользователь ошибается, задай наводящий вопрос.',
  assistantPrompt: 'Ты — лаконичный ассистент Академии iBOX. Твоя база знаний включает все курсы и глоссарий.',
};
export async function getAISettings(): Promise<any> {
  const rows = (await query(`SELECT value FROM settings WHERE key='ai_prompts'`)).rows;
  return rows[0]?.value || DEFAULT_AI;
}
export async function saveAISettings(s: any): Promise<void> {
  await query(`INSERT INTO settings (key, value) VALUES ('ai_prompts', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [j(s)]);
}

// ── Simulator sessions ───────────────────────────────────────────────────────
export async function saveSimulatorSession(s: any): Promise<string> {
  const id = s.id || genId('sim_');
  await query(
    `INSERT INTO simulator_sessions (id, user_id, course_id, lesson_id, score, feedback, chat_history)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [id, s.userId, s.courseId || null, s.lessonId || null, intOr(s.score, 0), s.feedback || '', j(s.chatHistory || [])]
  );
  return id;
}
export async function getSimulatorSessions(userId: string): Promise<any[]> {
  return (await query('SELECT * FROM simulator_sessions WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows
    .map((r) => ({ id: r.id, userId: r.user_id, courseId: r.course_id, lessonId: r.lesson_id,
      score: r.score, feedback: r.feedback, chatHistory: r.chat_history || [],
      timestamp: r.created_at?.toISOString?.() || r.created_at }));
}

// ── Question banks (Moodle XML) ──────────────────────────────────────────────
export async function createQuestionBank(b: any): Promise<string> {
  const id = b.id || genId('bank_');
  await query('INSERT INTO question_banks (id, title, course_id, questions) VALUES ($1,$2,$3,$4::jsonb)',
    [id, b.title || 'Банк вопросов', b.courseId || null, j(b.questions || [])]);
  return id;
}
export async function getQuestionBanks(): Promise<any[]> {
  return (await query('SELECT * FROM question_banks ORDER BY created_at DESC')).rows
    .map((r) => ({ id: r.id, title: r.title, courseId: r.course_id || undefined,
      questions: r.questions || [], count: (r.questions || []).length }));
}
export async function getQuestionBank(id: string): Promise<any | null> {
  const rows = (await query('SELECT * FROM question_banks WHERE id=$1', [id])).rows;
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, title: r.title, courseId: r.course_id || undefined, questions: r.questions || [] };
}
export async function deleteQuestionBank(id: string): Promise<void> {
  await query('DELETE FROM question_banks WHERE id=$1', [id]);
}

// ── SCORM packages + per-user runtime ────────────────────────────────────────
function rowToScormPackage(r: any): any {
  return { id: r.id, title: r.title, version: r.version, launchHref: r.launch_href, s3Prefix: r.s3_prefix };
}
export async function createScormPackage(p: any): Promise<void> {
  await query(
    `INSERT INTO scorm_packages (id, title, version, launch_href, s3_prefix)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       title=EXCLUDED.title, version=EXCLUDED.version,
       launch_href=EXCLUDED.launch_href, s3_prefix=EXCLUDED.s3_prefix`,
    [p.id, p.title || 'SCORM-курс', p.version || '1.2', p.launchHref || 'index.html', p.s3Prefix || '']
  );
}
export async function getScormPackage(id: string): Promise<any | null> {
  const rows = (await query('SELECT * FROM scorm_packages WHERE id=$1', [id])).rows;
  return rows[0] ? rowToScormPackage(rows[0]) : null;
}
export async function deleteScormPackage(id: string): Promise<void> {
  await query('DELETE FROM scorm_packages WHERE id=$1', [id]);
  await query('DELETE FROM scorm_runtime WHERE package_id=$1', [id]);
}
export async function getScormRuntime(userId: string, packageId: string): Promise<any> {
  const rows = (await query('SELECT cmi FROM scorm_runtime WHERE user_id=$1 AND package_id=$2', [userId, packageId])).rows;
  return rows[0]?.cmi || {};
}
export async function saveScormRuntime(userId: string, packageId: string, cmi: any): Promise<void> {
  await query(
    `INSERT INTO scorm_runtime (user_id, package_id, cmi, updated_at)
     VALUES ($1,$2,$3::jsonb, now())
     ON CONFLICT (user_id, package_id) DO UPDATE SET cmi=EXCLUDED.cmi, updated_at=now()`,
    [userId, packageId, j(cmi || {})]
  );
}
