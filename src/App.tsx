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
import { auth } from './lib/firebase';
import { signInAnonymously } from 'firebase/auth';

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
    } catch (e) {
      console.warn("Refresh failed", e);
    }
  };

  const handleClosePlayer = () => {
    setSelectedCourse(null);
    setRefreshTrigger(prev => prev + 1);
    handleRefreshUser();
  };

  const syncUserSession = async (profile: UserProfile, firebaseUser: any) => {
    if (!profile.id) return profile;
    try {
      let role = await contentService.resolveUserRole(profile.id, profile.role);
      const updatedProfile = { ...profile, role: role as any, email: firebaseUser.email || profile.email || '' };

      // Superadmin override
      if (updatedProfile.email === 'oap.ibox.company@gmail.com') {
        updatedProfile.role = 'admin';
      }

      await contentService.syncUserRole(updatedProfile.id, updatedProfile.role, firebaseUser);
      await contentService.saveProfile(updatedProfile, firebaseUser);
      return updatedProfile;
    } catch (e) {
      console.warn("Session sync failed:", e);
      return profile;
    }
  };

  useEffect(() => {
    const initApp = async () => {
      // Load public content immediately (no auth needed)
      try {
        const [allCourses, allGlossary] = await Promise.all([
          contentService.getAllCourses(),
          contentService.getGlossary()
        ]);
        setCourses(allCourses);
        setGlossary(allGlossary);
      } catch (e) { /* will retry after auth */ }

      // In Bitrix24 iframe, Google popup is blocked → wait for BX24 SDK, then sign in anonymously
      // bitrixService.init() polls for window.BX24 up to 5 seconds before giving up
      await bitrixService.init();
      if (bitrixService.isAvailable()) {
        try {
          if (!auth.currentUser) {
            await signInAnonymously(auth);
          }
        } catch (e) {
          console.warn("Bitrix anonymous sign-in failed:", e);
        }
      }

      // Firebase auth state listener
      auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
          let currentProfile: UserProfile | null = null;

          // ── Bitrix24 context ──
          if (bitrixService.isAvailable()) {
            const bProfile = await bitrixService.getCurrentUser();
            const dbProfile = await contentService.resolveUserProfile(firebaseUser.uid);

            if (bProfile) {
              currentProfile = {
                id: firebaseUser.uid,
                name: `${bProfile.NAME || ''} ${bProfile.LAST_NAME || ''}`.trim() || dbProfile?.name || 'Сотрудник Bitrix',
                position: bProfile.WORK_POSITION || dbProfile?.position || 'Сотрудник',
                role: bProfile.IS_ADMIN ? 'admin' : (dbProfile?.role as any || 'employee'),
                avatar: bProfile.PERSONAL_PHOTO || dbProfile?.avatar || '',
                score: dbProfile?.score ?? 0,
                department: dbProfile?.department || 'Общий отдел',
                email: bProfile.EMAIL || firebaseUser.email || '',
                assignedCourses: dbProfile?.assignedCourses || [],
                bitrixId: bProfile.ID
              };
              await contentService.syncUserProfile(currentProfile);
            } else if (dbProfile) {
              currentProfile = { ...dbProfile, id: firebaseUser.uid };
            }
          }

          // ── Saved session ──
          if (!currentProfile) {
            const savedRaw = localStorage.getItem('academy_user');
            const dbProfile = await contentService.resolveUserProfile(firebaseUser.uid);

            if (savedRaw) {
              const parsed = JSON.parse(savedRaw);
              currentProfile = {
                ...parsed,
                ...dbProfile,
                id: firebaseUser.uid,
                email: firebaseUser.email || parsed.email || dbProfile?.email || ''
              };
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

            if (syncedUser.role === 'admin' || syncedUser.role === 'manager') {
              contentService.getAllUsers().then(setUsers);
              contentService.getAllResults().then(setResults);
            }

            // Reload courses/glossary now that user is authenticated
            try {
              const [allCourses, allGlossary] = await Promise.all([
                contentService.getAllCourses(),
                contentService.getGlossary()
              ]);
              setCourses(allCourses);
              setGlossary(allGlossary);
            } catch (e) {}
          }
        } else {
          // No firebase user — check localStorage for cached profile
          const savedUser = localStorage.getItem('academy_user');
          if (savedUser) {
            try { setUser(JSON.parse(savedUser)); } catch (e) {}
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
    try { await auth.signOut(); } catch (e) {}
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
      case 'training':   return <TrainingView courses={courses} user={user} onSelectCourse={setSelectedCourse} refreshTrigger={refreshTrigger} />;
      case 'glossary':   return <GlossaryView />;
      case 'profile':    return <ProfileView user={user} onLogout={handleLogout} onUpdateUser={handleUpdateUser} courses={courses} />;
      case 'simulator':  return <SimulatorView courses={courses} user={user} onRefreshUser={handleRefreshUser} />;
      case 'analytics':  return <AnalyticsView results={results} courses={courses} currentUser={user} employees={users} />;
      case 'admin':      return (
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

      <div className="flex-1 flex flex-col pl-72">
        <Navbar user={user} />
        <main className="flex-1 mt-20 overflow-y-auto">
          {renderView()}
        </main>
      </div>

      <AIAssistant allCourses={courses} glossary={glossary} />

      {selectedCourse && (
        <CoursePlayer
          course={selectedCourse}
          user={user}
          onClose={handleClosePlayer}
        />
      )}
    </div>
  );
}
