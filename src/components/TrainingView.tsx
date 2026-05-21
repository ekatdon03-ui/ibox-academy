import React, { useState, useEffect } from 'react';
import { Course, UserProfile, UserCourseProgress, CourseResult } from '../types';
import { Play, Trophy, Target, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { contentService } from '../services/contentService';

interface TrainingViewProps {
  courses: Course[];
  user: UserProfile;
  onSelectCourse: (course: Course) => void;
  refreshTrigger?: number;
}

export default function TrainingView({ courses, user, onSelectCourse, refreshTrigger }: TrainingViewProps) {
  const [progressMap, setProgressMap] = useState<Record<string, UserCourseProgress>>({});
  const [results, setResults] = useState<CourseResult[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('Все тематики');
  
  useEffect(() => {
    const loadData = async () => {
      const uResults = await contentService.getAllResults();
      const userResults = uResults.filter(r => r.userId === user.id);
      setResults(userResults);

      const allProgress = await Promise.all(
        courses.map(c => contentService.getCourseProgress(user.id, c.id))
      );
      const map: Record<string, UserCourseProgress> = {};
      allProgress.forEach(p => {
        if (p) map[p.courseId] = p;
      });
      setProgressMap(map);
    };
    if (user.id) loadData();
  }, [courses, user.id, refreshTrigger]);

  const avgScore = results.length > 0 
    ? Math.round(results.reduce((acc, curr) => acc + curr.score, 0) / results.length) 
    : 0;

  const isCourseAccessible = (course: Course) => {
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (course.isPublic) return true;
    if ((user.assignedCourses || []).includes(course.id)) return true;
    if ((course.assignedToUsers || []).includes(user.id)) return true;
    if (user.department && (course.assignedToDepartments || []).includes(user.department)) return true;
    return false;
  };

  const isCourseAssigned = (course: Course) => {
    const isAssignedOnUser = (user.assignedCourses || []).includes(course.id);
    const isUserInCourseAssignedList = (course.assignedToUsers || []).includes(user.id);
    const isAssignedViaDept = !!user.department && (course.assignedToDepartments || []).includes(user.department);
    return isAssignedOnUser || isUserInCourseAssignedList || isAssignedViaDept;
  };

  const assignedCourses = courses.filter(c => !c.hiddenFromUsers && isCourseAssigned(c));
  const otherCourses = courses.filter(c => {
    if (c.hiddenFromUsers) return false;
    if (isCourseAssigned(c)) return false;
    if (!isCourseAccessible(c)) return false;
    if (selectedCategory !== 'Все тематики' && c.category !== selectedCategory) return false;
    return true;
  });

  const categories = ['Все тематики', ...new Set(courses.map(c => c.category).filter(Boolean))];

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-[#F5F7FA]">
      <div className="max-w-7xl mx-auto space-y-16">
        
        {/* Achievements Section */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <Trophy className="text-[#00A3FF]" size={24} />
            <h2 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Достижения</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex items-center gap-6">
                <div className="w-16 h-16 bg-[#00A3FF]/10 rounded-3xl flex items-center justify-center text-[#00A3FF]">
                   <Star size={28} />
                </div>
                <div>
                   <p className="text-3xl font-display font-black text-[#002D57]">{results.length}</p>
                   <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Курсов пройдено</p>
                </div>
             </div>
             <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex items-center gap-6">
                <div className="w-16 h-16 bg-green-500/10 rounded-3xl flex items-center justify-center text-green-500">
                   <Target size={28} />
                </div>
                <div>
                   <p className="text-3xl font-display font-black text-[#002D57]">{avgScore}%</p>
                   <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Средний балл</p>
                </div>
             </div>
          </div>
        </section>

        {/* My Tasks (Assigned) */}
        {assignedCourses.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-8">
              <Target className="text-[#002D57]" size={24} />
              <h2 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Назначенные курсы</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {assignedCourses.map((course, idx) => (
                <CourseCard 
                  key={course.id} 
                  course={course} 
                  idx={idx} 
                  onSelect={onSelectCourse} 
                  isTask 
                  progress={progressMap[course.id]}
                />
              ))}
            </div>
          </section>
        )}

        {/* All Courses */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Play className="text-[#002D57]" size={24} />
              <h2 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Каталог курсов</h2>
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-w-lg">
               {categories.map(cat => (
                  <button 
                   key={cat}
                   onClick={() => setSelectedCategory(cat)}
                   className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all whitespace-nowrap active:scale-95 ${cat === selectedCategory ? 'bg-[#00A3FF] text-white shadow-[0_10px_20px_-10px_rgba(0,163,255,0.4)]' : 'bg-white text-gray-400 hover:text-[#002D57] border border-gray-100'}`}
                  >
                   {cat}
                 </button>
               ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {otherCourses.map((course, idx) => (
              <CourseCard 
                key={course.id} 
                course={course} 
                idx={idx} 
                onSelect={onSelectCourse} 
                progress={progressMap[course.id]}
              />
            ))}
            {otherCourses.length === 0 && (
              <div className="col-span-full py-20 bg-white rounded-[48px] border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 italic">
                <Play size={40} className="mb-4 opacity-10" />
                <p className="font-display font-black text-xs uppercase tracking-widest">Курсы по данной тематике не найдены</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

function CourseCard({ course, idx, onSelect, isTask, progress }: { course: Course, idx: number, onSelect: (c: Course) => void, isTask?: boolean, progress?: UserCourseProgress }) {
  const isCompleted = progress?.status === 'completed';
  const progressValue = progress?.overallProgress || 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.1 }}
      className={`group bg-white p-6 rounded-[48px] flex flex-col border border-gray-100 shadow-sm hover:shadow-2xl transition-all cursor-pointer relative overflow-hidden ${isTask ? 'ring-2 ring-red-500/20' : ''}`}
      onClick={() => onSelect(course)}
    >
      {isTask && (
        <div className="absolute top-8 left-8 z-10">
           <span className="bg-[#002D57] text-white px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest shadow-lg">Назначено</span>
        </div>
      )}
      <div className="h-48 bg-gray-50 rounded-[32px] mb-8 relative overflow-hidden">
        <img 
          src={course.thumbnail} 
          alt={course.title} 
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-[#002D57]/5 group-hover:bg-[#002D57]/10 transition-colors" />
        <div className="absolute top-4 right-4">
          <span className="bg-white/90 backdrop-blur-md text-[#002D57] px-4 py-2 rounded-2xl text-[8px] font-black uppercase tracking-widest shadow-sm">
            {course.category}
          </span>
        </div>
      </div>
      
      <div className="flex-1 flex flex-col px-4">
        <h3 className="text-2xl font-display font-black uppercase mb-3 leading-tight group-hover:text-[#00A3FF] transition-colors">{course.title}</h3>
        <p className="text-gray-400 text-xs font-semibold mb-8 line-clamp-2 leading-relaxed">
          {course.description}
        </p>
        
        <div className="mt-auto">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest mb-3">
            <span className="text-gray-300">Статус</span>
            <span className={isCompleted ? 'text-green-500' : (progress?.status === 'in-progress' ? 'text-[#00A3FF]' : 'text-gray-400')}>
              {isCompleted ? 'Завершено' : (progress?.status === 'in-progress' ? `В процессе ${progressValue}%` : 'Не начато')}
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-50 rounded-full overflow-hidden mb-8">
            <div 
              className={`h-full rounded-full transition-all duration-1000 ${isCompleted ? 'bg-green-500' : 'bg-[#00A3FF]'}`} 
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <button className="w-full py-5 bg-[#F5F7FA] text-[#002D57] font-black uppercase text-[10px] tracking-widest rounded-3xl group-hover:bg-[#002D57] group-hover:text-white transition-all flex items-center justify-center gap-3">
            <Play size={14} fill="currentColor" />
            {progressValue > 0 ? 'Продолжить обучение' : 'Начать обучение'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
