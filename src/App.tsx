import React, { useState, useEffect } from 'react';
import { GraduationCap, Terminal, Book, User, BarChart3, LayoutDashboard } from 'lucide-react';
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
// Signs in via Bitrix custom token (or anonymous fallback).
// Returns the profile data from the server so onAuthStateChanged can use it
// directly — without needing to read from Firestore (which would fail for
// anonymous users whose auth UID ≠ bitrix_XXX profile ID).
let _pendingBxProfile: any = null; // shared between doBitrixAuth → onAuthStateChanged

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
      const data = await resp.json();
      // Store server-side profile so auth listener can use it without Firestore read
      if (data.profile) _pendingBxProfile = data.profile;
      await signInWithCustomToken(auth, data.customToken);
    } else {
      console.warn('Custom token auth failed, using anonymous');
      await signInAnonymously(auth);
    }
  } catch (e) {
    console.warn('Bitrix auth error, falling back to anonymous:', e);
    try { await signInAnonymously(auth); } catch (_) {}
  }
}

// ─── Mobile bottom navigation (sm:hidden) ────────────────────────────────────
function MobileBottomNav({ activeTab, setActiveTab, user }: {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  user: UserProfile;
}) {
  const isAdmin   = user.role === 'admin';
  const isManager = user.role === 'manager' || user.role === 'admin';

  const items = [
    { id: 'training',  label: 'Обучение',  Icon: GraduationCap },
    { id: 'simulator', label: 'Тренажер',  Icon: Terminal },
    { id: 'glossary',  label: 'Глоссарий', Icon: Book },
    { id: 'profile',   label: 'Профиль',   Icon: User },
    ...(isManager ? [{ id: 'analytics', label: 'Аналитика', Icon: BarChart3 }] : []),
    ...(isAdmin   ? [{ id: 'admin',     label: 'Админ',     Icon: LayoutDashboard }] : []),
  ];

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center">
        {items.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors min-w-0 ${
                active ? 'text-[#00A3FF]' : 'text-gray-400 active:text-[#002D57]'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[8px] font-black uppercase tracking-wider truncate w-full text-center leading-tight">
                {label}
              </span>
              {active && <span className="w-1 h-1 rounded-full bg-[#00A3FF] mt-0.5" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
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
              // Consume the server-side profile captured in doBitrixAuth
              const serverProfile = _pendingBxProfile;
              _pendingBxProfile = null;

              // Get Bitrix user ID — prefer from server profile, fallback to BX24 SDK
              let bxId: string | null = serverProfile?.bitrixId || null;
              let bxUser: any = null;
              if (!bxId) {
                bxUser = await bitrixService.getCurrentUser();
                bxId = bxUser ? String(bxUser.ID) : null;
              }

              if (bxId) {
                const canonicalId = `bitrix_${bxId}`;

                // Try to load existing Firestore profile (works when auth UID = canonical ID)
                let dbProfile: UserProfile | null = null;
                try { dbProfile = await contentService.resolveUserProfile(canonicalId); } catch (_) {}

                if (dbProfile) {
                  // Profile already exists — use it (preserves assignedCourses etc.)
                  currentProfile = dbProfile;
                } else {
                  // First login — build profile from server data or BX24 SDK
                  let deptName = 'Общий отдел';

                  if (serverProfile?.departmentIds?.[0]) {
                    try {
                      const depts = await bitrixService.getDepartments();
                      const dept = depts.find((d: any) => String(d.ID) === String(serverProfile.departmentIds[0]));
                      if (dept) deptName = dept.NAME;
                    } catch (_) {}
                  } else if (bxUser?.UF_DEPARTMENT?.[0]) {
                    try {
                      const depts = await bitrixService.getDepartments();
                      const dept = depts.find((d: any) => String(d.ID) === String(bxUser.UF_DEPARTMENT[0]));
                      if (dept) deptName = dept.NAME;
                    } catch (_) {}
                  }

                  currentProfile = {
                    id: canonicalId,
                    bitrixId: bxId,
                    name: serverProfile?.name || (bxUser ? `${bxUser.NAME || ''} ${bxUser.LAST_NAME || ''}`.trim() : '') || 'Сотрудник',
                    email: serverProfile?.email || bxUser?.EMAIL || firebaseUser.email || '',
                    position: serverProfile?.position || bxUser?.WORK_POSITION || 'Сотрудник iBOX',
                    avatar: serverProfile?.avatar || bxUser?.PERSONAL_PHOTO || '',
                    role: (serverProfile?.isAdmin || bxUser?.IS_ADMIN) ? 'admin' : 'employee',
                    department: deptName,
                    assignedCourses: []
                  };

                  // Save profile — try server admin first (works even if auth UID ≠ profile ID)
                  await contentService.saveProfile(currentProfile, firebaseUser);
                }
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
      default: return <TrainingView courses={courses} user={user} onSelectCourse={setSelectedCourse} refreshTrigger={refreshTrigger} />;
    }
  };

  return (
    <div className="h-[100dvh] w-full flex bg-ibox-bg relative overflow-hidden">
      <Sidebar user={user} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <div className="flex-1 flex flex-col sm:pl-16 min-w-0">
        <Navbar user={user} courses={courses} onSelectCourse={setSelectedCourse} onNavigate={setActiveTab} />
        {/* pb-16 leaves room for mobile bottom nav */}
        <main className="flex-1 mt-14 sm:mt-20 overflow-y-auto pb-16 sm:pb-0">{renderView()}</main>
      </div>
      {/* Mobile bottom navigation */}
      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} user={user} />
      <AIAssistant allCourses={courses} glossary={glossary} />
      {selectedCourse && (
        <CoursePlayer course={selectedCourse} user={user} onClose={handleClosePlayer} />
      )}
    </div>
  );
}
