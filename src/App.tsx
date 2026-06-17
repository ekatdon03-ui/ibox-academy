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
import { bitrixService } from './services/bitrixService';
import { UserProfile, Course, CourseResult, GlossaryTerm } from './types';
import { contentService } from './services/contentService';
import { authToken } from './services/api';

// ─── Bitrix24 login ───────────────────────────────────────────────────────────
// Verifies the Bitrix access_token server-side (/api/bitrix-auth), which returns
// our own JWT + the user profile. No Firebase, no Google login — the app runs
// only inside Bitrix24.
async function doBitrixLogin(): Promise<UserProfile | null> {
  try {
    const BX24 = (window as any).BX24;
    const bxAuth = BX24?.getAuth?.();
    if (!bxAuth?.access_token) return null;

    const domain = (bxAuth.domain || window.location.hostname)
      .replace(/^https?:\/\//, '').replace(/\/$/, '');

    const resp = await fetch('/api/bitrix-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bitrixDomain: domain, accessToken: bxAuth.access_token }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.token) authToken.set(data.token);
    return (data.profile as UserProfile) || null;
  } catch (e) {
    console.warn('Bitrix login error:', e);
    return null;
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
  const [authError, setAuthError] = useState(false);

  const handleRefreshUser = async () => {
    if (!user?.id) return;
    try {
      const [allUsers, allResults] = await Promise.all([
        contentService.getAllUsers(),
        contentService.getAllResults(),
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

  useEffect(() => {
    const initApp = async () => {
      // 1. Load public content immediately (courses/glossary GET endpoints are open)
      try {
        const [allCourses, allGlossary] = await Promise.all([
          contentService.getAllCourses(),
          contentService.getGlossary(),
        ]);
        setCourses(allCourses);
        setGlossary(allGlossary);
      } catch (_) {}

      // 2. Authenticate via Bitrix
      await bitrixService.init();
      let profile: UserProfile | null = null;

      if (bitrixService.isAvailable()) {
        profile = await doBitrixLogin();
      }

      // 3. Fallback to a cached session (e.g. page refresh) if we still have a token
      if (!profile && authToken.get()) {
        const saved = localStorage.getItem('academy_user');
        if (saved) { try { profile = JSON.parse(saved); } catch (_) {} }
      }

      if (profile) {
        setUser(profile);
        localStorage.setItem('academy_user', JSON.stringify(profile));

        if (profile.role === 'admin' || profile.role === 'manager') {
          contentService.getAllUsers().then(setUsers);
          contentService.getAllResults().then(setResults);
        }
        // Refresh courses now that we're authenticated (admins may see hidden ones)
        contentService.getAllCourses().then(setCourses).catch(() => {});
      } else {
        setAuthError(true);
      }

      setIsLoading(false);
    };

    initApp();
  }, []);

  const handleUpdateUser = (updatedUser: UserProfile) => {
    setUser(updatedUser);
    localStorage.setItem('academy_user', JSON.stringify(updatedUser));
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
    return (
      <div className="h-screen w-full flex items-center justify-center bg-ibox-bg flex-col gap-6 px-8 text-center">
        <div className="w-20 h-20 bg-[#00A3FF] rounded-[28px] flex items-center justify-center font-display font-black text-3xl text-white shadow-xl shadow-[#00A3FF]/20">A</div>
        <h1 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">iBOX Academy</h1>
        <p className="text-sm font-bold text-gray-400 max-w-md leading-relaxed">
          Это приложение работает внутри Bitrix24. Откройте его в портале Bitrix24, чтобы войти автоматически.
        </p>
        <a
          href="https://portal.i-box.company/marketplace/app/498/"
          target="_blank" rel="noreferrer"
          className="px-6 py-3 bg-[#002D57] text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[#00A3FF] transition-colors"
        >
          Открыть в Bitrix24
        </a>
      </div>
    );
  }

  const renderView = () => {
    switch (activeTab) {
      case 'training':  return <TrainingView courses={courses} user={user} onSelectCourse={setSelectedCourse} refreshTrigger={refreshTrigger} />;
      case 'glossary':  return <GlossaryView />;
      case 'profile':   return <ProfileView user={user} onUpdateUser={handleUpdateUser} courses={courses} />;
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
      <Sidebar user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
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
