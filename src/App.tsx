import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import TrainingView from './components/TrainingView';
import GlossaryView from './components/GlossaryView';
import ProfileView from './components/ProfileView';
import AdminPanel from './components/AdminPanel';
import SimulatorView from './components/SimulatorView';
import AnalyticsView from './components/AnalyticsView';
import CoursePlayer from './components/CoursePlayer';
import AIAssistant from './components/AIAssistant';
import AuthView from './components/AuthView';
import { bitrixService } from './services/bitrixService';
import { UserProfile, Course, CourseResult, GlossaryTerm } from './types';
import { contentService } from './services/contentService';
import { auth, db } from './lib/firebase';
import { signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

// ─── Bitrix24 auto-login ──────────────────────────────────────────────────────
// Returns a Firebase user after signing in via Bitrix token (custom token),
// or falls back to anonymous auth so Firestore rules still work.
async function doBitrixAuth(): Promise<void> {
  try {
    const BX24 = (window as any).BX24;
    const bxAuth = BX24.getAuth?.();
    if (!bxAuth?.access_token) {
      await signInAnonymously(auth);
      return;
    }

    const domain = (bxAuth.domain || window.location.hostname)
      .replace(/^https?:\/\//, '').replace(/\/$/, '');

    const resp = await fetch('/api/bitrix-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bitrixDomain: domain, accessToken: bxAuth.access_token })
    });

    if (resp.ok) {
      const { customToken } = await resp.json();
      await signInWithCustomToken(auth, customToken);
    } else {
      // Server not configured with service account yet — use anonymous as fallback
      console.warn('Custom token auth failed, using anonymous');
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.warn('Bitrix auth error, falling back to anonymous:', e);
    try { await signInAnonymously(auth); } catch (_) {}
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('training');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const handleRefreshUser = async () => {
    if (!user?.id) return;
    try {
      const [allUsers, allResults] = await Promise.all([
        contentService.getAllUsers(),
        contentService.getAllResults()
      ]);
      const freshUser = allUsers.find(u => u.id === user.id);
      if (freshUser) {
        setUser(freshUser);
        localStorage.setItem('academy_user', JSON.stringify(freshUser));
      }
      setResults(allResults);
      setUsers(allUsers);
    } catch (e) { console.warn('Refresh failed', e); }
  };

  const handleClosePlayer = () => {
    setSelectedCourse(null);
    setRefreshTrigger(prev => prev + 1);
    handleRefreshUser();
  };

  const syncUserSession = async (profile: UserProfile, firebaseUser: any) => {
    if (!profile.id) return profile;

    const ADMIN_EMAILS = ['oap.ibox.company@gmail.com', 'pem@i-box.company'];
    const ADMIN_IDS   = ['DxMBjT1L'];
    const email       = firebaseUser.email || profile.email || '';

    // Resolve DB role (non-critical — don't let Firestore errors break the session)
    let dbRole: 'admin' | 'manager' | 'employee' = profile.role || 'employee';
    try {
      dbRole = (await contentService.resolveUserRole(profile.id, profile.role)) as any;
    } catch (_) {}

    const isHardcodedAdmin =
      ADMIN_EMAILS.includes(email) ||
      ADMIN_IDS.includes(profile.id) ||
      ADMIN_IDS.includes((profile as any).bitrixId || '');

    // Hardcoded admins always get admin role regardless of what's in DB
    const finalRole: 'admin' | 'manager' | 'employee' = isHardcodedAdmin ? 'admin' : dbRole as any;
    const updated   = { ...profile, role: finalRole, email };

    // Persist to Firestore — errors are non-critical, session still works
    try {
      await contentService.setUserRole(updated.id, updated.role, firebaseUser);
      await contentService.saveProfile(updated, firebaseUser);
    } catch (e) {
      console.warn('Firestore role sync failed (non-critical):', e);
    }

    return updated;
  };

  useEffect(() => {
    const initApp = async () => {
      // 1. Load public content immediately
      try {
        const [allCourses, allGlossary] = await Promise.all([
          contentService.getAllCourses(),
          contentService.getGlossary()
        ]);
        setCourses(allCourses);
        setGlossary(allGlossary);
      } catch (_) {}

      // 2. If in Bitrix24 — do auth BEFORE registering the listener,
      //    so the listener fires only AFTER we have a user.
      await bitrixService.init();
      if (bitrixService.isAvailable() && !auth.currentUser) {
        await doBitrixAuth();
      }

      // 3. Auth state listener — by now auth.currentUser is set (if Bitrix),
      //    so it fires with the logged-in user, not with null.
      auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
          let currentProfile: UserProfile | null = null;

          // ── Bitrix24 context: enrich profile with Bitrix data ──
          if (bitrixService.isAvailable()) {
            try {
              const [bxUser, dbProfile] = await Promise.all([
                bitrixService.getCurrentUser(),
                contentService.resolveUserProfile(firebaseUser.uid)
              ]);

              if (bxUser) {
                // Get department name
                let deptName = dbProfile?.department || 'Общий отдел';
                if (bxUser.UF_DEPARTMENT?.[0]) {
                  try {
                    const depts = await bitrixService.getDepartments();
                    const dept = depts.find((d: any) => String(d.ID) === String(bxUser.UF_DEPARTMENT[0]));
                    if (dept) deptName = dept.NAME;
                  } catch (_) {}
                }

                currentProfile = {
                  id: firebaseUser.uid,
                  bitrixId: String(bxUser.ID),
                  name: `${bxUser.NAME || ''} ${bxUser.LAST_NAME || ''}`.trim() || dbProfile?.name || 'Сотрудник',
                  email: bxUser.EMAIL || firebaseUser.email || dbProfile?.email || '',
                  position: bxUser.WORK_POSITION || dbProfile?.position || 'Сотрудник iBOX',
                  avatar: bxUser.PERSONAL_PHOTO || dbProfile?.avatar || '',
                  role: bxUser.IS_ADMIN ? 'admin' : (dbProfile?.role as any || 'employee'),
                  score: dbProfile?.score ?? 0,
                  department: deptName,
                  assignedCourses: dbProfile?.assignedCourses || []
                };
                // Save/update in Firestore
                await contentService.syncUserProfile(currentProfile);
              } else {
                currentProfile = dbProfile;
              }
            } catch (e) {
              console.warn('Bitrix profile load error:', e);
            }
          }

          // ── Non-Bitrix context ──
          if (!currentProfile) {
            const savedRaw = localStorage.getItem('academy_user');
            const dbProfile = await contentService.resolveUserProfile(firebaseUser.uid);

            if (savedRaw) {
              const parsed = JSON.parse(savedRaw);
              currentProfile = { ...parsed, ...dbProfile, id: firebaseUser.uid,
                email: firebaseUser.email || parsed.email || dbProfile?.email || '' };
            } else {
              currentProfile = dbProfile || {
                id: firebaseUser.uid,
                name: firebaseUser.displayName || 'Пользователь',
                email: firebaseUser.email || '',
                position: 'Сотрудник iBOX',
                role: 'employee',
                avatar: firebaseUser.photoURL || '',
                score: 0,
                department: 'Общий отдел',
                assignedCourses: []
              };
            }
          }

          if (currentProfile) {
            const syncedUser = await syncUserSession(currentProfile, firebaseUser);
            setUser(syncedUser);
            localStorage.setItem('academy_user', JSON.stringify(syncedUser));

            // Bootstrap role doc in Firestore so security rules can recognize admin/manager.
            // isOwner rule allows any authenticated user to write their own roles/{uid} document.
            if (syncedUser.role === 'admin' || syncedUser.role === 'manager') {
              try {
                await setDoc(doc(db, 'roles', firebaseUser.uid), { role: syncedUser.role }, { merge: true });
              } catch (_) {}
            }

            if (syncedUser.role === 'admin' || syncedUser.role === 'manager') {
              contentService.getAllUsers().then(setUsers);
              contentService.getAllResults().then(setResults);
            }

            // Reload courses/glossary with auth context
            try {
              const [allCourses, allGlossary] = await Promise.all([
                contentService.getAllCourses(),
                contentService.getGlossary()
              ]);
              setCourses(allCourses);
              setGlossary(allGlossary);
            } catch (_) {}
          }
        } else {
          // No Firebase user — show cached profile or login screen
          const savedUser = localStorage.getItem('academy_user');
          if (savedUser) {
            try { setUser(JSON.parse(savedUser)); } catch (_) {}
          }
        }

        setIsLoading(false);
      });
    };

    initApp();
  }, []);

  const handleUpdateUser = (updatedUser: UserProfile) => {
    setUser(updatedUser);
    localStorage.setItem('academy_user', JSON.stringify(updatedUser));
  };

  const handleLogin = (loggedUser: UserProfile) => {
    setUser(loggedUser);
    localStorage.setItem('academy_user', JSON.stringify(loggedUser));
  };

  const handleLogout = async () => {
    try { await auth.signOut(); } catch (_) {}
    setUser(null);
    localStorage.removeItem('academy_user');
  };

  const handleAddCourse = (course: Course) => {
    setCourses(prev => {
      const exists = prev.find(c => c.id === course.id);
      return exists ? prev.map(c => c.id === course.id ? course : c) : [...prev, course];
    });
  };

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-ibox-bg flex-col gap-8">
        <div className="w-16 h-16 border-4 border-ibox-action border-t-transparent rounded-full animate-spin" />
        <p className="font-display font-bold text-ibox-blue/40 tracking-widest text-sm uppercase">Загрузка Academy...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthView onLogin={handleLogin} />;
  }

  const renderView = () => {
    switch (activeTab) {
      case 'training':  return <TrainingView courses={courses} user={user} onSelectCourse={setSelectedCourse} refreshTrigger={refreshTrigger} />;
      case 'glossary':  return <GlossaryView />;
      case 'profile':   return <ProfileView user={user} onLogout={handleLogout} onUpdateUser={handleUpdateUser} courses={courses} />;
      case 'simulator': return <SimulatorView courses={courses} user={user} onRefreshUser={handleRefreshUser} />;
      case 'analytics': return <AnalyticsView results={results} courses={courses} currentUser={user} employees={users} />;
      case 'admin':     return (
        <AdminPanel
          courses={courses}
          onAddCourse={handleAddCourse}
          onUpdateCourses={setCourses}
          onUserRoleChange={setUser}
          onUpdateUser={handleUpdateUser}
          onUpdateAllUsers={setUsers}
          currentUser={user}
        />
      );
      default: return <TrainingView courses={courses} user={user} onSelectCourse={setSelectedCourse} />;
    }
  };

  return (
    <div className="h-screen w-full flex bg-ibox-bg relative overflow-hidden">
      <Sidebar user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <div className="flex-1 flex flex-col pl-16">
        <Navbar user={user} />
        <main className="flex-1 mt-20 overflow-y-auto">{renderView()}</main>
      </div>
      <AIAssistant allCourses={courses} glossary={glossary} />
      {selectedCourse && (
        <CoursePlayer course={selectedCourse} user={user} onClose={handleClosePlayer} />
      )}
    </div>
  );
}
