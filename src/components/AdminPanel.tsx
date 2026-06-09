import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Plus, ListChecks, FileText, Users,
  BarChart3, Settings, Upload, Check, Zap,
  X, HelpCircle, Save, Play, Shield, Eye, EyeOff,
  Link as LinkIcon, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Course, GlossaryTerm, UserProfile, TestConfig, QuizQuestion, Lesson } from '../types';
import { contentService, AISettings } from '../services/contentService';
import { aiService } from '../services/aiService';
import { bitrixService } from '../services/bitrixService';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { writeBatch, doc } from 'firebase/firestore';

interface AdminPanelProps {
  courses: Course[];
  onAddCourse: (course: Course) => void;
  onUpdateCourses: (courses: Course[]) => void;
  onUserRoleChange: (user: UserProfile) => void;
  onUpdateUser?: (user: UserProfile) => void;
  onUpdateAllUsers?: (users: UserProfile[]) => void;
  currentUser: UserProfile;
}

export default function AdminPanel({ courses, onAddCourse, onUpdateCourses, onUserRoleChange, onUpdateUser, onUpdateAllUsers, currentUser }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'team' | 'glossary' | 'ai' | 'roles'>('content');
  const [isAddingCourse, setIsAddingCourse] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [isConfiguringTest, setIsConfiguringTest] = useState<string | null>(null); // courseId
  const [accessCourseId, setAccessCourseId] = useState<string | null>(null);
  const [teamTabCourseId, setTeamTabCourseId] = useState<string>('');
  
  // AI Settings
  const [aiSettings, setAiSettings] = useState<AISettings>({ tutorPrompt: '', assistantPrompt: '' });
  const [isSavingAi, setIsSavingAi] = useState(false);

  // Glossary state
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [newTerm, setNewTerm] = useState({ term: '', definition: '', category: '' });
  const [editingTerm, setEditingTerm] = useState<GlossaryTerm | null>(null);
  const [isAiGeneratingTerm, setIsAiGeneratingTerm] = useState(false);
  const [generationCourseId, setGenerationCourseId] = useState('');

  const handleGenerateGlossaryFromCourse = async () => {
    if (!generationCourseId) {
      showToast("Выберите курс для генерации", true);
      return;
    }
    const course = courses.find(c => c.id === generationCourseId);
    if (!course) return;

    setIsAiGeneratingTerm(true);
    try {
      const allText = course.lessons.map(l => `${l.title}\n${l.content}\n${l.aiKnowledge || ''}`).join('\n');
      const result = await aiService.generateGlossaryTermFromContent(allText);
      if (result) {
        setNewTerm({ term: result.term, definition: result.definition, category: result.category });
        showToast(`ИИ предложил термин: ${result.term}. Отредактируйте и сохраните.`);
      }
    } catch (e) {
      showToast("Ошибка при генерации через ИИ", true);
    } finally {
      setIsAiGeneratingTerm(false);
    }
  };

  // User management
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isAssigningCourse, setIsAssigningCourse] = useState<string | null>(null); // userId
  const [assignmentSuccess, setAssignmentSuccess] = useState<string | null>(null); // userId for checkmark
  const [viewingUserSessions, setViewingUserSessions] = useState<UserProfile | null>(null);
  const [userSessions, setUserSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [glossarySelectedCourseId, setGlossarySelectedCourseId] = useState<string>('');
  const [deptFilter, setDeptFilter] = useState<string>(currentUser.role === 'manager' ? (currentUser.department || 'Все отделы') : 'Все отделы');

  const [isSyncingBitrix, setIsSyncingBitrix] = useState(false);
  const [bitrixDepts, setBitrixDepts] = useState<string[]>([]);

  const handleBitrixSync = async () => {
    setIsSyncingBitrix(true);
    try {
      const result = await bitrixService.syncToFirestore(contentService);
      showToast(`Синхронизация успешна. Польз.: ${result.usersCount}, отд.: ${result.deptsCount}`);
      const u = await contentService.getAllUsers();
      setUsers(u);
      if (onUpdateAllUsers) onUpdateAllUsers(u);
    } catch (e) {
      showToast("Ошибка синхронизации с Bitrix24", true);
    } finally {
      setIsSyncingBitrix(false);
    }
  };

  useEffect(() => {
    const loadAdminData = async () => {
      const [g, u, s] = await Promise.all([
        contentService.getGlossary(),
        contentService.getAllUsers(),
        contentService.getAISettings(),
      ]);
      setGlossary(g);
      setUsers(u);
      setAiSettings(s);

      if (bitrixService.isAvailable()) {
        try {
          const depts = await bitrixService.getDepartments();
          setBitrixDepts(depts.map(d => d.NAME).filter(Boolean));
        } catch (_) {}
      }
    };
    loadAdminData();
  }, []);

  const filteredUsers = users.filter(u => {
    if (currentUser.role === 'manager') {
      return u.department === currentUser.department;
    }
    return deptFilter === 'Все отделы' || u.department === deptFilter;
  });

  // Merge Bitrix departments with departments found in user profiles
  const deptNamesFromUsers = users.map(u => u.department || '').filter(Boolean);
  const allDeptNames = bitrixDepts.length > 0 ? bitrixDepts : deptNamesFromUsers;
  const departments = ['Все отделы', ...new Set(allDeptNames)];

  const handleSaveAiSettings = async () => {
    setIsSavingAi(true);
    try {
      await contentService.saveAISettings(aiSettings);
      showToast("Настройки ИИ сохранены");
    } finally {
      setIsSavingAi(false);
    }
  };

  const handleAddGlossary = async () => {
    if (!newTerm.term || !newTerm.definition) return;
    try {
      if (editingTerm) {
        await contentService.updateGlossaryTerm(editingTerm.id!, newTerm);
        setGlossary(prev => prev.map(t => t.id === editingTerm.id ? { ...newTerm, id: editingTerm.id } : t));
        setEditingTerm(null);
      } else {
        const id = await contentService.addGlossaryTerm(newTerm);
        setGlossary(prev => [...prev, { ...newTerm, id }]);
      }
      setNewTerm({ term: '', definition: '', category: '' });
      setAssignmentSuccess('glossary-save');
      setTimeout(() => setAssignmentSuccess(null), 1500);
    } catch (e) {
      showToast("Ошибка при сохранении термина", true);
    }
  };

  const handleEditTerm = (term: GlossaryTerm) => {
    setEditingTerm(term);
    setNewTerm({ term: term.term, definition: term.definition, category: term.category });
  };

  const [pendingAction, setPendingAction] = useState<{ message: string; confirmLabel?: string; action: () => void } | null>(null);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const showToast = (message: string, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const handleViewUserHistory = async (user: UserProfile) => {
    setViewingUserSessions(user);
    setIsLoadingSessions(true);
    try {
      const sessions = await contentService.getSimulatorSessions(user.id);
      setUserSessions(sessions);
    } catch (e) {
      console.error("Failed to load user history", e);
    } finally {
      setIsLoadingSessions(false);
    }
  };
  // Mass assignment logic for use in modal
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const bulkAssign = async (courseId: string, targetUserIds: string[]) => {
    setIsBulkProcessing(true);
    try {
      // 1. Update Course Document (assignedToUsers)
      const course = courses.find(c => c.id === courseId);
      const currentAssigned = course?.assignedToUsers || [];
      // Only users NOT yet assigned — to avoid duplicate tasks
      const trulyNew = targetUserIds.filter(id => !currentAssigned.includes(id));
      const newAssigned = [...new Set([...currentAssigned, ...targetUserIds])];

      await contentService.updateCourse(courseId, { assignedToUsers: newAssigned });

      // 2. Update User Documents (assignedCourses)
      await contentService.massAssignCourse(courseId, targetUserIds);

      // 3. Create Bitrix24 tasks for newly assigned users (best-effort, fire-and-forget)
      if (course && trulyNew.length > 0) {
        for (const uid of trulyNew) {
          const u = users.find(u => u.id === uid);
          if (u?.bitrixId) {
            bitrixService.createCourseTask(u.bitrixId, course.title, course.description)
              .catch(() => {});
          }
        }
      }

      // 4. Update local state
      onUpdateCourses(courses.map(c => c.id === courseId ? { ...c, assignedToUsers: newAssigned } : c));
      
      // Refresh user list for good measure
      const updatedUsers = await contentService.getAllUsers();
      setUsers(updatedUsers);
      if (onUpdateAllUsers) onUpdateAllUsers(updatedUsers);
      
      return true;
    } catch (e) {
      console.error("Bulk assignment error:", e);
      return false;
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleAssignCourse = async (userId: string, courseId: string) => {
    try {
      const user = users.find(u => u.id === userId);
      const isCurrentlyAssigned = user?.assignedCourses?.includes(courseId);
      
      const course = courses.find(c => c.id === courseId);
      const isAssignedOnCourse = course?.assignedToUsers?.includes(userId);

      if (isCurrentlyAssigned || isAssignedOnCourse) {
        // Unassign
        await contentService.unassignCourseFromUser(userId, courseId);
        const newAssigned = (course?.assignedToUsers || []).filter(id => id !== userId);
        await contentService.updateCourse(courseId, { assignedToUsers: newAssigned });
        onUpdateCourses(courses.map(c => c.id === courseId ? { ...c, assignedToUsers: newAssigned } : c));
      } else {
        // Assign
        await contentService.assignCourseToUser(userId, courseId);
        const newAssigned = [...(course?.assignedToUsers || []), userId];
        await contentService.updateCourse(courseId, { assignedToUsers: newAssigned });
        onUpdateCourses(courses.map(c => c.id === courseId ? { ...c, assignedToUsers: newAssigned } : c));

        if (course) {
          await contentService.createNotification(
            userId,
            'Новая задача',
            `Вам назначен новый учебный курс: ${course.title}`
          );
          // Create Bitrix24 task for the employee (best-effort, won't block assignment)
          if (user?.bitrixId) {
            bitrixService.createCourseTask(user.bitrixId, course.title, course.description)
              .catch(() => {});
          }
        }
      }
      
      const updatedUsers = await contentService.getAllUsers();
      setUsers(updatedUsers);
      if (onUpdateAllUsers) onUpdateAllUsers(updatedUsers);
      
      // Success feedback
      setAssignmentSuccess(userId);
      setTimeout(() => {
        setAssignmentSuccess(null);
        if (activeTab === 'team') setIsAssigningCourse(null);
      }, 1200);
    } catch (e) {
      showToast("Ошибка при обновлении назначения", true);
    }
  };

  return (
    <div className="flex-1 p-10 bg-[#F5F7FA] min-h-full">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-display font-black uppercase tracking-tight text-[#002D57]">Центр управления</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-2">Панель администратора / iBOX Academy</p>
          </div>
          <div className="flex bg-white p-1 rounded-3xl shadow-sm border border-gray-100">
             {[
               { id: 'content', label: 'Контент', icon: FileText },
               { id: 'team', label: 'Команда', icon: Users },
               { id: 'roles', label: 'Роли', icon: Shield },
               { id: 'glossary', label: 'Глоссарий', icon: ListChecks },
               { id: 'ai', label: 'ИИ Тюнинг', icon: Zap }
             ].map(tab => (
               <button
                 key={tab.id}
                 onClick={() => setActiveTab(tab.id as any)}
                 className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] uppercase font-black tracking-widest transition-all ${activeTab === tab.id ? 'bg-[#002D57] text-white shadow-lg' : 'text-gray-400 hover:text-[#002D57]'}`}
               >
                 <tab.icon size={14} />
                 {tab.label}
               </button>
             ))}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'content' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key="content">
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  <button 
                    onClick={() => setIsAddingCourse(true)}
                    className="h-full min-h-[300px] border-4 border-dashed border-gray-200 rounded-[40px] flex flex-col items-center justify-center gap-4 hover:border-[#002D57] hover:bg-white transition-all group"
                  >
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 group-hover:bg-[#002D57] group-hover:text-white transition-all">
                      <Plus size={32} />
                    </div>
                    <p className="font-display font-black uppercase tracking-widest text-[#002D57] text-xs">Добавить курс</p>
                  </button>

                  {courses.map(course => (
                    <div key={course.id} className="bg-white rounded-[40px] border border-gray-100 p-8 shadow-sm hover:shadow-xl transition-all group flex flex-col">
                      <div className="h-40 bg-gray-50 rounded-3xl mb-6 relative overflow-hidden">
                        <img src={course.thumbnail} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute top-3 right-3 flex gap-1.5">
                            <button
                             onClick={() => setAccessCourseId(course.id)}
                             className="w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center text-[#002D57] hover:bg-[#002D57] hover:text-white transition-all shadow-sm"
                             title="Управление доступом"
                            >
                              <Shield size={15} />
                            </button>
                            <button
                             onClick={() => setEditingCourse(course)}
                             className="w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center text-[#002D57] hover:bg-[#002D57] hover:text-white transition-all shadow-sm"
                             title="Редактировать"
                            >
                              <Settings size={15} />
                            </button>
                            <button
                             onClick={() => setIsConfiguringTest(course.id)}
                             className="w-9 h-9 bg-white/90 backdrop-blur rounded-xl flex items-center justify-center text-[#002D57] hover:bg-[#00A3FF] hover:text-white transition-all shadow-sm"
                             title="Тест"
                            >
                              <ListChecks size={15} />
                            </button>
                        </div>
                      </div>
                      <h3 className="text-xl font-display font-black uppercase mb-2 tracking-tight line-clamp-1">{course.title}</h3>
                      <p className="text-gray-400 text-xs font-medium mb-6 line-clamp-2">{course.description}</p>
                      <div className="mt-auto">
                        <div className="pt-6 border-t border-gray-50 flex items-center justify-between">
                           <span className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF]">{course.category}</span>
                           <span className="text-[10px] font-bold text-gray-300">{(course.lessons || []).length} уроков</span>
                        </div>
                      </div>
                    </div>
                  ))}
               </div>
            </motion.div>
          )}

          {activeTab === 'glossary' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key="glossary">
               <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-10 mb-10">
                 <h2 className="text-2xl font-display font-black uppercase mb-8 ml-2 tracking-tight">
                   {editingTerm ? 'Редактировать термин' : 'Новый термин'}
                 </h2>
                 {editingTerm && (
                   <button 
                     onClick={() => {
                       setEditingTerm(null);
                       setNewTerm({ term: '', definition: '', category: '' });
                     }}
                     className="mb-4 ml-2 text-xs font-black uppercase tracking-widest text-[#00A3FF] hover:underline"
                   >
                     Отмена
                   </button>
                 )}
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Источник для ИИ (Курс)</label>
                       <select 
                         className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold focus:ring-4 focus:ring-[#00A3FF]/10 transition-all appearance-none"
                         value={generationCourseId}
                         onChange={e => setGenerationCourseId(e.target.value)}
                       >
                         <option value="">Выберите курс для анализа</option>
                         {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                       </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Термин</label>
                      <input 
                        className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold focus:ring-4 focus:ring-[#00A3FF]/10 transition-all"
                        placeholder="KPI, SLA..."
                        value={newTerm.term}
                        onChange={e => setNewTerm({...newTerm, term: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">
                        Определение
                      </label>
                      <div className="relative">
                        <input 
                          className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold focus:ring-4 focus:ring-[#00A3FF]/10 transition-all shadow-sm"
                          placeholder="Значение термина..."
                          value={newTerm.definition}
                          onChange={e => setNewTerm({...newTerm, definition: e.target.value})}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-2">
                           <button 
                             onClick={handleGenerateGlossaryFromCourse}
                             disabled={isAiGeneratingTerm || !generationCourseId}
                             className={`p-3 rounded-xl transition-all shadow-md bg-[#002D57] text-white hover:bg-[#00A3FF] disabled:opacity-30`}
                             title="Сгенерировать через ИИ"
                           >
                             {isAiGeneratingTerm ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap size={18} fill="currentColor" />}
                           </button>
                           <button 
                            onClick={handleAddGlossary}
                            className={`p-3 rounded-xl transition-all shadow-md ${editingTerm ? 'bg-[#002D57] hover:bg-[#00A3FF]' : 'bg-[#00A3FF] hover:bg-[#002D57]'} text-white shadow-xl hover:scale-105 active:scale-95`}
                            title={editingTerm ? "Сохранить изменения" : "Добавить термин"}
                           >
                            <Check size={18} strokeWidth={3} />
                           </button>
                        </div>
                      </div>
                    </div>
                 </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {glossary.map((t, idx) => (
                    <div key={t.id || `${t.term}-${idx}`} className="bg-white p-6 rounded-3xl border border-gray-100 flex items-center justify-between group">
                       <div className="flex-1">
                          <h4 className="font-display font-black uppercase text-sm tracking-tight">{t.term}</h4>
                          <p className="text-[10px] text-gray-400 font-medium leading-relaxed mt-1 line-clamp-1">{t.definition}</p>
                       </div>
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => handleEditTerm(t)}
                            className="p-3 text-[#00A3FF] hover:bg-[#002D57]/5 rounded-xl transition-all font-display font-black text-[10px] uppercase tracking-widest"
                          >
                            Ред.
                          </button>
                        </div>
                    </div>
                  ))}
               </div>
            </motion.div>
          )}

          {activeTab === 'team' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key="team">
               <div className="mb-8 flex flex-col gap-8">
                  <div className="flex items-center justify-between bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-4">
                      <Users className="text-[#002D57]" size={20} />
                      <h2 className="text-xl font-display font-black uppercase tracking-tight">Команда</h2>
                    </div>
                    
                    <div className="flex gap-4 items-center">
                      {bitrixService.isAvailable() && (
                        <button 
                          onClick={handleBitrixSync}
                          disabled={isSyncingBitrix}
                          className="flex items-center gap-2 bg-[#00A3FF]/10 text-[#00A3FF] px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#002D57] hover:text-white transition-all disabled:opacity-50"
                        >
                          {isSyncingBitrix ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          Синхронизация Bitrix24
                        </button>
                      )}
                      <div className="flex items-center gap-2 bg-[#F5F7FA] px-4 py-2 rounded-2xl border border-gray-100">
                        <Shield size={14} className="text-gray-400" />
                        <select 
                          value={teamTabCourseId}
                          onChange={(e) => setTeamTabCourseId(e.target.value)}
                          className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest cursor-pointer"
                        >
                          <option value="">Выберите курс для управления...</option>
                          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                        </select>
                      </div>

                      {currentUser.role === 'admin' ? (
                        <div className="flex items-center gap-2 bg-[#F5F7FA] px-4 py-2 rounded-2xl border border-gray-100">
                          <Users size={14} className="text-gray-400 shrink-0" />
                          <select
                            value={deptFilter}
                            onChange={e => setDeptFilter(e.target.value)}
                            className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest cursor-pointer max-w-[200px]"
                          >
                            {departments.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </div>
                      ) : currentUser.role === 'manager' && (
                        <div className="flex items-center gap-2 bg-[#F5F7FA] px-4 py-2 rounded-2xl border border-gray-100">
                          <Users size={14} className="text-[#002D57] shrink-0" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">
                            {currentUser.department || 'Мой отдел'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {teamTabCourseId && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-10 bg-[#002D57] rounded-[48px] shadow-2xl text-white relative overflow-hidden group"
                    >
                      <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3FF] blur-[120px] opacity-20 -mr-32 -mt-32" />
                      <div className="relative z-10">
                        <div className="flex items-center gap-5 mb-8">
                          <div className="w-14 h-14 bg-white/10 rounded-3xl flex items-center justify-center backdrop-blur-md border border-white/10 shadow-inner">
                             <Users size={28} className="text-[#00A3FF]" />
                          </div>
                          <div>
                            <p className="font-display font-black uppercase text-lg tracking-tight">Массовое назначение курса</p>
                            <p className="text-[10px] text-white/50 font-bold uppercase tracking-widest mt-1">
                              Курс: {courses.find(c => c.id === teamTabCourseId)?.title}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="bg-white/5 rounded-3xl p-6 border border-white/10 hover:bg-white/10 transition-all">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">Все сотрудники</p>
                            <div className="flex items-center justify-between">
                               <span className="text-xs font-bold">Весь список ({users.length})</span>
                               <button 
                                 onClick={() => {
                                   const course = courses.find(c => c.id === teamTabCourseId);
                                   const assignedIds = course?.assignedToUsers || [];
                                   const alreadyAssignedAll = users.length > 0 && users.every(u => assignedIds.includes(u.id));

                                   if (alreadyAssignedAll) {
                                     setPendingAction({
                                       message: "Удалить назначения для ВСЕХ сотрудников?",
                                       confirmLabel: "Удалить",
                                       action: async () => {
                                         await contentService.updateCourse(teamTabCourseId, { assignedToUsers: [] });
                                         onUpdateCourses(courses.map(c => c.id === teamTabCourseId ? { ...c, assignedToUsers: [] } : c));
                                       }
                                     });
                                   } else {
                                     setPendingAction({
                                       message: `Назначить курс ВСЕМ сотрудникам (${users.length} чел.)?`,
                                       confirmLabel: "Назначить",
                                       action: () => bulkAssign(teamTabCourseId, users.map(u => u.id))
                                     });
                                   }
                                 }}
                                 disabled={isBulkProcessing || users.length === 0}
                                 className={`w-14 h-7 rounded-full relative transition-all ${users.length > 0 && users.every(u => courses.find(c => c.id === teamTabCourseId)?.assignedToUsers?.includes(u.id)) ? 'bg-[#00A3FF]' : 'bg-white/20'}`}
                               >
                                 <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all ${users.length > 0 && users.every(u => courses.find(c => c.id === teamTabCourseId)?.assignedToUsers?.includes(u.id)) ? 'left-7.5' : 'left-0.5'}`} />
                               </button>
                            </div>
                          </div>

                          <div className="bg-white/5 rounded-3xl p-6 border border-white/10 hover:bg-white/10 transition-all col-span-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">Назначить отделу</p>
                            <div className="flex gap-3 flex-wrap">
                               {departments.filter(d => d !== 'Все отделы').map(dept => {
                                 const course = courses.find(c => c.id === teamTabCourseId);
                                 const isDeptPinned = (course?.assignedToDepartments || []).includes(dept);

                                 return (
                                   <button
                                     key={dept}
                                     onClick={() => {
                                       if (isDeptPinned) {
                                         setPendingAction({
                                           message: `Убрать доступ отдела "${dept}" к курсу?`,
                                           confirmLabel: "Убрать",
                                           action: async () => {
                                             const cur = courses.find(c => c.id === teamTabCourseId);
                                             const newDepts = (cur?.assignedToDepartments || []).filter(d => d !== dept);
                                             await contentService.updateCourse(teamTabCourseId, { assignedToDepartments: newDepts });
                                             onUpdateCourses(courses.map(c => c.id === teamTabCourseId ? { ...c, assignedToDepartments: newDepts } : c));
                                           }
                                         });
                                       } else {
                                         setPendingAction({
                                           message: `Дать доступ отделу "${dept}" — все текущие и новые сотрудники отдела увидят курс автоматически?`,
                                           confirmLabel: "Назначить",
                                           action: async () => {
                                             const cur = courses.find(c => c.id === teamTabCourseId);
                                             const newDepts = [...new Set([...(cur?.assignedToDepartments || []), dept])];
                                             await contentService.updateCourse(teamTabCourseId, { assignedToDepartments: newDepts });
                                             onUpdateCourses(courses.map(c => c.id === teamTabCourseId ? { ...c, assignedToDepartments: newDepts } : c));
                                           }
                                         });
                                       }
                                     }}
                                     disabled={isBulkProcessing}
                                     className={`px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all ${isDeptPinned ? 'bg-[#00A3FF] text-white border-transparent' : 'bg-white/10 text-white hover:bg-white/20 border border-white/20 active:scale-95'}`}
                                   >
                                     {dept} {isDeptPinned && '✓'}
                                   </button>
                                 );
                               })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
               </div>

               <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Сотрудник</th>
                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Роль/Должность</th>
                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Курсы</th>
                        <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredUsers.map(user => (
                        <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-10 py-8">
                            <div className="flex items-center gap-4">
                               <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center font-display font-bold text-gray-400">
                                 {user.name?.[0] || '?'}
                               </div>
                               <div>
                                 <p className="font-display font-black uppercase text-sm tracking-tight">{user.name}</p>
                                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{user.department}</p>
                               </div>
                            </div>
                          </td>
                          <td className="px-10 py-8">
                             <span className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] block mb-1">{user.role}</span>
                             <p className="text-xs font-medium text-gray-500">{user.position}</p>
                          </td>
                          <td className="px-10 py-8">
                             <div className="flex -space-x-2">
                                {(user.assignedCourses || []).slice(0, 3).map((_, i) => (
                                  <div key={i} className="w-8 h-8 rounded-lg bg-[#002D57] border-2 border-white flex items-center justify-center text-white text-[8px] font-bold">C{i+1}</div>
                                ))}
                                {(user.assignedCourses?.length || 0) > 3 && (
                                  <div className="w-8 h-8 rounded-lg bg-gray-100 border-2 border-white flex items-center justify-center text-gray-400 text-[8px] font-bold">+{user.assignedCourses!.length - 3}</div>
                                )}
                             </div>
                          </td>
                          <td className="px-10 py-8 text-right">
                             <div className="flex items-center justify-end gap-2">
                               <button 
                                 onClick={() => handleViewUserHistory(user)}
                                 className="p-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-[#002D57] hover:text-white transition-all"
                                 title="История активности"
                               >
                                 <BarChart3 size={16} />
                               </button>
                                <button 
                                  onClick={() => teamTabCourseId ? handleAssignCourse(user.id, teamTabCourseId) : setIsAssigningCourse(user.id)}
                                  className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                    teamTabCourseId 
                                      ? (courses.find(c => c.id === teamTabCourseId)?.assignedToUsers?.includes(user.id) || (user.assignedCourses || []).includes(teamTabCourseId)
                                          ? 'bg-[#002D57] text-white shadow-md' 
                                          : 'bg-white border border-gray-100 text-[#002D57] hover:border-[#002D57]')
                                      : 'bg-white border border-gray-100 text-[#002D57] hover:border-[#002D57]'
                                  }`}
                                >
                                  {teamTabCourseId 
                                    ? (courses.find(c => c.id === teamTabCourseId)?.assignedToUsers?.includes(user.id) || (user.assignedCourses || []).includes(teamTabCourseId) 
                                        ? 'Доступ открыт' 
                                        : 'Открыть доступ') 
                                    : 'Назначить курс'}
                                </button>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </motion.div>
          )}

          {activeTab === 'ai' && (
             <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key="ai" className="max-w-4xl">
                <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-10 space-y-10">
                   <header className="flex items-center gap-6">
                      <div className="w-20 h-20 bg-[#002D57] rounded-3xl flex items-center justify-center text-white shadow-2xl">
                        <Zap size={40} />
                      </div>
                      <div>
                        <h2 className="text-3xl font-display font-black uppercase tracking-tight">AI Тюнинг</h2>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF]">Настройка нейронной сети</p>
                      </div>
                   </header>

                   <div className="space-y-8">
                      <div className="space-y-4">
                        <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57]">Тьютор (Симуляция)</h3>
                        <div className="bg-[#F5F7FA] p-6 rounded-3xl border border-gray-100 focus-within:border-[#002D57] transition-all">
                           <textarea 
                             className="w-full bg-transparent outline-none text-sm font-medium text-gray-600 leading-relaxed min-h-[120px]"
                             value={aiSettings.tutorPrompt}
                             onChange={e => setAiSettings({...aiSettings, tutorPrompt: e.target.value})}
                             placeholder="Введите системный промпт для тьютора..."
                           />
                        </div>
                      </div>
                      <div className="space-y-4">
                        <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57]">Помощник (Smart Assistant)</h3>
                        <div className="bg-[#F5F7FA] p-6 rounded-3xl border border-gray-100 focus-within:border-[#002D57] transition-all">
                           <textarea 
                             className="w-full bg-transparent outline-none text-sm font-medium text-gray-600 leading-relaxed min-h-[120px]"
                             value={aiSettings.assistantPrompt}
                             onChange={e => setAiSettings({...aiSettings, assistantPrompt: e.target.value})}
                             placeholder="Введите системный промпт для ассистента..."
                           />
                        </div>
                      </div>
                      <button 
                        onClick={handleSaveAiSettings}
                        disabled={isSavingAi}
                        className="w-full bg-[#002D57] text-white py-6 rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                      >
                         {isSavingAi ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={20} />}
                         Сохранить настройки ИИ
                      </button>

                   </div>
                </div>
             </motion.div>
          )}

          {activeTab === 'roles' && (
             <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} key="roles">
                <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 overflow-hidden">
                   <div className="p-10 border-b border-gray-50 flex items-center justify-between">
                      <h2 className="text-2xl font-display font-black uppercase tracking-tight">Управление ролями</h2>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Назначение прав доступа</p>
                   </div>
                   <table className="w-full text-left">
                     <thead>
                       <tr className="bg-gray-50 border-b border-gray-100">
                         <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Пользователь</th>
                         <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Текущая роль</th>
                         <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-gray-400">Назначить роль</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50">
                       {users.map(user => (
                         <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                           <td className="px-10 py-8">
                             <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center font-display font-bold text-gray-400">
                                  {user.name?.[0] || '?'}
                                </div>
                                <div>
                                  <p className="font-display font-black uppercase text-sm tracking-tight">{user.name}</p>
                                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{user.email || 'Нет email'}</p>
                                </div>
                             </div>
                           </td>
                           <td className="px-10 py-8">
                              <span className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                                user.role === 'admin' ? 'bg-red-50 text-red-500' : 
                                user.role === 'manager' ? 'bg-blue-50 text-blue-500' : 'bg-gray-50 text-gray-500'
                              }`}>
                                {user.role}
                              </span>
                           </td>
                           <td className="px-10 py-8">
                              <div className="flex gap-2">
                                 {['admin', 'manager', 'employee'].map(role => (
                                   <button 
                                     key={role}
                                     onClick={async () => {
                                       try {
                                         await contentService.setUserRole(user.id, role);
                                         const updatedUser = { ...user, role: role as any };
                                         setUsers(prev => prev.map(u => u.id === user.id ? updatedUser : u));
                                         if (user.id === currentUser.id && onUpdateUser) {
                                           onUpdateUser(updatedUser);
                                         }
                                         showToast("Роль обновлена");
                                       } catch (e) {
                                         showToast("Ошибка при смене роли", true);
                                       }
                                     }}
                                     disabled={user.role === role}
                                     className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${
                                       user.role === role ? 'bg-[#002D57] text-white' : 'bg-white border border-gray-100 text-gray-400 hover:border-[#002D57]'
                                     }`}
                                   >
                                     {role}
                                   </button>
                                 ))}
                              </div>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {(isAddingCourse || editingCourse) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => { setIsAddingCourse(false); setEditingCourse(null); }} />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] w-full max-w-4xl relative z-10 p-12 shadow-2xl overflow-hidden flex flex-col"
              style={{ maxHeight: '90vh' }}
            >
              <div className="flex items-center justify-between mb-10 shrink-0">
                <h2 className="text-4xl font-display font-black uppercase tracking-tight">{editingCourse ? 'Редактировать' : 'Новый'} курс</h2>
              </div>
              <CourseCreationForm
                courses={courses}
                initialData={editingCourse || undefined}
                onCancel={() => { setIsAddingCourse(false); setEditingCourse(null); }}
                showToast={showToast}
                onComplete={(c) => {
                  onAddCourse(c);
                  setAssignmentSuccess('course-added');
                  setTimeout(() => {
                    setAssignmentSuccess(null);
                    setIsAddingCourse(false);
                    setEditingCourse(null);
                  }, 1500);
                }}
              />
              
              {assignmentSuccess === 'course-added' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-white/95 backdrop-blur flex flex-col items-center justify-center z-[110]"
                >
                  <div className="w-20 h-20 bg-green-500 text-white rounded-full flex items-center justify-center shadow-xl mb-6">
                    <Check size={40} strokeWidth={4} />
                  </div>
                  <p className="font-display font-black uppercase tracking-widest text-[#002D57]">Курс сохранён!</p>
                </motion.div>
              )}
            </motion.div>
          </div>
        )}

        {viewingUserSessions && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setViewingUserSessions(null)} />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] w-full max-w-4xl relative z-10 p-12 shadow-2xl h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-8 shrink-0">
                <div>
                  <h2 className="text-3xl font-display font-black uppercase tracking-tight">Активность: {viewingUserSessions.name}</h2>
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] mt-1">{viewingUserSessions.department} • {viewingUserSessions.position}</p>
                </div>
                <div className="flex items-center gap-6">
                  <button onClick={() => setViewingUserSessions(null)} className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 transition-all">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                   <div className="bg-gray-50 rounded-3xl p-8 border border-gray-100">
                      <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57] mb-6 flex items-center gap-2">
                        <Play size={16} /> Назначенные курсы
                      </h3>
                      <div className="space-y-3">
                         {(viewingUserSessions.assignedCourses || []).map(cid => {
                           const course = courses.find(c => c.id === cid);
                           return (
                             <div key={cid} className="bg-white p-4 rounded-xl flex items-center justify-between shadow-sm">
                               <p className="text-xs font-bold uppercase truncate max-w-[200px]">{course?.title || 'Курс удален'}</p>
                               <span className="text-[8px] font-black uppercase tracking-widest text-orange-400">В процессе</span>
                             </div>
                           )
                         })}
                         {(viewingUserSessions.assignedCourses || []).length === 0 && <p className="text-xs text-gray-400 italic">Нет назначенных курсов</p>}
                      </div>
                   </div>
                   <div className="bg-gray-50 rounded-3xl p-8 border border-gray-100">
                      <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57] mb-6 flex items-center gap-2">
                        <Zap size={16} /> Отработка на тренажере
                      </h3>
                      <div className="space-y-4">
                        {isLoadingSessions ? (
                          <div className="flex items-center justify-center py-10">
                            <div className="w-8 h-8 border-4 border-[#002D57]/20 border-t-[#002D57] rounded-full animate-spin" />
                          </div>
                        ) : (
                          <>
                            {userSessions.map((session, sIdx) => {
                              const course = courses.find(c => c.id === session.courseId);
                              return (
                                <div key={sIdx} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-50">
                                  <div className="flex justify-between items-start mb-3">
                                    <div>
                                      <p className="text-[10px] font-black uppercase tracking-tight">{course?.title || 'Неизвестный курс'}</p>
                                      <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">
                                        {session.createdAt?.toDate ? session.createdAt.toDate().toLocaleString() : 'Недавно'}
                                      </p>
                                    </div>
                                    <div className="bg-[#002D57] text-white px-3 py-1 rounded-lg font-display font-black text-xs">
                                      {session.score}
                                    </div>
                                  </div>
                                  <p className="text-[10px] font-medium text-gray-600 italic leading-relaxed">"{session.feedback}"</p>
                                </div>
                              )
                            })}
                            {userSessions.length === 0 && <p className="text-xs text-gray-400 italic">История сессий пуста</p>}
                          </>
                        )}
                      </div>
                   </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAssigningCourse && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setIsAssigningCourse(null)} />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] w-full max-w-lg relative z-10 p-12 shadow-2xl"
            >
              <h2 className="text-3xl font-display font-black uppercase mb-8 tracking-tight">Назначить курс</h2>
              <div className="space-y-4">
                {courses.map(course => {
                  const isAssigned = users.find(u => u.id === isAssigningCourse)?.assignedCourses?.includes(course.id);
                  const isSucceeding = assignmentSuccess === isAssigningCourse;
                  return (
                    <button 
                      key={course.id}
                      onClick={() => handleAssignCourse(isAssigningCourse!, course.id)}
                      className={`w-full p-6 text-left rounded-3xl border transition-all font-display font-black uppercase text-xs tracking-tight flex items-center justify-between group ${isAssigned ? 'border-[#002D57] bg-[#002D57]/5' : 'border-gray-100 hover:border-[#002D57] hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-3">
                         {isAssigned ? <X className="text-red-400" size={14} /> : <Plus className="text-gray-300 group-hover:text-[#002D57]" size={14} />}
                         {course.title}
                      </div>
                      {isSucceeding && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white">
                          <Check size={12} />
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        )}

        {isConfiguringTest && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setIsConfiguringTest(null)} />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] w-full max-w-4xl relative z-10 p-12 shadow-2xl h-[80vh] flex flex-col"
            >
              <h2 className="text-3xl font-display font-black uppercase mb-8 tracking-tight shrink-0">Редактор теста: {courses.find(c => c.id === isConfiguringTest)?.title}</h2>
              <TestEditor
                course={courses.find(c => c.id === isConfiguringTest)!}
                showToast={showToast}
                onSave={async (updates) => {
                  try {
                    await contentService.updateCourse(isConfiguringTest!, updates);
                    onUpdateCourses(courses.map(c => c.id === isConfiguringTest ? { ...c, ...updates } : c));
                    setIsConfiguringTest(null);
                    showToast("Настройки теста сохранены");
                  } catch (e) {
                    showToast("Ошибка сохранения", true);
                  }
                }}
              />
            </motion.div>
          </div>
        )}

        {accessCourseId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setAccessCourseId(null)} />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[40px] w-full max-w-4xl relative z-10 p-12 shadow-2xl h-[80vh] flex flex-col"
            >
              <h2 className="text-3xl font-display font-black uppercase mb-8 tracking-tight shrink-0">Управление доступом: {courses.find(c => c.id === accessCourseId)?.title}</h2>
              
              <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
                     <div className="flex items-center justify-between p-8 bg-gray-50 rounded-[32px] border border-gray-100">
                        <div>
                          <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">Доступен всем</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Виден в каталоге для всех</p>
                        </div>
                        <button 
                          onClick={async () => {
                            try {
                              const course = courses.find(c => c.id === accessCourseId);
                              const newVal = !course?.isPublic;
                              await contentService.updateCourse(accessCourseId!, { isPublic: newVal });
                              onUpdateCourses(courses.map(c => c.id === accessCourseId ? { ...c, isPublic: newVal } : c));
                            } catch (err) {
                              showToast("Ошибка обновления доступа", true);
                            }
                          }}
                          className={`w-20 h-10 rounded-2xl relative transition-all shadow-inner ${courses.find(c => c.id === accessCourseId)?.isPublic ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                           <div className={`absolute top-1 w-8 h-8 bg-white rounded-xl shadow-md transition-all ${courses.find(c => c.id === accessCourseId)?.isPublic ? 'left-11' : 'left-1'}`} />
                        </button>
                     </div>

                     <div className="flex items-center justify-between p-8 bg-gray-50 rounded-[32px] border border-gray-100">
                        <div>
                          <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">Скрыт отовсюду</p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Режим черновика</p>
                        </div>
                        <button 
                          onClick={async () => {
                            try {
                              const course = courses.find(c => c.id === accessCourseId);
                              const newVal = !course?.hiddenFromUsers;
                              await contentService.toggleCourseVisibility(accessCourseId!, newVal);
                              onUpdateCourses(courses.map(c => c.id === accessCourseId ? { ...c, hiddenFromUsers: newVal } : c));
                            } catch (err) {
                              showToast("Ошибка при переключении видимости", true);
                            }
                          }}
                          className={`w-20 h-10 rounded-2xl relative transition-all shadow-inner ${courses.find(c => c.id === accessCourseId)?.hiddenFromUsers ? 'bg-red-500' : 'bg-gray-300'}`}
                        >
                           <div className={`absolute top-1 w-8 h-8 bg-white rounded-xl shadow-md transition-all ${courses.find(c => c.id === accessCourseId)?.hiddenFromUsers ? 'left-11' : 'left-1'}`} />
                        </button>
                     </div>
                  </div>

                  <div className="bg-blue-50/50 p-12 rounded-[48px] border border-blue-100/50 flex flex-col items-center justify-center text-center mt-10">
                    <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center shadow-sm mb-6">
                      <Users size={32} className="text-[#002D57] opacity-40" />
                    </div>
                    <p className="font-display font-black uppercase text-sm text-[#002D57] tracking-tighter mb-3">Управление назначениями</p>
                    <p className="text-[10px] text-gray-400 font-bold max-w-sm leading-relaxed uppercase tracking-[0.2em]">
                      ВСЕ ИНСТРУМЕНТЫ НАЗНАЧЕНИЯ (ЛИЧНЫЕ И МАССОВЫЕ) <br/> ТЕПЕРЬ ПЕРЕНЕСЕНЫ В ВКЛАДКЕ «КОМАНДА»
                    </p>
                    <button 
                      onClick={() => {
                        const cid = accessCourseId;
                        setAccessCourseId(null);
                        setActiveTab('team');
                        setTeamTabCourseId(cid || '');
                      }}
                      className="mt-10 px-10 py-5 bg-[#002D57] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#002D57]/90 active:scale-95 transition-all shadow-2xl flex items-center gap-3"
                    >
                      Перейти к назначениям <Shield size={14} className="text-[#00A3FF]" />
                    </button>
                  </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation dialog */}
      <AnimatePresence>
        {pendingAction && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-10">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setPendingAction(null)} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-sm relative z-10 p-10 shadow-2xl"
            >
              <p className="font-display font-black uppercase text-base tracking-tight text-[#002D57] mb-8 leading-tight">{pendingAction.message}</p>
              <div className="flex gap-4">
                <button
                  onClick={() => setPendingAction(null)}
                  className="flex-1 py-4 rounded-2xl bg-gray-100 text-gray-600 font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-all"
                >
                  Отмена
                </button>
                <button
                  onClick={() => { const act = pendingAction!; setPendingAction(null); act.action(); }}
                  className="flex-1 py-4 rounded-2xl bg-red-500 text-white font-black uppercase tracking-widest text-[10px] hover:bg-red-600 transition-all"
                >
                  {pendingAction.confirmLabel || "Подтвердить"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[300] px-8 py-4 rounded-2xl shadow-2xl text-white font-black uppercase tracking-widest text-[10px] whitespace-nowrap ${toast.isError ? 'bg-red-500' : 'bg-[#002D57]'}`}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function CourseCreationForm({ onComplete, courses, initialData, onCancel, showToast: showFormToast }: { onComplete: (c: Course) => void, courses: Course[], initialData?: Course, onCancel?: () => void, showToast: (msg: string, isError?: boolean) => void }) {
  const [step, setStep] = useState<'format'>('format');
  const [isGenerating, setIsGenerating] = useState(false);
  const [courseAddSuccess, setCourseAddSuccess] = useState(false);
  const [thumbnail, setThumbnail] = useState(initialData?.thumbnail || '');

  // Manual fields
  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [category, setCategory] = useState(initialData?.category || 'Общее');
  const [lessons, setLessons] = useState<Lesson[]>(initialData?.lessons || []);
  const [courseType, setCourseType] = useState<'presentation' | 'video' | 'scorm'>(initialData?.type || 'presentation');
  const [fileUrl, setFileUrl] = useState(initialData?.fileUrl || '');
  const [isPublic, setIsPublic] = useState(initialData?.isPublic || false);
  // Per-lesson "new link" input state (keyed by lesson index)
  const [newLessonLinks, setNewLessonLinks] = useState<Record<number, string>>({});

  const handleAddLesson = () => {
    const newLesson: Lesson = {
      id: Math.random().toString(36).substr(2, 9),
      title: 'Новый урок',
      content: '',
      fileUrl: ''
    };
    setLessons([...lessons, newLesson]);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, lessonIdx?: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size (browser side)
    if (file.size > 15 * 1024 * 1024) {
      showFormToast("Файл слишком большой (макс. 15МБ). Для видео используйте YouTube/Vimeo ссылки.", true);
      return;
    }

    // Firestore Doc limit is 1MB. If file is > 1MB, it MUST be hosted externally.
    if (file.size > 700 * 1024) {
      showFormToast(`Файл ${(file.size / 1024).toFixed(0)} КБ превышает лимит Firestore (~1МБ). Рекомендуется ссылка (Google Drive / Bitrix24).`, true);
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      if (lessonIdx !== undefined) {
        setLessons(prev => {
          const n = [...prev];
          const cur = n[lessonIdx];
          const existing = cur.fileUrls?.length ? cur.fileUrls : cur.fileUrl ? [cur.fileUrl] : [];
          n[lessonIdx] = { ...cur, fileUrls: [...existing, url], fileUrl: existing.length === 0 ? url : cur.fileUrl };
          return n;
        });
      } else {
        setFileUrl(url);
      }
    };
    reader.readAsDataURL(file);
  };

  const [extractingIdx, setExtractingIdx] = useState<number | null>(null);
  const [isExtractingCourse, setIsExtractingCourse] = useState(false);
  const [courseAiKnowledge, setCourseAiKnowledge] = useState('');

  const handleExtractCourseKnowledge = async () => {
    if (!fileUrl) {
      showFormToast("Сначала загрузите файл курса или вставьте ссылку.", true);
      return;
    }
    setIsExtractingCourse(true);
    try {
      let base64Content = '';
      let mimeTypeContent = '';

      if (fileUrl.startsWith('data:')) {
        const parts = fileUrl.split(',');
        base64Content = parts[1];
        mimeTypeContent = parts[0].split(':')[1].split(';')[0];
      } else {
        try {
          const response = await axios.post('/api/proxy-fetch', { url: fileUrl });
          base64Content = response.data.base64;
          mimeTypeContent = response.data.contentType || 'application/octet-stream';
        } catch (fetchErr: any) {
          showFormToast("Не удалось загрузить файл по ссылке. Убедитесь, что доступ открыт «Всем, у кого есть ссылка».", true);
          setIsExtractingCourse(false);
          return;
        }
      }

      if (mimeTypeContent.toLowerCase().includes('text/html')) {
        showFormToast("Получена HTML-страница вместо файла. В Google Drive: Файл → Поделиться → Опубликовать в интернете.", true);
        setIsExtractingCourse(false);
        return;
      }

      const extracted = await aiService.extractContentFromMedia(base64Content, mimeTypeContent);
      if (extracted) {
        setCourseAiKnowledge(extracted);
        // Add to first lesson or auto-create a lesson "Материалы курса"
        setLessons(prev => {
          if (prev.length === 0) {
            return [{
              id: 'lesson-1',
              title: 'Материалы курса',
              content: 'Основной материал курса доступен в окне просмотра.',
              fileUrl: fileUrl,
              aiKnowledge: extracted,
            }];
          }
          const n = [...prev];
          n[0] = {
            ...n[0],
            aiKnowledge: (n[0].aiKnowledge ? n[0].aiKnowledge + '\n\n' : '') + extracted,
          };
          return n;
        });
        showFormToast("ИИ изучил файл курса и сохранил данные в базу знаний.");
      } else {
        showFormToast("ИИ не смог извлечь информацию. Попробуйте загрузить PDF напрямую.", true);
      }
    } catch (e: any) {
      console.error("Course extraction failed", e);
      showFormToast("Ошибка при анализе файла: " + (e.message || "Неизвестная ошибка"), true);
    } finally {
      setIsExtractingCourse(false);
    }
  };

  const handleExtractKnowledge = async (idx: number) => {
    if (extractingIdx !== null) return;
    const lesson = lessons[idx];
    // Collect ALL URLs for this lesson
    const urls = (lesson.fileUrls?.filter(u => u?.trim()) || []);
    if (lesson.fileUrl?.trim() && !urls.includes(lesson.fileUrl)) urls.push(lesson.fileUrl);
    if (urls.length === 0) {
      showFormToast("Сначала загрузите файл или укажите ссылку на него.", true);
      return;
    }

    setExtractingIdx(idx);
    const results: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const isVideo = /\.(mp4|webm|avi|mov|mkv|m4v)(\?|$)/i.test(url) ||
        url.match(/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/) !== null;
      const label = urls.length > 1 ? `Файл ${i + 1} из ${urls.length}` : 'Файл';

      if (isVideo) {
        showFormToast(`${label}: загружаю видео в ИИ, это может занять несколько минут…`);
      } else if (urls.length > 1) {
        showFormToast(`Обработка: ${label}…`);
      }

      try {
        let extracted = '';

        if (url.startsWith('data:')) {
          // Inline data URI — existing client-side path
          const parts = url.split(',');
          const b64 = parts[1];
          const mime = parts[0].split(':')[1].split(';')[0];
          extracted = await aiService.extractContentFromMedia(b64, mime) ?? '';
        } else {
          // Remote URL — server-side (stream to Gemini Files API for video, inline for PDF)
          // timeout: 0 = no client-side timeout (large videos can take 20+ min)
          const resp = await axios.post('/api/extract-media-knowledge', { url }, { timeout: 0 });
          extracted = resp.data?.text ?? '';
        }

        if (extracted) results.push(extracted);
      } catch (err: any) {
        const msg = (err.response?.data?.error || err.message || 'Ошибка').substring(0, 120);
        showFormToast(`${label}: ${msg}`, true);
      }
    }

    if (results.length > 0) {
      const combined = results.join('\n\n---\n\n');
      setLessons(prev => {
        const n = [...prev];
        n[idx] = {
          ...n[idx],
          aiKnowledge: (n[idx].aiKnowledge ? n[idx].aiKnowledge + '\n\n' : '') + combined,
        };
        return n;
      });
      showFormToast(
        urls.length > 1
          ? `ИИ обработал ${results.length} из ${urls.length} файлов и сохранил знания.`
          : 'ИИ изучил файл и сохранил данные в базу знаний урока.'
      );
    } else {
      showFormToast('ИИ не смог извлечь информацию ни из одного файла.', true);
    }

    setExtractingIdx(null);
  };

  const handleSaveManual = async () => {
    if (!title) {
      showFormToast("Укажите название курса", true);
      return;
    }
    setIsGenerating(true);
    try {
      let finalLessons = [...lessons];
      if (finalLessons.length === 0 && fileUrl) {
        finalLessons = [{
          id: 'lesson-1',
          title: 'Учебный материал',
          content: 'Основной материал курса доступен в окне просмотра выше.',
          fileUrl: fileUrl
        }];
      }

      const courseData = {
        title,
        description,
        category,
        lessons: finalLessons,
        type: courseType,
        fileUrl,
        isPublic,
        hasSimulator: (initialData?.simulatorMode ?? initialData?.hasSimulator) !== false && (initialData?.simulatorMode ?? 'optional') !== 'off',
        simulatorMode: initialData?.simulatorMode ?? (initialData?.hasSimulator === false ? 'off' : 'optional'),
        simulatorTurns: initialData?.simulatorTurns ?? 3,
        testMode: initialData?.testMode ?? 'final',
        thumbnail: thumbnail || (courseType === 'video' ? 'https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=800' : 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=800'),
        testConfig: initialData?.testConfig || { type: 'none', questions: [] },
        hiddenFromUsers: initialData?.hiddenFromUsers ?? false,
        assignedToUsers: initialData?.assignedToUsers || []
      };

      // Check total payload size (Firestore limit is 1MB per document)
      const dataSize = JSON.stringify(courseData).length;
      if (dataSize > 900000) {
        showFormToast("Размер курса превышает лимит БД (1МБ). Удалите загруженные файлы и используйте ссылки.", true);
        setIsGenerating(false);
        return;
      }

      console.log("Saving course:", courseData);
      let resId = initialData?.id;
      if (initialData?.id) {
        await contentService.updateCourse(initialData.id, courseData);
      } else {
        resId = await contentService.createCourse(courseData);
      }
      
      setCourseAddSuccess(true);
      setTimeout(() => {
        onComplete({ ...courseData, id: resId } as Course);
        setCourseAddSuccess(false);
      }, 1500);
      
    } catch (err: any) {
      console.error("Save failed:", err);
      showFormToast("Ошибка при сохранении: " + (err.message || String(err)), true);
    } finally {
      setIsGenerating(false);
    }
  };


  return (
    <div className="space-y-8 flex flex-col h-full overflow-hidden relative">
      {courseAddSuccess && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-green-500/95 z-[50] flex flex-col items-center justify-center text-white">
           <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-24 h-24 bg-white text-green-500 rounded-full flex items-center justify-center mb-6 shadow-2xl">
              <Check size={48} strokeWidth={4} />
           </motion.div>
           <h3 className="text-2xl font-display font-black uppercase">Курс успешно сохранен</h3>
           <p className="text-sm font-bold opacity-80 mt-2 uppercase tracking-widest">Обновляем список...</p>
        </motion.div>
      )}
      <div className="flex gap-4 shrink-0 px-1">
        <button onClick={() => setStep('format')} className={`flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${step === 'format' ? 'bg-[#002D57] text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}>Загрузить курс</button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 custom-scrollbar">
        {step === 'format' && (
          <div className="space-y-8 pt-4">
            <div className="grid grid-cols-3 gap-4">
               {[
                 { id: 'presentation', label: 'Презентация / Текст', icon: FileText },
                 { id: 'video', label: 'Видео курс', icon: Play },
                 { id: 'scorm', label: 'SCORM / Интерактив', icon: Zap }
               ].map(type => (
                 <button 
                  key={type.id}
                  onClick={() => setCourseType(type.id as any)}
                  className={`p-6 rounded-[32px] border-2 flex flex-col items-center gap-3 transition-all ${courseType === type.id ? 'border-[#002D57] bg-[#002D57]/5' : 'border-gray-100 opacity-40'}`}
                 >
                    <type.icon size={24} className={courseType === type.id ? 'text-[#002D57]' : 'text-gray-400'} />
                    <span className="text-[8px] font-black uppercase tracking-widest text-[#002D57]">{type.label}</span>
                 </button>
               ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Название</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold" placeholder="НАЗВАНИЕ КУРСА" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Категория</label>
                <input value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold" placeholder="КАТЕГОРИЯ" />
              </div>
            </div>

            <div className="flex items-center justify-between p-8 bg-gray-50 rounded-[32px] border border-gray-100">
               <div>
                 <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">Доступ всем</p>
                 <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Курс будет открыт всем сотрудникам автоматически</p>
               </div>
               <button 
                 onClick={() => setIsPublic(!isPublic)}
                 className={`w-20 h-10 rounded-2xl relative transition-all shadow-inner ${isPublic ? 'bg-green-500' : 'bg-gray-300'}`}
               >
                  <div className={`absolute top-1 w-8 h-8 bg-white rounded-xl shadow-md transition-all ${isPublic ? 'left-11' : 'left-1'}`} />
               </button>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Медиа-ресурс курса (PDF, MP4, SCORM или Ссылка)</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative group">
                  <input 
                    type="file" 
                    onChange={(e) => handleFileUpload(e)}
                    className="hidden" 
                    id="course-file-upload" 
                  />
                  <label 
                    htmlFor="course-file-upload"
                    className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-all border-2 border-dashed border-transparent hover:border-[#002D57] h-full"
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-[10px] text-gray-500 uppercase">
                        {fileUrl && fileUrl.startsWith('data:') ? 'Файл готов (локально)' : 'Загрузить файл'}
                      </span>
                      <span className="text-[8px] text-red-500 font-bold uppercase tracking-tighter">Лимит базы: 1МБ / Иначе используйте ссылку</span>
                    </div>
                    <Upload size={16} className="text-gray-400" />
                  </label>
                </div>
                <div className="relative">
                  <input 
                    value={fileUrl && !fileUrl.startsWith('data:') ? fileUrl : ''} 
                    onChange={e => setFileUrl(e.target.value)} 
                    placeholder="ИЛИ ВСТАВЬТЕ ССЫЛКУ (Google Drive, Bitrix24...)" 
                    className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold text-[10px] uppercase placeholder:text-gray-300 h-full border-2 border-transparent focus:border-[#00A3FF] transition-all"
                  />
                </div>
              </div>
              <p className="text-[8px] font-bold text-gray-400 ml-4 leading-relaxed uppercase tracking-tighter">
                * Рекомендуется использовать ссылки для файлов более 1МБ (презентации, длинные видео).
              </p>
              {/* Course-level AI extraction button */}
              {fileUrl && (
                <div className="flex flex-col gap-3 mt-2">
                  <button
                    onClick={handleExtractCourseKnowledge}
                    disabled={isExtractingCourse}
                    className={`flex items-center gap-2 self-end px-6 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all shadow-lg ${
                      isExtractingCourse
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-[#002D57] text-white hover:bg-[#00A3FF] hover:scale-105 active:scale-95'
                    }`}
                  >
                    {isExtractingCourse ? (
                      <div className="w-3 h-3 border-2 border-gray-400/30 border-t-gray-400 rounded-full animate-spin" />
                    ) : (
                      <Zap size={12} fill="currentColor" />
                    )}
                    {isExtractingCourse ? 'АНАЛИЗ ФАЙЛА...' : 'ИЗУЧИТЬ ФАЙЛ КУРСА (ИИ)'}
                  </button>
                  {courseAiKnowledge && (
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#002D57] mb-1">База знаний ИИ сохранена ✓</p>
                      <p className="text-[9px] text-[#002D57]/60 font-medium leading-relaxed line-clamp-2">
                        {courseAiKnowledge.slice(0, 180)}{courseAiKnowledge.length > 180 ? '...' : ''}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Описание</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold min-h-[100px]" placeholder="ОПИСАНИЕ КУРСА" />
            </div>

            {/* ── Обложка курса ─────────────────────────────────────── */}
            <div className="space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4">Обложка курса</label>
              {thumbnail && (
                <div className="relative h-36 rounded-3xl overflow-hidden border border-gray-100">
                  <img src={thumbnail} alt="cover" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setThumbnail('')}
                    className="absolute top-3 right-3 w-8 h-8 bg-white/90 rounded-xl flex items-center justify-center text-red-400 hover:bg-red-500 hover:text-white transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = ev => setThumbnail(ev.target?.result as string);
                      reader.readAsDataURL(file);
                    }}
                    className="hidden"
                    id="cover-upload"
                  />
                  <label
                    htmlFor="cover-upload"
                    className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-all border-2 border-dashed border-transparent hover:border-[#002D57]"
                  >
                    <span className="font-bold text-[10px] text-gray-500 uppercase">Загрузить изображение</span>
                    <Upload size={16} className="text-gray-400" />
                  </label>
                </div>
                <input
                  value={thumbnail && !thumbnail.startsWith('data:') ? thumbnail : ''}
                  onChange={e => setThumbnail(e.target.value)}
                  placeholder="ИЛИ ВСТАВЬТЕ ССЫЛКУ НА ИЗОБРАЖЕНИЕ"
                  className="w-full bg-[#F5F7FA] rounded-2xl px-6 py-4 outline-none font-bold text-[10px] uppercase placeholder:text-gray-300 border-2 border-transparent focus:border-[#00A3FF] transition-all"
                />
              </div>
            </div>

            {courseType === 'presentation' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57]">Список уроков ({lessons.length})</h3>
                  <button onClick={handleAddLesson} className="flex items-center gap-2 px-4 py-2 bg-[#002D57] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#00A3FF] transition-all">
                    <Plus size={14} /> Добавить урок
                  </button>
                </div>
                <div className="space-y-4 pb-4">
                  {lessons.map((lesson, idx) => (
                    <div key={lesson.id} className="bg-gray-50 rounded-3xl p-6 border border-gray-100">
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-4">
                          <span className="w-8 h-8 bg-[#002D57] text-white rounded-lg flex items-center justify-center font-bold text-xs">{idx + 1}</span>
                          <input 
                            value={lesson.title} 
                            onChange={e => {
                              const n = [...lessons];
                              n[idx].title = e.target.value;
                              setLessons(n);
                            }}
                            className="bg-transparent border-none outline-none font-bold text-[#002D57] placeholder:text-gray-300" 
                            placeholder="Заголовок урока"
                          />
                        </div>
                        <button onClick={() => setLessons(lessons.filter(l => l.id !== lesson.id))} className="text-red-400 hover:text-red-600 transition-colors">
                          <X size={18} />
                        </button>
                      </div>
                      
                      <div className="mb-6 p-6 bg-white border border-gray-100 rounded-3xl space-y-4">
                        <label className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">Медиа-контент урока</label>

                        {/* ── List of already added files ── */}
                        {(() => {
                          const urls = lesson.fileUrls?.length
                            ? lesson.fileUrls
                            : lesson.fileUrl ? [lesson.fileUrl] : [];
                          return urls.length > 0 ? (
                            <div className="space-y-2">
                              {urls.map((u, uIdx) => (
                                <div key={uIdx} className="flex items-center gap-2 bg-[#F5F7FA] rounded-2xl px-4 py-2.5">
                                  <LinkIcon size={11} className="text-[#00A3FF] shrink-0" />
                                  <span className="flex-1 text-[9px] font-bold text-[#002D57] truncate">
                                    {u.startsWith('data:') ? `📎 Файл ${uIdx + 1} (загружен)` : u}
                                  </span>
                                  <button
                                    onClick={() => {
                                      const n = [...lessons];
                                      const newUrls = urls.filter((_, i) => i !== uIdx);
                                      n[idx] = { ...n[idx], fileUrls: newUrls, fileUrl: newUrls[0] || '' };
                                      setLessons(n);
                                    }}
                                    className="text-red-400 hover:text-red-600 transition-colors shrink-0"
                                  ><X size={12} /></button>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}

                        {/* ── Add new media ── */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Option A: Link */}
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2 text-[#00A3FF]">
                                <LinkIcon size={12} strokeWidth={3} />
                                <span className="text-[9px] font-black uppercase">Вставить ссылку</span>
                             </div>
                             <div className="flex gap-2">
                               <input
                                  className="flex-1 bg-[#F5F7FA] rounded-2xl px-4 py-3 outline-none text-[10px] font-bold focus:ring-4 focus:ring-[#00A3FF]/10 transition-all"
                                  placeholder="YouTube, Google Drive, Яндекс Диск, PDF..."
                                  value={newLessonLinks[idx] || ''}
                                  onChange={(e) => setNewLessonLinks(p => ({ ...p, [idx]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (newLessonLinks[idx] || '').trim()) {
                                      const link = newLessonLinks[idx].trim();
                                      setLessons(prev => {
                                        const n = [...prev];
                                        const cur = n[idx];
                                        const existing = cur.fileUrls?.length ? cur.fileUrls : cur.fileUrl ? [cur.fileUrl] : [];
                                        n[idx] = { ...cur, fileUrls: [...existing, link], fileUrl: existing.length === 0 ? link : cur.fileUrl };
                                        return n;
                                      });
                                      setNewLessonLinks(p => ({ ...p, [idx]: '' }));
                                    }
                                  }}
                               />
                               <button
                                 onClick={() => {
                                   const link = (newLessonLinks[idx] || '').trim();
                                   if (!link) return;
                                   setLessons(prev => {
                                     const n = [...prev];
                                     const cur = n[idx];
                                     const existing = cur.fileUrls?.length ? cur.fileUrls : cur.fileUrl ? [cur.fileUrl] : [];
                                     n[idx] = { ...cur, fileUrls: [...existing, link], fileUrl: existing.length === 0 ? link : cur.fileUrl };
                                     return n;
                                   });
                                   setNewLessonLinks(p => ({ ...p, [idx]: '' }));
                                 }}
                                 className="px-4 py-3 bg-[#002D57] text-white rounded-2xl text-[10px] font-black hover:bg-[#00A3FF] transition-all shrink-0"
                               >+</button>
                             </div>
                          </div>

                          {/* Option B: Upload */}
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2 text-gray-400">
                                <Upload size={12} strokeWidth={3} />
                                <span className="text-[9px] font-black uppercase">Загрузить файл (Max 1MB)</span>
                             </div>
                             <div className="grid grid-cols-2 gap-2">
                                <div className="relative">
                                  <input
                                    type="file"
                                    id={`lesson-file-${idx}`}
                                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                    onChange={(e) => handleFileUpload(e, idx)}
                                  />
                                  <div className="w-full bg-[#F5F7FA] rounded-2xl px-5 py-3 text-[10px] font-bold text-gray-400 border-2 border-dashed border-gray-200 text-center truncate">
                                    Выбрать файл
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => { e.preventDefault(); handleExtractKnowledge(idx); }}
                                  disabled={!(lesson.fileUrls?.length || lesson.fileUrl) || extractingIdx === idx}
                                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all ${
                                    !(lesson.fileUrls?.length || lesson.fileUrl) ? 'bg-gray-100 text-gray-400 opacity-50 cursor-not-allowed' :
                                    'bg-[#002D57] text-white hover:bg-[#00A3FF] shadow-lg hover:scale-105 active:scale-95'
                                  }`}
                                >
                                  {extractingIdx === idx ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap size={12} fill="currentColor" />}
                                  {extractingIdx === idx ? 'АНАЛИЗ...' : 'ИЗУЧИТЬ ФАЙЛ'}
                                </button>
                             </div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                           <div className="flex items-center gap-2 text-[#002D57]">
                              <FileText size={12} strokeWidth={3} />
                              <span className="text-[9px] font-black uppercase">Текст урока (Видит ученик)</span>
                           </div>
                           <textarea 
                             value={lesson.content}
                             onChange={e => {
                               const n = [...lessons];
                               n[idx].content = e.target.value;
                               setLessons(n);
                             }}
                             className="w-full bg-white rounded-2xl p-4 outline-none text-xs font-medium min-h-[120px] shadow-sm border border-gray-100"
                             placeholder="Markdown контент урока..."
                           />
                        </div>

                        <div className="flex flex-col gap-2 p-4 bg-ibox-blue/5 rounded-2xl border border-ibox-blue/10">
                           <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2 text-ibox-blue">
                                <Zap size={12} fill="currentColor" />
                                <span className="text-[9px] font-black uppercase">База Знаний ИИ (Скрыто от ученика)</span>
                             </div>
                             <div className="flex items-center gap-2">
                               <span className="text-[8px] font-bold text-ibox-blue/40 italic">ИИ использует это для ответов в симуляторе</span>
                             </div>
                           </div>
                           <textarea
                             placeholder="Здесь хранятся извлеченные данные из презентаций/видео..."
                             className="w-full bg-white/50 rounded-xl px-5 py-4 text-xs font-medium text-ibox-blue/80 border-2 border-dotted border-ibox-blue/20 focus:border-ibox-blue outline-none transition-all resize-none min-h-[100px]"
                             value={lesson.aiKnowledge || ''}
                             onChange={(e) => {
                               const n = [...lessons];
                               n[idx].aiKnowledge = e.target.value;
                               setLessons(n);
                             }}
                           />
                        </div>

                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      <div className="pt-6 shrink-0 flex gap-4">
        {onCancel && (
          <button onClick={onCancel} className="flex-1 bg-gray-100 text-gray-500 py-6 rounded-3xl font-display font-black uppercase tracking-widest hover:bg-gray-200 transition-all">Отмена</button>
        )}
        <button
          onClick={handleSaveManual}
          disabled={isGenerating}
          className="flex-1 bg-[#002D57] text-white py-6 rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
        >
          {isGenerating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={18} />}
          {isGenerating ? 'СОХРАНЕНИЕ...' : 'СОХРАНИТЬ КУРС'}
        </button>
      </div>
    </div>
  );
}

function TestEditor({ course, onSave, showToast }: {
  course: Course;
  onSave: (updates: Partial<Course>) => void;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  // Resolve legacy hasSimulator → simulatorMode
  const resolveSimMode = (): 'off' | 'optional' | 'required' => {
    if (course.simulatorMode) return course.simulatorMode;
    return course.hasSimulator === false ? 'off' : 'optional';
  };
  const [simulatorMode, setSimulatorMode] = useState<'off' | 'optional' | 'required'>(resolveSimMode());
  const [simulatorTurns, setSimulatorTurns] = useState<number>(course.simulatorTurns ?? 3);
  const [testMode, setTestMode] = useState<'none' | 'final' | 'per_lesson' | 'both'>(course.testMode || 'final');
  const [questions, setQuestions] = useState<QuizQuestion[]>(course.testConfig?.questions || []);
  const [lessons, setLessons] = useState<Lesson[]>(course.lessons || []);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);

  const addQuestion = () => {
    setQuestions([...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0 }]);
  };

  const addLessonQuestion = (lessonIdx: number) => {
    const n = [...lessons];
    const qs = [...(n[lessonIdx].testConfig?.questions || [])];
    qs.push({ question: '', options: ['', '', '', ''], correctAnswer: 0 });
    n[lessonIdx] = { ...n[lessonIdx], testConfig: { type: 'manual', questions: qs } };
    setLessons(n);
  };

  const handleSave = () => {
    const updates: Partial<Course> = {
      hasSimulator: simulatorMode !== 'off',
      simulatorMode,
      simulatorTurns,
      testMode,
      lessons,
      testConfig: { type: testMode === 'none' ? 'none' : 'manual', questions },
    };
    onSave(updates);
  };

  const showFinalEditor = testMode === 'final' || testMode === 'both';
  const showPerLesson = testMode === 'per_lesson' || testMode === 'both';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-8">

        {/* ── Simulator mode ── */}
        <div className="p-6 bg-gray-50 rounded-[28px] border border-gray-100 space-y-4">
          <div>
            <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">ИИ Тренажер</p>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Симуляция диалога сотрудника с ИИ-наставником</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: 'off',      label: 'Отключён',           desc: 'Тренажёр недоступен' },
              { id: 'optional', label: 'Отдельная вкладка',  desc: 'Доступен по желанию' },
              { id: 'required', label: 'Обязательный',       desc: 'Запускается после теста' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => setSimulatorMode(opt.id)}
                className={`p-4 rounded-2xl text-left border-2 transition-all ${simulatorMode === opt.id ? 'border-[#002D57] bg-[#002D57]/5' : 'border-gray-100 hover:border-gray-300'}`}
              >
                <p className={`text-[10px] font-black uppercase tracking-widest leading-tight ${simulatorMode === opt.id ? 'text-[#002D57]' : 'text-gray-400'}`}>{opt.label}</p>
                <p className="text-[8px] font-bold text-gray-400 mt-1 leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>

          {/* Turn count — only shown when simulator is enabled */}
          {simulatorMode !== 'off' && (
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">Количество ходов</p>
                <p className="text-[8px] font-bold text-gray-400 mt-0.5">Диалогов сотрудника с наставником</p>
              </div>
              <div className="flex items-center gap-2">
                {[2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setSimulatorTurns(n)}
                    className={`w-9 h-9 rounded-xl font-black text-sm transition-all ${simulatorTurns === n ? 'bg-[#002D57] text-white shadow-lg' : 'bg-white border border-gray-200 text-gray-400 hover:border-[#002D57]'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Test mode ── */}
        <div className="p-6 bg-gray-50 rounded-[28px] border border-gray-100 space-y-4">
          <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">Режим тестирования</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { id: 'none', label: 'Без теста', desc: 'Тесты отключены' },
              { id: 'final', label: 'Итоговый тест', desc: 'Один тест в конце курса' },
              { id: 'per_lesson', label: 'После каждого урока', desc: 'Мини-тест после каждого урока' },
              { id: 'both', label: 'Оба варианта', desc: 'После уроков + итоговый' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => setTestMode(opt.id)}
                className={`p-4 rounded-2xl text-left border-2 transition-all ${testMode === opt.id ? 'border-[#002D57] bg-[#002D57]/5' : 'border-gray-100 hover:border-gray-300'}`}
              >
                <p className={`text-[10px] font-black uppercase tracking-widest ${testMode === opt.id ? 'text-[#002D57]' : 'text-gray-400'}`}>{opt.label}</p>
                <p className="text-[8px] font-bold text-gray-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── Per-lesson tests ── */}
        {showPerLesson && (
          <div className="space-y-4">
            <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57]">Тесты после уроков</h3>
            {lessons.map((lesson, lIdx) => (
              <div key={lesson.id} className="border border-gray-200 rounded-[28px] overflow-hidden">
                <button
                  onClick={() => setExpandedLesson(expandedLesson === lIdx ? null : lIdx)}
                  className="w-full flex items-center justify-between px-6 py-4 bg-gray-50 hover:bg-gray-100 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#002D57] text-white rounded-xl flex items-center justify-center font-bold text-xs">{lIdx + 1}</div>
                    <div className="text-left">
                      <p className="text-xs font-black uppercase tracking-tight text-[#002D57]">{lesson.title}</p>
                      <p className="text-[9px] font-bold text-gray-400">
                        {lesson.testConfig?.questions?.length ? `${lesson.testConfig.questions.length} вопр.` : 'Тест не добавлен'}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#00A3FF]">{expandedLesson === lIdx ? '▲' : '▼'}</span>
                </button>
                {expandedLesson === lIdx && (
                  <div className="p-5 space-y-4 bg-white">
                    {(lesson.testConfig?.questions || []).map((q, qIdx) => (
                      <div key={qIdx} className="bg-gray-50 rounded-2xl p-5 relative">
                        <button
                          onClick={() => {
                            const n = [...lessons];
                            const qs = [...(n[lIdx].testConfig?.questions || [])].filter((_, i) => i !== qIdx);
                            n[lIdx] = { ...n[lIdx], testConfig: { type: 'manual', questions: qs } };
                            setLessons(n);
                          }}
                          className="absolute top-4 right-4 text-red-400 hover:text-red-600"
                        ><X size={14} /></button>
                        <input
                          className="w-full bg-white rounded-xl px-4 py-3 outline-none font-bold text-xs mb-4 shadow-sm"
                          placeholder={`Вопрос ${qIdx + 1}`}
                          value={q.question}
                          onChange={e => {
                            const n = [...lessons];
                            const qs = [...(n[lIdx].testConfig?.questions || [])];
                            qs[qIdx] = { ...qs[qIdx], question: e.target.value };
                            n[lIdx] = { ...n[lIdx], testConfig: { type: 'manual', questions: qs } };
                            setLessons(n);
                          }}
                        />
                        <div className="grid grid-cols-2 gap-3">
                          {q.options.map((opt, oIdx) => (
                            <div key={oIdx} className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm">
                              <input
                                type="radio"
                                name={`l${lIdx}-q${qIdx}`}
                                checked={q.correctAnswer === oIdx}
                                onChange={() => {
                                  const n = [...lessons];
                                  const qs = [...(n[lIdx].testConfig?.questions || [])];
                                  qs[qIdx] = { ...qs[qIdx], correctAnswer: oIdx };
                                  n[lIdx] = { ...n[lIdx], testConfig: { type: 'manual', questions: qs } };
                                  setLessons(n);
                                }}
                              />
                              <input
                                className="flex-1 outline-none text-[10px] font-bold"
                                placeholder={`Вариант ${oIdx + 1}`}
                                value={opt}
                                onChange={e => {
                                  const n = [...lessons];
                                  const qs = [...(n[lIdx].testConfig?.questions || [])];
                                  const opts = [...qs[qIdx].options];
                                  opts[oIdx] = e.target.value;
                                  qs[qIdx] = { ...qs[qIdx], options: opts };
                                  n[lIdx] = { ...n[lIdx], testConfig: { type: 'manual', questions: qs } };
                                  setLessons(n);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => addLessonQuestion(lIdx)}
                      className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center gap-2 text-[9px] font-black uppercase text-gray-400 hover:text-[#002D57] hover:border-[#002D57] transition-all"
                    >
                      <Plus size={14} /> Добавить вопрос
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Final test questions ── */}
        {showFinalEditor && (
          <div className="space-y-6">
            <h3 className="text-sm font-display font-black uppercase tracking-widest text-[#002D57]">Итоговый тест</h3>
            {questions.map((q, qIdx) => (
              <div key={qIdx} className="bg-gray-50/50 p-8 rounded-[32px] border border-gray-100 relative">
                <button onClick={() => setQuestions(questions.filter((_, i) => i !== qIdx))} className="absolute top-6 right-6 text-red-500"><X size={18} /></button>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[#002D57] ml-2">Вопрос {qIdx + 1}</label>
                    <input
                      className="w-full bg-white rounded-2xl px-6 py-4 outline-none font-bold shadow-sm"
                      value={q.question}
                      onChange={e => { const n = [...questions]; n[qIdx].question = e.target.value; setQuestions(n); }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-3 bg-white p-4 rounded-2xl shadow-sm">
                        <input
                          type="radio"
                          name={`q-${qIdx}`}
                          checked={q.correctAnswer === oIdx}
                          onChange={() => { const n = [...questions]; n[qIdx].correctAnswer = oIdx; setQuestions(n); }}
                        />
                        <input
                          className="flex-1 outline-none text-xs font-bold"
                          value={opt}
                          onChange={e => { const n = [...questions]; n[qIdx].options[oIdx] = e.target.value; setQuestions(n); }}
                          placeholder={`Вариант ${oIdx + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addQuestion} className="w-full py-6 border-2 border-dashed border-gray-200 rounded-3xl flex items-center justify-center gap-2 text-gray-400 hover:text-[#002D57] hover:border-[#002D57] transition-all font-bold">
              <Plus size={20} /> Добавить вопрос к итоговому тесту
            </button>
          </div>
        )}

      </div>
      <div className="pt-8 shrink-0">
        <button onClick={handleSave} className="w-full bg-[#002D57] text-white py-6 rounded-3xl font-display font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3">
          <Save size={20} /> Сохранить настройки теста
        </button>
      </div>
    </div>
  );
}
