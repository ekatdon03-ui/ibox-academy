import { collection, addDoc, getDocs, deleteDoc, doc, query, updateDoc, setDoc, getDoc, where, orderBy, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { INITIAL_COURSES, INITIAL_GLOSSARY } from '../constants/courses';
import { Course, CourseResult, UserProfile, GlossaryTerm, UserCourseProgress } from '../types';

const COURSES_COLLECTION = 'courses';
const RESULTS_COLLECTION = 'results';
const USERS_COLLECTION = 'users';
const GLOSSARY_COLLECTION = 'glossary';
const SETTINGS_COLLECTION = 'settings';
const NOTIFICATIONS_COLLECTION = 'notifications';
const SIMULATOR_COLLECTION = 'simulator_sessions';
const ROLES_COLLECTION = 'roles';

export interface AISettings {
  tutorPrompt: string;
  assistantPrompt: string;
}

const PROGRESS_COLLECTION = 'progress';


// Server-side admin bypass — used when Firestore rules block the operation.
// Returns null if the server endpoint is unavailable (fall through to client SDK).
async function tryServerAdmin(operation: string, params: any): Promise<any> {
  if (typeof window === 'undefined') return null;
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const resp = await fetch('/api/admin/firestore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ operation, ...params }),
    });
    if (!resp.ok) return null; // Any server error → fall through to client SDK
    return await resp.json();
  } catch {
    return null; // Network error → fall through to client SDK
  }
}

export const contentService = {
  async saveSimulatorSession(session: any) {
    return await addDoc(collection(db, SIMULATOR_COLLECTION), {
      ...session,
      createdAt: serverTimestamp()
    });
  },

  async getSimulatorSessions(userId: string): Promise<any[]> {
    if (!userId) return [];
    try {
      const q = query(
        collection(db, SIMULATOR_COLLECTION),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data,
          timestamp: data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000).toISOString() : data.timestamp
        };
      }).sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    } catch (e) {
      console.warn("Simulator History Query Failed (Indices might be missing, falling back to client filter):", e);
      try {
        const snapshot = await getDocs(collection(db, SIMULATOR_COLLECTION));
        const sessions = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as any))
          .filter(d => d.userId === userId)
          .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        console.log(`Found ${sessions.length} sessions for ${userId} via client filter`);
        return sessions;
      } catch (e2) {
        console.error("Deep failure in getSimulatorSessions:", e2);
        handleFirestoreError(e2, OperationType.LIST, SIMULATOR_COLLECTION);
        return [];
      }
    }
  },

  async saveResult(result: CourseResult): Promise<void> {
    try {
      await addDoc(collection(db, RESULTS_COLLECTION), {
        ...result,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, RESULTS_COLLECTION);
    }
  },

  async assignCourseToUser(userId: string, courseId: string) {
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const assigned = snap.data().assignedCourses || [];
        if (!assigned.includes(courseId)) {
          await updateDoc(userRef, { assignedCourses: [...assigned, courseId] });
        }
      } else {
        await setDoc(userRef, { assignedCourses: [courseId] }, { merge: true });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, USERS_COLLECTION);
    }
  },

  async unassignCourseFromUser(userId: string, courseId: string) {
    const userRef = doc(db, USERS_COLLECTION, userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const assigned = snap.data().assignedCourses || [];
      await updateDoc(userRef, { assignedCourses: assigned.filter((id: string) => id !== courseId) });
    }
  },

  async toggleCourseVisibility(courseId: string, hidden: boolean) {
    try {
      const ok = await tryServerAdmin('update', { collection: COURSES_COLLECTION, docId: courseId, data: { hiddenFromUsers: hidden } });
      if (ok === null) await updateDoc(doc(db, COURSES_COLLECTION, courseId), { hiddenFromUsers: hidden });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, COURSES_COLLECTION);
    }
  },

  async createNotification(userId: string, title: string, text: string) {
    if (!auth.currentUser) return;
    try {
      await addDoc(collection(db, NOTIFICATIONS_COLLECTION), {
        userId,
        title,
        text,
        read: false,
        createdAt: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, NOTIFICATIONS_COLLECTION);
    }
  },

  async getNotifications(userId: string) {
    if (!auth.currentUser) return [];
    try {
      const q = query(
        collection(db, NOTIFICATIONS_COLLECTION),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data,
          time: data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000).toLocaleString() : 'Только что'
        };
      }).sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, NOTIFICATIONS_COLLECTION);
      return [];
    }
  },

  async markNotificationRead(id: string) {
    const docRef = doc(db, NOTIFICATIONS_COLLECTION, id);
    await updateDoc(docRef, { read: true });
  },

  async markAllNotificationsRead(userId: string) {
    const q = query(collection(db, NOTIFICATIONS_COLLECTION), where('userId', '==', userId), where('read', '==', false));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  },

  async getAISettings(): Promise<AISettings> {
    try {
      const docRef = doc(db, SETTINGS_COLLECTION, 'ai_prompts');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as AISettings;
      }
      return {
        tutorPrompt: "Ты — дружелюбный наставник iBOX Academy. Твоя роль — симуляция реальных рабочих ситуаций и вопросов. Если пользователь ошибается, задай наводящий вопрос.",
        assistantPrompt: "Ты — лаконичный ассистент Академии iBOX. Твоя база знаний включает все курсы и глоссарий."
      };
    } catch (e) {
      return { tutorPrompt: '', assistantPrompt: '' };
    }
  },

  async saveAISettings(settings: AISettings): Promise<void> {
    const ok = await tryServerAdmin('set', { collection: SETTINGS_COLLECTION, docId: 'ai_prompts', data: settings });
    if (ok === null) await setDoc(doc(db, SETTINGS_COLLECTION, 'ai_prompts'), settings);
  },

  async getAllCourses(): Promise<Course[]> {
    try {
      const querySnapshot = await getDocs(query(collection(db, COURSES_COLLECTION)));
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Course[];
    } catch (error) {
      console.error("Error loading courses:", error);
      return [];
    }
  },

  async createCourse(course: Omit<Course, 'id'>): Promise<string> {
    const data = { ...course, createdAt: new Date().toISOString() };
    const result = await tryServerAdmin('set', { collection: COURSES_COLLECTION, data });
    if (result !== null) return result.id;
    const docRef = await addDoc(collection(db, COURSES_COLLECTION), {
      ...course,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  },

  async updateCourse(id: string, updates: Partial<Course>): Promise<void> {
    const ok = await tryServerAdmin('update', { collection: COURSES_COLLECTION, docId: id, data: updates });
    if (ok === null) await updateDoc(doc(db, COURSES_COLLECTION, id), updates);
  },

  async deleteCourse(courseId: string): Promise<void> {
    const ok = await tryServerAdmin('delete', { collection: COURSES_COLLECTION, docId: courseId });
    if (ok === null) await deleteDoc(doc(db, COURSES_COLLECTION, courseId));
  },

  async getCourseProgress(userId: string, courseId: string): Promise<UserCourseProgress | null> {
    try {
      const docRef = doc(db, PROGRESS_COLLECTION, `${userId}_${courseId}`);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as UserCourseProgress;
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  async getAllProgressForUser(userId: string): Promise<UserCourseProgress[]> {
    try {
      const q = query(collection(db, PROGRESS_COLLECTION), where('userId', '==', userId));
      const snap = await getDocs(q);
      return snap.docs.map(doc => doc.data() as UserCourseProgress);
    } catch (e) {
      console.warn("Progress Query Failed (falling back to client filter):", e);
      try {
        const snap = await getDocs(collection(db, PROGRESS_COLLECTION));
        return snap.docs.map(doc => doc.data() as UserCourseProgress).filter(p => p.userId === userId);
      } catch (e2) {
        return [];
      }
    }
  },

  async updateLessonProgress(userId: string, courseId: string, lessonId: string, completed: boolean, totalLessons?: number): Promise<{ firstCompletion: boolean }> {
    if (!auth.currentUser) return { firstCompletion: false };
    const docRef = doc(db, PROGRESS_COLLECTION, `${userId}_${courseId}`);
    const snap = await getDoc(docRef);

    let firstCompletion = false;
    let current: UserCourseProgress;
    if (snap.exists()) {
      current = snap.data() as UserCourseProgress;
      const lessonIdx = current.lessons.findIndex(l => l.lessonId === lessonId);
      if (lessonIdx > -1) {
        firstCompletion = completed && !current.lessons[lessonIdx].completed;
        current.lessons[lessonIdx].completed = completed;
      } else {
        firstCompletion = completed;
        current.lessons.push({ lessonId, completed });
      }
    } else {
      firstCompletion = completed;
      current = {
        userId,
        courseId,
        status: 'in-progress',
        lessons: [{ lessonId, completed }],
        overallProgress: 0,
        lastUpdated: new Date().toISOString()
      };
    }

    let lessonCount = totalLessons;
    if (!lessonCount) {
      const courseSnap = await getDoc(doc(db, COURSES_COLLECTION, courseId));
      if (courseSnap.exists()) {
        lessonCount = (courseSnap.data() as Course).lessons?.length || 1;
      } else {
        const course = INITIAL_COURSES.find(c => c.id === courseId);
        lessonCount = course?.lessons.length || 1;
      }
    }

    const completedCount = current.lessons.filter(l => l.completed).length;
    current.overallProgress = Math.round((completedCount / (lessonCount || 1)) * 100);
    
    if (current.overallProgress === 100) {
      current.status = 'completed';
    } else if (current.overallProgress > 0) {
      current.status = 'in-progress';
    }

    current.lastUpdated = new Date().toISOString();
    try {
      await setDoc(docRef, current);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, PROGRESS_COLLECTION);
    }
    return { firstCompletion };
  },

  async getAllResults(): Promise<CourseResult[]> {
    try {
      const snap = await getDocs(collection(db, RESULTS_COLLECTION));
      return snap.docs.map(d => {
        const data = d.data();
        return { 
          ...data,
          timestamp: data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000).toISOString() : data.timestamp
        } as CourseResult;
      });
    } catch (error) {
      return [];
    }
  },

  async getGlossary(): Promise<GlossaryTerm[]> {
    try {
      const snap = await getDocs(collection(db, GLOSSARY_COLLECTION));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as GlossaryTerm));
    } catch (error) {
      console.error("Error loading glossary:", error);
      return [];
    }
  },

  getKnowledgeBaseContext(courses: Course[], glossary: GlossaryTerm[]) {
    let kb = "=== БАЗА ЗНАНИЙ iBOX ACADEMY ===\n\n";

    kb += "--- ГЛОССАРИЙ ТЕРМИНОВ ---\n";
    glossary.forEach(t => {
      kb += `${t.term} (${t.category}): ${t.definition}\n`;
    });
    kb += "\n";

    kb += "--- КУРСЫ И УРОКИ ---\n";
    courses.forEach(c => {
      kb += `КУРС: ${c.title}\nОПИСАНИЕ: ${c.description}\n`;
      c.lessons.forEach((l, i) => {
        kb += `  Урок ${i + 1}: ${l.title}\n  СОДЕРЖАНИЕ:\n${l.content}\n\n`;
      });
      kb += "--------------------\n";
    });

    return kb;
  },

  async addGlossaryTerm(term: Omit<GlossaryTerm, 'id'>): Promise<string> {
    const result = await tryServerAdmin('set', { collection: GLOSSARY_COLLECTION, data: term });
    if (result !== null) return result.id;
    const docRef = await addDoc(collection(db, GLOSSARY_COLLECTION), term);
    return docRef.id;
  },

  async updateGlossaryTerm(id: string, updates: Partial<GlossaryTerm>): Promise<void> {
    const ok = await tryServerAdmin('update', { collection: GLOSSARY_COLLECTION, docId: id, data: updates });
    if (ok === null) await updateDoc(doc(db, GLOSSARY_COLLECTION, id), updates);
  },

  async deleteGlossaryTerm(id: string): Promise<void> {
    const ok = await tryServerAdmin('delete', { collection: GLOSSARY_COLLECTION, docId: id });
    if (ok === null) await deleteDoc(doc(db, GLOSSARY_COLLECTION, id));
  },

  async getAllUsers(): Promise<UserProfile[]> {
    try {
      const snap = await getDocs(collection(db, USERS_COLLECTION));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
      // Deduplicate: prefer bitrix_-prefixed doc over plain numeric ID
      const byBitrixId = new Map<string, UserProfile>();
      const result: UserProfile[] = [];
      for (const u of all) {
        if (u.id.startsWith('bitrix_')) {
          byBitrixId.set(u.id.slice(7), u); // strip prefix, store canonical
        }
      }
      for (const u of all) {
        if (!u.id.startsWith('bitrix_') && /^\d+$/.test(u.id) && byBitrixId.has(u.id)) {
          continue; // skip old non-prefixed numeric duplicates
        }
        result.push(u);
      }
      return result;
    } catch (error) {
      console.error("Error loading users:", error);
      return [];
    }
  },

  async saveProfile(profile: UserProfile, authUser?: any): Promise<void> {
    const activeAuth = authUser || auth.currentUser;
    if (!profile.id || !activeAuth) return;
    try {
      await setDoc(doc(db, USERS_COLLECTION, profile.id), profile, { merge: true });
    } catch (e) {
      console.error("Failed to save profile:", e);
      handleFirestoreError(e, OperationType.WRITE, USERS_COLLECTION);
    }
  },

  async setUserRole(userId: string, role: string, authUser?: any) {
    const activeAuth = authUser || auth.currentUser;
    if (!activeAuth) {
      console.warn("Cannot set role: User not authenticated");
      return;
    }
    // Try server-side first (bypasses Firestore rules)
    const serverOk = await tryServerAdmin('set', { collection: ROLES_COLLECTION, docId: userId, data: { role }, merge: true });
    if (serverOk === null) {
      // Fallback: client SDK (works if isOwner rule allows writing own role)
      try {
        await setDoc(doc(db, ROLES_COLLECTION, userId), { role }, { merge: true });
      } catch (e) {
        console.warn("Client role write failed (Firestore rules):", e);
      }
    }
    // Sync to users collection
    try {
      const userRef = doc(db, USERS_COLLECTION, userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const ok2 = await tryServerAdmin('update', { collection: USERS_COLLECTION, docId: userId, data: { role } });
        if (ok2 === null) await updateDoc(userRef, { role });
      }
    } catch (e) {
      console.warn("Failed to sync role to users collection:", e);
    }
  },

  async syncUserRole(userId: string, role: string, authUser?: any) {
    const activeAuth = authUser || auth.currentUser;
    if (!userId || !role || !activeAuth) return;
    try {
      const snap = await getDoc(doc(db, ROLES_COLLECTION, userId));
      if (!snap.exists() || snap.data().role !== role) {
        await this.setUserRole(userId, role, activeAuth);
      }
    } catch (e) {
      console.warn("Role sync failed (likely permission denied before first sync):", e);
    }
  },

  async resolveUserRole(userId: string, defaultRole: string): Promise<string> {
    try {
      const snap = await getDoc(doc(db, ROLES_COLLECTION, userId));
      if (snap.exists()) return snap.data().role;
    } catch (e) {}
    return defaultRole;
  },
  
  async syncUserProfile(profile: UserProfile): Promise<void> {
    try {
      const { id, ...data } = profile;
      await setDoc(doc(db, USERS_COLLECTION, id), data, { merge: true });
      console.log("Profile synced:", id);
    } catch (e) {
      console.error("Error syncing profile:", e);
    }
  },

  async massAssignCourse(courseId: string, userIds: string[]): Promise<number> {
    try {
      const batch = writeBatch(db);
      let count = 0;
      
      for (const userId of userIds) {
        const userRef = doc(db, USERS_COLLECTION, userId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          const assigned = userData.assignedCourses || [];
          if (!assigned.includes(courseId)) {
            batch.update(userRef, { 
              assignedCourses: [...assigned, courseId] 
            });
            count++;
          }
        } else {
          // If user doesn't exist in our DB yet, we can't easily assign to them
          // unless we want to create a stub. For now, let's skip.
          console.warn(`User ${userId} not found in DB during mass assignment`);
        }
      }
      
      if (count > 0) {
        await batch.commit();
      }
      return count;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, USERS_COLLECTION);
      return 0;
    }
  },

  async resolveUserProfile(userId: string): Promise<UserProfile | null> {
    try {
      const snap = await getDoc(doc(db, USERS_COLLECTION, userId));
      if (snap.exists()) return { id: snap.id, ...snap.data() } as UserProfile;
    } catch (e) {}
    return null;
  },

  async deleteUserProfile(userId: string): Promise<void> {
    try {
      const ok = await tryServerAdmin('delete', { collection: USERS_COLLECTION, docId: userId });
      if (ok === null) await deleteDoc(doc(db, USERS_COLLECTION, userId));
    } catch (e) {}
  },

  async migrateInitialData() {
    try {
      const coursesSnap = await getDocs(collection(db, COURSES_COLLECTION));
      if (coursesSnap.empty) {
        for (const course of INITIAL_COURSES) {
          await setDoc(doc(db, COURSES_COLLECTION, course.id), {
            ...course,
            createdAt: serverTimestamp()
          });
        }
      }
      
      const glossarySnap = await getDocs(collection(db, GLOSSARY_COLLECTION));
      if (glossarySnap.empty) {
        for (const term of INITIAL_GLOSSARY) {
          await addDoc(collection(db, GLOSSARY_COLLECTION), term);
        }
      }
    } catch (e) {
      console.warn("Migration failed (check rules/auth):", e);
      throw e;
    }
  }
};
