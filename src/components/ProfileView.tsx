import React, { useEffect, useState } from 'react';
import { UserProfile, SimulatorSession, CourseResult, UserCourseProgress, Course } from '../types';
import { Award, Star, TrendingUp, Edit2, LogOut, Shield, MapPin, Mail, Zap, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';

interface ProfileViewProps {
  user: UserProfile;
  onLogout: () => void;
  onUpdateUser: (user: UserProfile) => void;
  courses: Course[];
}

export default function ProfileView({ user, onLogout, onUpdateUser, courses }: ProfileViewProps) {
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);
  const [newAvatarUrl, setNewAvatarUrl] = useState(user.avatar || '');
  const [results, setResults] = useState<CourseResult[]>([]);
  const [trainerHistory, setTrainerHistory] = useState<SimulatorSession[]>([]);
  const [lessonHistory, setLessonHistory] = useState<UserCourseProgress[]>([]);
  const [activeHistoryTab, setActiveHistoryTab] = useState<'lessons' | 'ai'>('lessons');
  const [adminMsg, setAdminMsg] = useState('');

  const ADMIN_EMAILS = ['oap.ibox.company@gmail.com', 'pem@i-box.company'];
  const canRequestAdmin = ADMIN_EMAILS.includes(user.email || '');

  const handleRequestAdmin = async () => {
    try {
      await contentService.setUserRole(user.id, 'admin');
      onUpdateUser({ ...user, role: 'admin' });
      setAdminMsg('Роль администратора назначена! Перезагрузи страницу.');
    } catch (e: any) {
      setAdminMsg('Ошибка: ' + e.message + '\n\nТвой ID: ' + user.id + '\nEmail: ' + user.email);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [uResults, history, progress] = await Promise.all([
          contentService.getAllResults(), // Fallback for demo
          contentService.getSimulatorSessions(user.id),
          contentService.getAllProgressForUser(user.id)
        ]);
        
        setResults(uResults.filter(r => r.userId === user.id));
        setTrainerHistory(history);
        setLessonHistory(progress);
      } catch (e) {
        console.error("Profile load failed:", e);
      }
    };
    load();
  }, [user.id]);

  const avgScore = results.length > 0 
    ? Math.round(results.reduce((acc, curr) => acc + curr.score, 0) / results.length) 
    : 0;

  const stats = [
    { label: 'Курсов пройдено', value: results.length.toString(), icon: Star, color: 'text-yellow-500', bg: 'bg-yellow-50' },
    { label: 'Средний балл', value: `${avgScore}%`, icon: Award, color: 'text-[#00A3FF]', bg: 'bg-[#00A3FF]/5' },
    { label: 'Ваш рейтинг (XP)', value: user.score.toString(), icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50' },
  ];

  const handleAvatarSave = () => {
    onUpdateUser({ ...user, avatar: newAvatarUrl });
    setIsEditingAvatar(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-[#F5F7FA]">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <h2 className="text-5xl font-display font-black uppercase tracking-tight text-[#002D57] leading-none">Личный профиль</h2>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-4">Ваши персональные данные и достижения iBOX Academy</p>
        </header>

        <div className="bg-white rounded-[64px] border border-gray-100 shadow-sm p-16 mb-12 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3FF]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl group-hover:bg-[#00A3FF]/10 transition-all duration-700" />
          
          <div className="flex flex-col lg:flex-row items-center lg:items-start gap-16 relative">
            <div className="relative shrink-0">
              <div className="w-56 h-56 rounded-[56px] overflow-hidden bg-gray-50 border-4 border-white shadow-2xl">
                <img 
                  src={user.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`} 
                  alt="Avatar" 
                  className="w-full h-full object-cover"
                />
              </div>
              <button 
                onClick={() => setIsEditingAvatar(true)}
                className="absolute -bottom-4 -right-4 w-16 h-16 bg-[#002D57] text-white rounded-3xl flex items-center justify-center hover:bg-[#00A3FF] transition-all shadow-2xl"
              >
                <Edit2 size={24} />
              </button>
            </div>

            <div className="flex-1 text-center lg:text-left pt-4">
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 mb-6">
                <span className="px-5 py-2.5 bg-[#002D57] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                  <Shield size={12} fill="currentColor" />
                  {user.role}
                </span>
                <span
                  title={user.id}
                  className="px-5 py-2.5 bg-white border border-gray-100 text-gray-400 rounded-2xl text-[10px] font-black uppercase tracking-widest cursor-pointer select-all"
                  onClick={() => { navigator.clipboard?.writeText(user.id); }}
                >
                  ID: {user.id.substring(0, 12)}…
                </span>
              </div>
              
              <h3 className="text-6xl font-display font-black uppercase tracking-tighter text-[#002D57] mb-3 leading-none">{user.name}</h3>
              <p className="text-2xl text-[#00A3FF] font-display font-black uppercase tracking-tight mb-10">{user.position}</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="flex items-center gap-4 text-gray-400 group/item">
                   <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-hover/item:text-[#002D57] transition-all">
                      <MapPin size={18} />
                   </div>
                   <span className="text-xs font-bold uppercase tracking-widest">{user.department}</span>
                </div>
                <div className="flex items-center gap-4 text-gray-400 group/item">
                   <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-hover/item:text-[#002D57] transition-all">
                      <Mail size={18} />
                   </div>
                   <span className="text-xs font-bold font-mono tracking-tight lowercase">{user.email || 'no-email@ibox.ru'}</span>
                </div>
              </div>

              {canRequestAdmin && user.role !== 'admin' && (
                <div className="mt-6">
                  <button
                    onClick={handleRequestAdmin}
                    className="px-6 py-3 bg-[#00A3FF] text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-[#002D57] transition-colors"
                  >
                    Назначить себя администратором
                  </button>
                  {adminMsg && <p className="mt-3 text-xs text-gray-500 whitespace-pre-wrap">{adminMsg}</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {stats.map((stat, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-white p-12 rounded-[56px] border border-gray-100 shadow-sm flex flex-col items-center text-center hover:shadow-xl transition-all"
            >
              <div className={`w-20 h-20 ${stat.bg} ${stat.color} rounded-[32px] flex items-center justify-center mb-8`}>
                <stat.icon size={40} />
              </div>
              <p className="text-5xl font-display font-black text-[#002D57] mb-2">{stat.value}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* History Tabs */}
        <div className="mb-16">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-4">
              <Zap className="text-[#002D57]" size={24} />
              <h3 className="text-3xl font-display font-black uppercase tracking-tight text-[#002D57]">История активности</h3>
            </div>
            <div className="flex bg-white p-1 rounded-2xl border border-gray-100 shadow-sm">
                <button 
                  onClick={() => setActiveHistoryTab('lessons')}
                  className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeHistoryTab === 'lessons' ? 'bg-[#002D57] text-white shadow-lg' : 'text-gray-400 hover:text-[#002D57]'}`}
                >
                  Уроки
                </button>
                <button 
                  onClick={() => setActiveHistoryTab('ai')}
                  className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeHistoryTab === 'ai' ? 'bg-[#002D57] text-white shadow-lg' : 'text-gray-400 hover:text-[#002D57]'}`}
                >
                  ИИ Тренировки
                </button>
            </div>
          </div>

          <div className="bg-white rounded-[48px] border border-gray-100 shadow-sm overflow-hidden min-h-[400px]">
             <AnimatePresence mode="wait">
               {activeHistoryTab === 'lessons' ? (
                 <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} key="lessons">
                   {lessonHistory.length === 0 ? (
                     <div className="p-20 text-center text-gray-300 font-display font-black uppercase tracking-widest text-sm">Нет данных об уроках</div>
                   ) : (
                     lessonHistory.map((progress, idx) => {
                       const course = courses.find(c => c.id === progress.courseId);
                       return (
                        <div key={idx} className="p-8 border-b border-gray-50 flex items-center justify-between group hover:bg-gray-50/50 transition-all">
                           <div className="flex items-center gap-6">
                              <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center font-display font-black text-[#00A3FF] border border-gray-100">
                                 {progress.overallProgress}%
                              </div>
                              <div>
                                 <p className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] mb-1">
                                    {course?.title || `ID: ${progress.courseId}`}
                                 </p>
                                 <p className="font-bold text-[#002D57] text-lg">Прогресс в обучении</p>
                                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">ОБНОВЛЕНО: {new Date(progress.lastUpdated).toLocaleString()}</p>
                              </div>
                           </div>
                           <div className="h-2 w-32 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-green-500" style={{ width: `${progress.overallProgress}%` }} />
                           </div>
                        </div>
                       );
                     })
                   )}
                 </motion.div>
               ) : (
                 <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} key="ai">
                   {trainerHistory.length === 0 ? (
                     <div className="p-20 text-center text-gray-300 font-display font-black uppercase tracking-widest text-sm">История пуста</div>
                   ) : (
                     trainerHistory.map((session, idx) => {
                        const course = courses.find(c => c.id === session.courseId);
                        const lesson = course?.lessons.find(l => l.id === session.lessonId);
                        return (
                          <div key={idx} className="p-8 border-b border-gray-50 flex items-center justify-between group hover:bg-gray-50/50 transition-all">
                            <div className="flex items-center gap-6">
                                <div className="w-16 h-16 bg-[#002D57] text-white rounded-3xl flex items-center justify-center font-display font-black text-xl shadow-lg">
                                    {session.score}
                                </div>
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] mb-1">
                                      {course?.title || 'Общая тренировка'} {lesson ? `/ ${lesson.title}` : ''}
                                    </p>
                                    <p className="font-bold text-[#002D57] leading-relaxed max-w-xl line-clamp-2">{session.feedback}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 text-gray-300 group-hover:text-[#002D57] transition-all">
                                <Clock size={16} />
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                  {session.timestamp ? new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Недавно'}
                                </span>
                            </div>
                          </div>
                   );})
                   )}
                 </motion.div>
               )}
             </AnimatePresence>
          </div>
        </div>

        <button 
          onClick={onLogout}
          className="w-full py-8 border-4 border-dashed border-gray-200 rounded-[56px] text-gray-300 hover:text-red-500 hover:border-red-500/20 hover:bg-red-50 transition-all flex items-center justify-center gap-4 font-display font-black uppercase tracking-[0.2em] text-sm"
        >
          <LogOut size={24} />
          Выйти из системы Academy
        </button>
      </div>

      <AnimatePresence>
        {isEditingAvatar && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" 
              onClick={() => setIsEditingAvatar(false)} 
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-[40px] w-full max-w-lg relative z-10 p-12 shadow-2xl"
            >
              <h3 className="text-3xl font-display font-black uppercase mb-6 tracking-tight text-[#002D57]">Сменить аватар</h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-8">Введите URL изображения или используйте ссылку на фото</p>
              
              <div className="space-y-6">
                <input 
                  type="text" 
                  value={newAvatarUrl}
                  onChange={(e) => setNewAvatarUrl(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                  className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 font-bold outline-none border border-transparent focus:border-[#00A3FF] transition-all"
                />
                
                <div className="flex gap-4">
                  <button 
                    onClick={() => setIsEditingAvatar(false)}
                    className="flex-1 py-4 bg-gray-100 rounded-2xl font-black uppercase tracking-widest text-[10px] text-gray-400 hover:bg-gray-200 transition-all"
                  >
                    Отмена
                  </button>
                  <button 
                    onClick={handleAvatarSave}
                    className="flex-1 py-4 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg hover:bg-[#00A3FF] transition-all"
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
