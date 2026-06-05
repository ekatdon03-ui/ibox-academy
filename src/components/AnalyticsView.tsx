import React, { useState, useEffect } from 'react';
import { BarChart3, Users, Award, TrendingUp, Filter, Download, BookOpen, ChevronLeft, CheckCircle, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';
import { bitrixService } from '../services/bitrixService';
import { UserProfile, CourseResult, Course } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface AnalyticsViewProps {
  results: CourseResult[];
  courses: Course[];
  currentUser: UserProfile;
  employees: UserProfile[];
}

export default function AnalyticsView({ results: _initialResults, courses, currentUser, employees: initialEmployees }: AnalyticsViewProps) {
  const [employees, setEmployees] = useState<UserProfile[]>(initialEmployees);
  const [results, setResults] = useState<CourseResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState<string>(
    currentUser.role === 'manager' ? (currentUser.department || 'Все отделы') : 'Все отделы'
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [bitrixDepts, setBitrixDepts] = useState<string[]>([]);
  const [period, setPeriod] = useState<'7' | '30' | '90'>('7');

  // Course drill-down
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const [chartData, setChartData] = useState<{ day: string; value: number }[]>([]);

  useEffect(() => {
    if (bitrixService.isAvailable()) {
      bitrixService.getDepartments()
        .then(depts => setBitrixDepts(depts.map(d => d.NAME).filter(Boolean)))
        .catch(() => {});
    }
  }, []);

  const departments = React.useMemo(() => {
    if (currentUser.role === 'manager') return [currentUser.department].filter(Boolean) as string[];
    const fromUsers = employees.map(e => e.department || '').filter(Boolean);
    const sources = bitrixDepts.length > 0 ? bitrixDepts : fromUsers;
    return ['Все отделы', ...new Set(sources)];
  }, [employees, currentUser, bitrixDepts]);

  useEffect(() => {
    const load = async () => {
      const [users, allResults] = await Promise.all([
        contentService.getAllUsers(),
        contentService.getAllResults(),
      ]);
      setEmployees(users);
      setResults(allResults);

      const days = parseInt(period);
      const now = new Date();
      const labels = Array.from({ length: days }, (_, i) => {
        const d = new Date();
        d.setDate(now.getDate() - (days - 1 - i));
        return d.toLocaleDateString();
      });
      setChartData(labels.map(date => ({
        day: date.split('.')[0] + '/' + date.split('.')[1],
        value: allResults.filter(r => new Date(r.timestamp).toLocaleDateString() === date).length || 0
      })));
      setLoading(false);
    };
    load();
  }, [period]);

  const filteredEmployees = employees.filter(u => {
    if (currentUser.role === 'manager') return u.department === currentUser.department;
    return selectedDept === 'Все отделы' || u.department === selectedDept;
  });

  const departmentResults = results.filter(r => filteredEmployees.some(e => e.id === r.userId));
  const avgScore = departmentResults.length > 0
    ? Math.round(departmentResults.reduce((acc, r) => acc + (r.score || 0), 0) / departmentResults.length)
    : 0;

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const BOM = '﻿';
    const headers = ['ФИО', 'Должность', 'Отдел', 'Назначено курсов', 'Пройдено курсов', 'Прогресс %', 'Средний балл теста', 'Детализация по курсам'];
    const rows = filteredEmployees.map(emp => {
      const empResults = results.filter(r => r.userId === emp.id);
      const assigned = emp.assignedCourses || [];
      const completedCount = assigned.filter(cid => empResults.some(r => r.courseId === cid)).length;
      const empAvg = empResults.length > 0
        ? Math.round(empResults.reduce((acc, r) => acc + (r.score || 0), 0) / empResults.length) : 0;
      const progress = assigned.length > 0 ? Math.round((completedCount / assigned.length) * 100) : 0;
      const details = empResults.map(r => {
        const c = courses.find(x => x.id === r.courseId);
        return `${c?.title || 'Курс удален'}: ${r.score}% | ${new Date(r.timestamp).toLocaleDateString('ru-RU')}`;
      }).join('; ');
      return [`"${emp.name}"`, `"${emp.position}"`, `"${emp.department}"`, assigned.length, completedCount, `${progress}%`, `${empAvg}%`, `"${details}"`].join(';');
    });
    const csv = BOM + [headers.join(';'), ...rows].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `academy_report_${selectedDept}_${new Date().toLocaleDateString('ru-RU')}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return null;

  // ── Course drill-down view ────────────────────────────────────────────────
  const selectedCourse = courses.find(c => c.id === selectedCourseId);
  if (selectedCourse && selectedCourseId) {
    const courseResults = results.filter(r => r.courseId === selectedCourseId && filteredEmployees.some(e => e.id === r.userId));
    const enrolled = filteredEmployees.filter(e =>
      (e.assignedCourses || []).includes(selectedCourseId) ||
      courseResults.some(r => r.userId === e.id)
    );
    const passed = courseResults.filter(r => r.score >= 80);
    const failed = courseResults.filter(r => r.score < 80 && r.score > 0);
    const notStarted = enrolled.filter(e => !courseResults.some(r => r.userId === e.id));
    const courseAvg = courseResults.length > 0
      ? Math.round(courseResults.reduce((s, r) => s + (r.score || 0), 0) / courseResults.length) : 0;

    // Score distribution buckets
    const buckets = [
      { label: '0–20', min: 0, max: 20 },
      { label: '21–40', min: 21, max: 40 },
      { label: '41–60', min: 41, max: 60 },
      { label: '61–79', min: 61, max: 79 },
      { label: '80–100', min: 80, max: 100 },
    ];
    const scoreDistribution = buckets.map(b => ({
      range: b.label,
      count: courseResults.filter(r => r.score >= b.min && r.score <= b.max).length,
      pass: b.min >= 80,
    }));

    return (
      <div className="flex-1 overflow-y-auto p-10 bg-[#F5F7FA]">
        <div className="max-w-7xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => setSelectedCourseId(null)}
            className="flex items-center gap-2 text-[#002D57] font-black uppercase text-[10px] tracking-widest mb-8 hover:text-[#00A3FF] transition-all"
          >
            <ChevronLeft size={16} /> Назад к общей аналитике
          </button>

          <header className="mb-12 flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mb-2">{selectedCourse.category}</p>
              <h1 className="text-4xl font-display font-black uppercase tracking-tight text-[#002D57] leading-tight max-w-2xl">
                {selectedCourse.title}
              </h1>
            </div>
            <div className={`px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest ${courseAvg >= 80 ? 'bg-green-50 text-green-600' : courseAvg >= 60 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-600'}`}>
              Ср. балл: {courseAvg}%
            </div>
          </header>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
            {[
              { label: 'Назначено / охвачено', value: enrolled.length, icon: Users, color: 'text-[#00A3FF]', bg: 'bg-[#00A3FF]/5' },
              { label: 'Сдали (≥80%)', value: passed.length, icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
              { label: 'Не сдали (<80%)', value: failed.length, icon: XCircle, color: 'text-red-400', bg: 'bg-red-50' },
              { label: 'Не начали', value: notStarted.length, icon: BookOpen, color: 'text-gray-400', bg: 'bg-gray-50' },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex items-center gap-6">
                <div className={`w-12 h-12 ${s.bg} ${s.color} rounded-2xl flex items-center justify-center`}>
                  <s.icon size={22} />
                </div>
                <div>
                  <p className="text-3xl font-display font-black text-[#002D57]">{s.value}</p>
                  <p className="text-[9px] uppercase font-black text-gray-300 tracking-widest mt-0.5">{s.label}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-10">
            {/* Score distribution chart */}
            <div className="lg:col-span-2 bg-white rounded-[48px] border border-gray-100 p-10">
              <h3 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57] mb-8">
                Распределение баллов
              </h3>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreDistribution} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F1F1" />
                    <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#9CA3AF' }} />
                    <YAxis hide allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', padding: '12px 16px' }}
                      formatter={(val: any) => [`${val} чел.`, 'Сотрудников']}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]}
                      fill="#002D57"
                      label={{ position: 'top', fontSize: 11, fontWeight: 800, fill: '#6B7280' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Pass rate bar */}
              <div className="mt-6 flex items-center gap-4">
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 shrink-0">Прохождение</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${enrolled.length > 0 ? Math.round((passed.length / enrolled.length) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-sm font-black text-[#002D57] shrink-0">
                  {enrolled.length > 0 ? Math.round((passed.length / enrolled.length) * 100) : 0}%
                </span>
              </div>
            </div>

            {/* Quick summary */}
            <div className="bg-[#002D57] rounded-[48px] p-10 text-white flex flex-col justify-between">
              <div>
                <h3 className="text-xl font-display font-black uppercase tracking-tight mb-2">Итого по курсу</h3>
                <p className="text-[10px] text-[#00A3FF] font-bold uppercase tracking-widest">Результаты тестирования</p>
              </div>
              <div className="space-y-4 mt-8">
                <div className="flex justify-between items-center py-3 border-b border-white/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Всего попыток</span>
                  <span className="font-display font-black text-lg">{courseResults.length}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-white/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Лучший балл</span>
                  <span className="font-display font-black text-lg text-[#00A3FF]">
                    {courseResults.length > 0 ? Math.max(...courseResults.map(r => r.score)) : 0}%
                  </span>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Средний балл</span>
                  <span className="font-display font-black text-lg">{courseAvg}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Employee results table */}
          <div className="bg-white rounded-[48px] border border-gray-100 shadow-sm overflow-hidden p-10">
            <h3 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57] mb-8">Сотрудники</h3>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b-2 border-[#002D57]/5">
                  <th className="pb-6 text-[10px] uppercase font-black text-[#002D57] tracking-widest">Сотрудник</th>
                  <th className="pb-6 text-[10px] uppercase font-black text-[#002D57] tracking-widest">Отдел</th>
                  <th className="pb-6 text-[10px] uppercase font-black text-[#002D57] tracking-widest text-center">Статус</th>
                  <th className="pb-6 text-[10px] uppercase font-black text-[#002D57] tracking-widest text-center">Балл</th>
                  <th className="pb-6 text-[10px] uppercase font-black text-[#002D57] tracking-widest text-right">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {enrolled.map(emp => {
                  const res = courseResults.find(r => r.userId === emp.id);
                  return (
                    <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center font-display font-black text-xs text-gray-400">
                            {emp.name?.split(' ').map(n => n[0] || '').slice(0, 2).join('') || '?'}
                          </div>
                          <span className="font-display font-black uppercase text-sm tracking-tight text-[#002D57]">{emp.name}</span>
                        </div>
                      </td>
                      <td className="py-6 text-xs font-bold text-gray-400">{emp.department}</td>
                      <td className="py-6 text-center">
                        {!res ? (
                          <span className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-400 text-[9px] font-black uppercase tracking-widest">Не начал</span>
                        ) : res.score >= 80 ? (
                          <span className="px-3 py-1.5 rounded-xl bg-green-50 text-green-600 text-[9px] font-black uppercase tracking-widest">Сдал</span>
                        ) : (
                          <span className="px-3 py-1.5 rounded-xl bg-red-50 text-red-500 text-[9px] font-black uppercase tracking-widest">Не сдал</span>
                        )}
                      </td>
                      <td className="py-6 text-center">
                        <span className={`font-display font-black text-lg ${!res ? 'text-gray-300' : res.score >= 80 ? 'text-green-500' : 'text-red-400'}`}>
                          {res ? `${res.score}%` : '—'}
                        </span>
                      </td>
                      <td className="py-6 text-right text-[10px] font-bold text-gray-400">
                        {res ? new Date(res.timestamp).toLocaleDateString('ru-RU') : '—'}
                      </td>
                    </tr>
                  );
                })}
                {enrolled.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-400 font-bold text-sm">Нет данных по этому курсу</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── General analytics view ────────────────────────────────────────────────
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
              <Download size={16} /> Экспорт
            </button>
            <div className="relative">
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="flex items-center gap-3 px-8 py-4 bg-[#002D57] rounded-2xl font-display font-black text-[10px] uppercase tracking-widest text-white shadow-xl hover:bg-[#00A3FF] transition-all"
              >
                <Filter size={16} /> {selectedDept}
              </button>
              <AnimatePresence>
                {isFilterOpen && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-4 bg-white rounded-3xl shadow-2xl border border-gray-100 py-4 min-w-[200px] z-20">
                    {departments.map(dept => (
                      <button key={dept} onClick={() => { setSelectedDept(dept); setIsFilterOpen(false); }}
                        className="w-full text-left px-8 py-4 text-[10px] font-black uppercase tracking-widest hover:bg-gray-50 transition-all text-[#002D57]">
                        {dept}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {[
            { label: 'Сотрудников', value: filteredEmployees.length, icon: Users, color: 'text-[#00A3FF]', bg: 'bg-[#00A3FF]/5' },
            { label: 'Курсов пройдено', value: departmentResults.length, icon: Award, color: 'text-green-500', bg: 'bg-green-50' },
            {
              label: 'Прогресс по задачам',
              value: (() => {
                const totalAssigned = filteredEmployees.reduce((sum, e) => sum + (e.assignedCourses?.length || 0), 0);
                const completedAssigned = filteredEmployees.reduce((sum, e) => {
                  const empResults = departmentResults.filter(r => r.userId === e.id);
                  const completed = new Set(empResults.map(r => r.courseId));
                  return sum + (e.assignedCourses || []).filter(id => completed.has(id)).length;
                }, 0);
                return totalAssigned > 0 ? `${Math.round((completedAssigned / totalAssigned) * 100)}%` : '0%';
              })(),
              icon: TrendingUp, color: 'text-orange-500', bg: 'bg-orange-50'
            },
            { label: 'Ср. балл теста', value: `${avgScore}%`, icon: BarChart3, color: 'text-[#002D57]', bg: 'bg-gray-100' },
          ].map((stat, idx) => (
            <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}
              className="bg-white p-10 rounded-[48px] border border-gray-100 shadow-sm flex items-center gap-8">
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
          {/* Activity chart */}
          <div className="lg:col-span-2 bg-white rounded-[64px] border border-gray-100 shadow-sm p-12">
            <div className="flex items-center justify-between mb-12">
              <h3 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Динамика прохождений</h3>
              <div className="flex gap-2">
                {[{ l: 'Неделя', v: '7' }, { l: 'Месяц', v: '30' }, { l: 'Квартал', v: '90' }].map(p => (
                  <button key={p.v} onClick={() => setPeriod(p.v as any)}
                    className={`px-4 py-2 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${period === p.v ? 'bg-[#002D57] text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00A3FF" stopOpacity={0.1} />
                      <stop offset="95%" stopColor="#00A3FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F1F1" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#D1D1D1' }} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', padding: '20px' }}
                    itemStyle={{ fontWeight: 800, textTransform: 'uppercase', fontSize: '10px' }} />
                  <Area type="monotone" dataKey="value" stroke="#00A3FF" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top employees */}
          <div className="bg-[#002D57] rounded-[64px] p-12 text-white relative overflow-hidden flex flex-col justify-between">
            <div className="relative z-10">
              <h3 className="text-2xl font-display font-black uppercase tracking-tight mb-2">Топ сотрудники</h3>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00A3FF]">По числу курсов</p>
            </div>
            <div className="relative z-10 space-y-5 mt-10">
              {[...filteredEmployees].sort((a, b) => {
                const aC = results.filter(r => r.userId === a.id).length;
                const bC = results.filter(r => r.userId === b.id).length;
                return bC - aC;
              }).slice(0, 5).map((emp, i) => (
                <div key={emp.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-white/20">#{i + 1}</span>
                    <span className="text-sm font-bold uppercase tracking-tight truncate max-w-[140px]">{emp.name}</span>
                  </div>
                  <span className="text-[#00A3FF] font-display font-black shrink-0">
                    {results.filter(r => r.userId === emp.id).length}
                  </span>
                </div>
              ))}
            </div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3FF]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
          </div>
        </div>

        {/* Course cards for drill-down */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Аналитика по курсам</h3>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Нажмите на курс для детализации</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.filter(c => !c.hiddenFromUsers).map(course => {
              const cResults = results.filter(r => r.courseId === course.id && filteredEmployees.some(e => e.id === r.userId));
              const passed = cResults.filter(r => r.score >= 80).length;
              const cAvg = cResults.length > 0
                ? Math.round(cResults.reduce((s, r) => s + (r.score || 0), 0) / cResults.length) : 0;
              const enrolled = filteredEmployees.filter(e =>
                (e.assignedCourses || []).includes(course.id) || cResults.some(r => r.userId === e.id)
              ).length;

              return (
                <motion.button
                  key={course.id}
                  onClick={() => setSelectedCourseId(course.id)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-[40px] border border-gray-100 p-8 shadow-sm hover:shadow-xl transition-all text-left group hover:border-[#002D57]/20"
                >
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#00A3FF] mb-1">{course.category}</p>
                      <h4 className="text-sm font-display font-black uppercase tracking-tight text-[#002D57] line-clamp-2">{course.title}</h4>
                    </div>
                    <div className={`ml-3 w-12 h-12 rounded-2xl flex items-center justify-center text-xs font-black shrink-0 ${cAvg >= 80 ? 'bg-green-50 text-green-600' : cAvg >= 60 ? 'bg-yellow-50 text-yellow-600' : cResults.length > 0 ? 'bg-red-50 text-red-500' : 'bg-gray-50 text-gray-400'}`}>
                      {cResults.length > 0 ? `${cAvg}%` : '—'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest">
                    <span className="text-gray-400">{enrolled} сотр.</span>
                    <span className="text-green-500">{passed} сдали</span>
                    <span className="text-[#002D57] group-hover:text-[#00A3FF] transition-colors">Подробнее →</span>
                  </div>
                  {/* Mini progress bar */}
                  <div className="mt-4 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#00A3FF] rounded-full transition-all"
                      style={{ width: `${enrolled > 0 ? Math.round((passed / enrolled) * 100) : 0}%` }}
                    />
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Employee table */}
        <div className="bg-white rounded-[64px] border border-gray-100 shadow-sm overflow-hidden p-12">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">Список сотрудников</h3>
            <span className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] bg-[#00A3FF]/5 px-6 py-3 rounded-2xl border border-[#00A3FF]/10">{selectedDept}</span>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-[#002D57]/5">
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em]">Сотрудник</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em]">Должность</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-center">Прогресс</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-center">Ср. тест</th>
                <th className="pb-8 text-[11px] uppercase font-black text-[#002D57] tracking-[0.1em] text-right">Эффективность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredEmployees.map(emp => {
                const empResults = results.filter(r => r.userId === emp.id);
                const assigned = emp.assignedCourses || [];
                const completedAssigned = assigned.filter(cid => empResults.some(r => r.courseId === cid && r.progress === 100));
                const empAvg = empResults.length > 0
                  ? Math.round(empResults.reduce((acc, r) => acc + (r.score || 0), 0) / empResults.length) : 0;
                const progressText = assigned.length > 0 ? `${completedAssigned.length}/${assigned.length}` : 'Не назначено';
                const progressPercent = assigned.length > 0 ? Math.round((completedAssigned.length / assigned.length) * 100) : 0;

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
                    <td className="py-8 text-xs font-bold text-gray-400">{emp.position}</td>
                    <td className="py-8 text-center">
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-xl">
                        <span className="text-sm font-black text-[#002D57]">{progressText}</span>
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
                          <div className="h-full bg-[#00A3FF] rounded-full" style={{ width: `${progressPercent}%` }} />
                        </div>
                        <span className="text-[8px] font-black uppercase text-gray-300 tracking-widest">{progressPercent}%</span>
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
