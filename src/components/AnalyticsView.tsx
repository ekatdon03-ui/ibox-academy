import React, { useState, useEffect } from 'react';
import { BarChart3, Users, Clock, Award, ChevronRight, TrendingUp, Filter, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';
import { UserProfile, CourseResult, Course } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';

interface AnalyticsViewProps {
  results: CourseResult[];
  courses: Course[];
  currentUser: UserProfile;
  employees: UserProfile[];
}

export default function AnalyticsView({ results: initialResults, courses, currentUser, employees: initialEmployees }: AnalyticsViewProps) {
  const [employees, setEmployees] = useState<UserProfile[]>(initialEmployees);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState<string>(currentUser.role === 'manager' ? (currentUser.department || 'Все отделы') : 'Все отделы');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const departments = React.useMemo(() => {
    return currentUser.role === 'manager' 
      ? [currentUser.department].filter(Boolean) as string[]
      : ['Все отделы', ...new Set(employees.map(e => e.department || '').filter(Boolean))];
  }, [employees, currentUser]);

  const [period, setPeriod] = useState<'7' | '30' | '90'>('7');

  useEffect(() => {
    const load = async () => {
      const users = await contentService.getAllUsers();
      const allResults = await contentService.getAllResults();
      
      setEmployees(users);
      setResults(allResults);
      
      const days = parseInt(period);
      const now = new Date();
      const labels = Array.from({ length: days }, (_, i) => {
        const d = new Date();
        d.setDate(now.getDate() - (days - 1 - i));
        return d.toLocaleDateString();
      });

      const dynamicActivity = labels.map(date => {
        const count = allResults.filter(r => new Date(r.timestamp).toLocaleDateString() === date).length;
        return {
          day: date.split('.')[0] + '/' + date.split('.')[1],
          value: count || 0
        };
      });
      setChartData(dynamicActivity);
      setActivityData(dynamicActivity);

      setLoading(false);
    };
    load();
  }, [currentUser, period]);

  const [chartData, setChartData] = useState<{day: string, value: number}[]>([]);
  const [activityData, setActivityData] = useState<{day: string, value: number}[]>([]);

  const filteredEmployees = employees.filter(u => {
    if (currentUser.role === 'manager') return u.department === currentUser.department;
    return selectedDept === 'Все отделы' || u.department === selectedDept;
  });

  const departmentResults = results.filter(r => filteredEmployees.some(e => e.id === r.userId));
  const avgScore = departmentResults.length > 0 
    ? Math.round(departmentResults.reduce((acc, curr) => acc + (curr.score || 0), 0) / departmentResults.length) 
    : 0;

  const handleExport = () => {
    // UTF-8 BOM for Excel matching Russian encoding
    const BOM = "\uFEFF";
    const headers = [
      'ФИО', 
      'Должность', 
      'Отдел', 
      'Назначено курсов', 
      'Пройдено курсов', 
      'Прогресс %',
      'Средний балл теста', 
      'Баллы XP (Всего)', 
      'Детализация по курсам (Название: Балл | Дата)'
    ];

    const rows = filteredEmployees.map(emp => {
      const empResults = results.filter(r => r.userId === emp.id);
      const assigned = emp.assignedCourses || [];
      const completedCount = assigned.filter(cid => empResults.some(r => r.courseId === cid)).length;
      
      const empAvg = empResults.length > 0 
        ? Math.round(empResults.reduce((acc, curr) => acc + (curr.score || 0), 0) / empResults.length) 
        : 0;
      
      const progress = assigned.length > 0 ? Math.round((completedCount / assigned.length) * 100) : 0;
      
      const courseDetails = empResults.map(r => {
        const course = courses.find(c => c.id === r.courseId);
        const date = new Date(r.timestamp).toLocaleDateString('ru-RU');
        return `${course ? course.title : 'Курс удален'}: ${r.score}% | ${date}`;
      }).join('; ');

      return [
        `"${emp.name}"`,
        `"${emp.position}"`,
        `"${emp.department}"`,
        assigned.length,
        completedCount,
        `${progress}%`,
        `${empAvg}%`,
        emp.score,
        `"${courseDetails}"`
      ].join(";");
    });

    const csvContent = BOM + [headers.join(";"), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `academy_full_report_${selectedDept}_${new Date().toLocaleDateString('ru-RU')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return null;

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-[#F5F7FA]">
      <div className="max-w-7xl mx-auto">
        <header className="mb-16 flex items-center justify-between">
          <div>
            <h1 className="text-5xl font-display font-black uppercase tracking-tight text-[#002D57] leading-none">Аналитика обучения</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-4">Дашборд эффективности сотрудников iBOX</p>
          </div>
          <div className="flex gap-4 relative">
            <button onClick={handleExport} className="flex items-center gap-3 px-8 py-4 bg-white rounded-2xl border border-gray-100 font-display font-black text-[10px] uppercase tracking-widest text-[#002D57] shadow-sm hover:shadow-xl transition-all">
              <Download size={16} />
              Экспорт отчета
            </button>
            <div className="relative">
              <button 
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="flex items-center gap-3 px-8 py-4 bg-[#002D57] rounded-2xl font-display font-black text-[10px] uppercase tracking-widest text-white shadow-xl hover:bg-[#00A3FF] transition-all"
              >
                <Filter size={16} />
                {selectedDept}
              </button>
              <AnimatePresence>
                {isFilterOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-4 bg-white rounded-3xl shadow-2xl border border-gray-100 py-4 min-w-[200px] z-20"
                  >
                    {departments.map(dept => (
                      <button 
                        key={dept}
                        onClick={() => { setSelectedDept(dept); setIsFilterOpen(false); }}
                        className="w-full text-left px-8 py-4 text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all text-[#002D57]"
                      >
                        {dept}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {[
            { label: 'Сотрудников', value: filteredEmployees.length, icon: Users, color: 'text-[#00A3FF]', bg: 'bg-[#00A3FF]/5' },
            { label: 'Курсов пройдено (раз)', value: departmentResults.length, icon: Award, color: 'text-green-500', bg: 'bg-green-50' },
            { 
              label: 'Прогресс по задачам', 
              value: (() => {
                const totalAssigned = filteredEmployees.reduce((sum, e) => sum + (e.assignedCourses?.length || 0), 0);
                const completedAssigned = filteredEmployees.reduce((sum, e) => {
                  const userResults = departmentResults.filter(r => r.userId === e.id);
                  const uniqueCompleted = new Set(userResults.map(r => r.courseId));
                  const intersection = (e.assignedCourses || []).filter(id => uniqueCompleted.has(id));
                  return sum + intersection.length;
                }, 0);
                return totalAssigned > 0 ? `${Math.round((completedAssigned / totalAssigned) * 100)}%` : '0%';
              })(), 
              icon: TrendingUp, color: 'text-orange-500', bg: 'bg-orange-50' 
            },
            { label: 'Ср. балл теста', value: `${avgScore}%`, icon: BarChart3, color: 'text-[#002D57]', bg: 'bg-gray-100' },
          ].map((stat, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="bg-white p-10 rounded-[48px] border border-gray-100 shadow-sm flex items-center gap-8"
            >
              <div className={`w-16 h-16 ${stat.bg} ${stat.color} rounded-3xl flex items-center justify-center`}>
                <stat.icon size={28} />
              </div>
              <div>
                <p className="text-3xl font-display font-black text-[#002D57]">{stat.value}</p>
                <p className="text-[10px] uppercase font-black text-gray-300 tracking-widest mt-1">{stat.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            <div className="lg:col-span-2 bg-white rounded-[64px] border border-gray-100 shadow-sm p-12">
              <div className="flex items-center justify-between mb-12">
                 <h3 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Динамика прохождений</h3>
                 <div className="flex gap-2">
                    {[
                      { l: 'Неделя', v: '7' },
                      { l: 'Месяц', v: '30' },
                      { l: 'Квартал', v: '90' }
                    ].map(p => (
                      <button 
                        key={p.v}
                        onClick={() => setPeriod(p.v as any)}
                        className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${period === p.v ? 'bg-[#002D57] text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                      >
                        {p.l}
                      </button>
                    ))}
                 </div>
              </div>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00A3FF" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#00A3FF" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F1F1" />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700, fill: '#D1D1D1'}} />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', padding: '20px' }}
                      itemStyle={{ fontWeight: 800, textTransform: 'uppercase', fontSize: '10px' }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#00A3FF" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#002D57] rounded-[64px] p-12 text-white relative overflow-hidden flex flex-col justify-between">
               <div className="relative z-10">
                 <h3 className="text-2xl font-display font-black uppercase tracking-tight mb-4">Топ сотрудники</h3>
                 <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00A3FF]">Рейтинг по баллам</p>
               </div>
               <div className="relative z-10 space-y-6 mt-12">
                  {[...employees].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4).map((emp, i) => (
                    <div key={emp.id} className="flex items-center justify-between">
                       <div className="flex items-center gap-4">
                          <span className="text-xs font-black text-white/20">#{i+1}</span>
                          <span className="text-sm font-bold uppercase tracking-tight">{emp.name}</span>
                       </div>
                       <span className="text-[#00A3FF] font-display font-black">{emp.score}</span>
                    </div>
                  ))}
               </div>
               <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3FF]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
            </div>
        </div>

        <div className="bg-white rounded-[64px] border border-gray-100 shadow-sm overflow-hidden p-12">
          <div className="flex items-center justify-between mb-10">
             <h3 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Список сотрудников</h3>
             <span className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] bg-[#00A3FF]/5 px-6 py-3 rounded-2xl border border-[#00A3FF]/10">Все отделы</span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-[#002D57]/5">
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em]">Сотрудник</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em]">Должность</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-center">Прогресс</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-center">Ср. Тест</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-right">Эффективность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredEmployees.map((emp) => {
                const empResults = results.filter(r => r.userId === emp.id);
                // "Assigned" includes both user.assignedCourses and course.assignedToUsers
                // But for simplicity of management, we usually look at emp.assignedCourses
                // The user request: "сколько курсов из назначенных пройдено"
                const assigned = emp.assignedCourses || [];
                const completedAssigned = assigned.filter(cid => empResults.some(r => r.courseId === cid && r.progress === 100));
                
                const empAvg = empResults.length > 0 
                  ? Math.round(empResults.reduce((acc, curr) => acc + (curr.score || 0), 0) / empResults.length) 
                  : 0;
                
                const progressText = assigned.length > 0 
                  ? `${completedAssigned.length}/${assigned.length}` 
                  : "Не назначено";
                
                const progressPercent = assigned.length > 0 
                  ? Math.round((completedAssigned.length / assigned.length) * 100)
                  : 0;
                
                return (
                  <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-8">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 font-display font-black text-xs">
                          {emp.name?.split(' ').map(n => n[0] || '').join('') || '?'}
                        </div>
                        <div>
                          <span className="font-display font-black uppercase text-sm tracking-tight text-[#002D57] block">{emp.name}</span>
                          <span className="text-[8px] font-bold text-gray-300 uppercase tracking-widest">{emp.department}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-8 text-xs font-bold text-gray-400 tracking-tight">{emp.position}</td>
                    <td className="py-8 text-center">
                       <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-xl">
                          <span className="text-sm font-black text-[#002D57]">
                             {progressText}
                          </span>
                       </div>
                    </td>
                    <td className="py-8 text-center">
                      <span className={`font-display font-black text-lg ${empAvg > 80 ? 'text-green-500' : empAvg > 50 ? 'text-orange-500' : 'text-gray-300'}`}>
                        {empAvg}%
                      </span>
                    </td>
                    <td className="py-8 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="w-24 h-1.5 bg-gray-50 rounded-full overflow-hidden">
                           <div 
                             className="h-full bg-[#00A3FF] rounded-full" 
                             style={{ width: `${progressPercent}%` }} 
                           />
                        </div>
                        <span className="text-[8px] font-black uppercase text-gray-300 tracking-widest">{emp.score} XP</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
