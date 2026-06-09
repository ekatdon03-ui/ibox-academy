import React, { useState, useEffect } from 'react';
import { UserProfile, Course } from '../types';
import { Bell, Search, X, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

interface NavbarProps {
  user: UserProfile;
  courses?: Course[];
  onSelectCourse?: (course: Course) => void;
  onNavigate?: (tab: string) => void;
}

export default function Navbar({ user, courses = [], onSelectCourse, onNavigate }: NavbarProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  // Use sessionStorage key so banner fires at most once per browser session per user
  const bannerShownKey = `notif_banner_shown_${user.id}`;

  // ── Search state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchResults = searchQuery.trim().length >= 2
    ? courses.filter(c => {
        const q = searchQuery.toLowerCase();
        return (
          c.title?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.category?.toLowerCase().includes(q)
        );
      }).slice(0, 6)
    : [];

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!user.id) return;

    const toItem = (d: any) => {
      const data = typeof d.data === 'function' ? d.data() : d;
      return {
        id: d.id ?? data.id,
        ...data,
        time: data.createdAt?.seconds
          ? new Date(data.createdAt.seconds * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : 'Только что'
      };
    };

    const handleItems = (items: any[]) => {
      // Sort client-side — no composite index required
      const sorted = [...items].sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setNotifications(sorted);

      // Show banner only once per session (sessionStorage persists across remounts)
      const alreadyShown = sessionStorage.getItem(bannerShownKey);
      if (!alreadyShown) {
        const unread = sorted.filter(n => !n.read);
        if (unread.length > 0) {
          sessionStorage.setItem(bannerShownKey, '1');
          setBanner(unread.length === 1
            ? `У вас новое уведомление: ${unread[0].title}`
            : `У вас ${unread.length} новых уведомлений`
          );
          setTimeout(() => setBanner(null), 6000);
        }
      }
    };

    // Query WITHOUT orderBy — no composite index needed; sort is done client-side
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.id)
    );

    const unsub = onSnapshot(q, (snap) => {
      handleItems(snap.docs.map(toItem));
    }, () => {
      // Fallback: one-time fetch if real-time listener fails
      contentService.getNotifications(user.id)
        .then(handleItems)
        .catch(() => {});
    });

    return () => unsub();
  }, [user.id]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = async () => {
    // Optimistic update first — UI responds instantly
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    // Persist to Firestore (errors are swallowed inside the method)
    contentService.markNotificationsReadByIds(unreadIds);
  };

  const handleNotifClick = async (id: string) => {
    // Optimistic update first
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    // Persist to Firestore
    contentService.markNotificationRead(id);
  };

  return (
    <>
      {/* New-notifications banner */}
      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-4 bg-[#002D57] text-white px-8 py-4 rounded-2xl shadow-2xl"
          >
            <BookOpen size={18} className="text-[#00A3FF] shrink-0" />
            <span className="text-sm font-bold">{banner}</span>
            <button
              onClick={() => { setBanner(null); setShowNotifications(true); }}
              className="ml-2 text-[10px] font-black uppercase tracking-widest text-[#00A3FF] hover:text-white transition-colors"
            >
              Открыть
            </button>
            <button onClick={() => setBanner(null)} className="text-white/40 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    <header className="h-20 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-10 fixed top-0 right-0 left-72 z-40">
      {/* Search */}
      <div ref={searchRef} className="relative w-96">
        <div className="flex items-center gap-4 bg-[#F5F7FA] px-6 py-3 rounded-2xl border border-gray-50 focus-within:border-[#00A3FF] transition-all">
          <Search size={16} className="text-gray-300 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="ПОИСК ПО АКАДЕМИИ..."
            className="bg-transparent border-none outline-none w-full text-[10px] font-black uppercase tracking-[0.2em] placeholder:text-gray-300 text-[#002D57]"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setShowResults(false); }} className="text-gray-300 hover:text-[#002D57] transition-colors shrink-0">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Results dropdown */}
        <AnimatePresence>
          {showResults && searchResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute top-full mt-2 left-0 right-0 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
            >
              {searchResults.map(course => (
                <button
                  key={course.id}
                  onClick={() => {
                    setSearchQuery('');
                    setShowResults(false);
                    if (onNavigate) onNavigate('training');
                    if (onSelectCourse) onSelectCourse(course);
                  }}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#F5F7FA] transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#002D57] flex items-center justify-center shrink-0">
                    <BookOpen size={14} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-tight text-[#002D57] truncate">{course.title}</p>
                    <p className="text-[9px] font-bold text-[#00A3FF] uppercase tracking-widest">{course.category}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          )}
          {showResults && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute top-full mt-2 left-0 right-0 bg-white rounded-2xl shadow-2xl border border-gray-100 px-5 py-4 z-50"
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Ничего не найдено</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative text-gray-300 hover:text-[#002D57] transition-all"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#00A3FF] rounded-full border-2 border-white shadow-sm"></span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 mt-6 w-80 bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
              >
                <div className="p-6 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">Уведомления</h4>
                  <button onClick={() => setShowNotifications(false)}><X size={14} className="text-gray-300" /></button>
                </div>
                <div className="divide-y divide-gray-50 max-h-[300px] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-[10px] font-bold uppercase tracking-widest text-gray-300">
                      Нет уведомлений
                    </div>
                  ) : notifications.map(notif => (
                    <div
                      key={notif.id}
                      className={`p-6 hover:bg-gray-50 transition-colors cursor-pointer relative ${!notif.read ? 'bg-[#002D57]/[0.02]' : ''}`}
                      onClick={() => handleNotifClick(notif.id)}
                    >
                      {!notif.read && <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-1 bg-[#00A3FF] rounded-full" />}
                      <div className="flex justify-between items-start mb-2">
                        <p className={`text-xs font-bold uppercase tracking-tight ${!notif.read ? 'text-[#002D57]' : 'text-gray-400'}`}>{notif.title}</p>
                        <span className="text-[8px] font-bold text-gray-300 uppercase">{notif.time}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 font-medium leading-relaxed">{notif.text}</p>
                    </div>
                  ))}
                </div>
                {notifications.length > 0 && (
                  <button
                    onClick={markAllRead}
                    className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-[#00A3FF] bg-white border-t border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    Прочитать все
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-5 pl-8 border-l border-gray-100">
          <div className="text-right">
            <p className="font-display font-black text-xs uppercase tracking-tight text-[#002D57] leading-none">{user.name}</p>
            <p className="text-[8px] text-[#00A3FF] font-black uppercase tracking-[0.2em] mt-1.5">{user.position}</p>
          </div>
          <div className="w-11 h-11 rounded-2xl overflow-hidden bg-[#002D57] flex items-center justify-center text-white font-display font-black text-xs border border-gray-100 shadow-xl">
            {user.name?.split(' ').map(n => n[0] || '').join('') || '?'}
          </div>
        </div>
      </div>
    </header>
    </>
  );
}
