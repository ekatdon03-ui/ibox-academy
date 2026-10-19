import React, { useState, useEffect } from 'react';
import { Users, Award, TrendingDown, Target, ChevronDown, Headphones } from 'lucide-react';
import { motion } from 'motion/react';
import { contentService } from '../services/contentService';
import { UserProfile } from '../types';

interface Props { employees: UserProfile[]; }

export default function TrainerAnalytics({ employees }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    contentService.getAllTrainerSessions().then((s) => { setSessions(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const empById = (id: string) => employees.find((e) => e.id === id);
  const total = sessions.length;
  const avg = total ? Math.round(sessions.reduce((a, s) => a + (s.score || 0), 0) / total) : 0;
  const passed = sessions.filter((s) => s.score >= 70).length;
  const activeUsers = new Set(sessions.map((s) => s.userId)).size;

  // Weakest criteria (lowest average across all sessions).
  const critMap: Record<string, { sum: number; n: number }> = {};
  sessions.forEach((s) => (s.criteriaScores || []).forEach((c: any) => {
    if (!c?.name) return;
    critMap[c.name] = critMap[c.name] || { sum: 0, n: 0 };
    critMap[c.name].sum += Number(c.score) || 0; critMap[c.name].n += 1;
  }));
  const criteria = Object.entries(critMap).map(([name, v]) => ({ name, avg: Math.round(v.sum / v.n) })).sort((a, b) => a.avg - b.avg);

  // Per-scenario.
  const scnMap: Record<string, { sum: number; n: number }> = {};
  sessions.forEach((s) => { const k = s.scenarioTitle || '—'; scnMap[k] = scnMap[k] || { sum: 0, n: 0 }; scnMap[k].sum += s.score || 0; scnMap[k].n += 1; });
  const scenarios = Object.entries(scnMap).map(([title, v]) => ({ title, avg: Math.round(v.sum / v.n), n: v.n })).sort((a, b) => b.n - a.n);

  // Per-employee.
  const byUser: Record<string, any[]> = {};
  sessions.forEach((s) => { (byUser[s.userId] = byUser[s.userId] || []).push(s); });
  const userRows = Object.entries(byUser).map(([uid, list]) => ({
    uid, emp: empById(uid), list,
    avg: Math.round(list.reduce((a, s) => a + (s.score || 0), 0) / list.length),
    last: list[0],
  })).sort((a, b) => b.list.length - a.list.length);

  if (loading) return <div className="py-20 text-center text-gray-300 font-black uppercase tracking-widest text-sm">Загрузка…</div>;

  if (total === 0) return (
    <div className="py-20 bg-white rounded-[48px] border border-dashed border-gray-200 text-center text-gray-400 font-display font-black text-xs uppercase tracking-widest">
      Сотрудники ещё не проходили тренажёр поддержки
    </div>
  );

  const stats = [
    { label: 'Сессий пройдено', value: total, Icon: Headphones, color: 'text-[#00A3FF]', bg: 'bg-[#00A3FF]/5' },
    { label: 'Средний балл', value: `${avg}`, Icon: Award, color: 'text-green-500', bg: 'bg-green-50' },
    { label: 'Сдано ≥70', value: `${total ? Math.round((passed / total) * 100) : 0}%`, Icon: Target, color: 'text-orange-500', bg: 'bg-orange-50' },
    { label: 'Сотрудников', value: activeUsers, Icon: Users, color: 'text-[#002D57]', bg: 'bg-gray-100' },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-white p-6 sm:p-8 rounded-[32px] border border-gray-100 shadow-sm flex items-center gap-5">
            <div className={`w-12 h-12 ${s.bg} ${s.color} rounded-2xl flex items-center justify-center`}><s.Icon size={22} /></div>
            <div><p className="text-2xl sm:text-3xl font-display font-black text-[#002D57]">{s.value}</p><p className="text-[9px] uppercase font-black text-gray-300 tracking-widest mt-0.5">{s.label}</p></div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weak criteria */}
        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-6 sm:p-8">
          <h3 className="text-sm font-display font-black uppercase tracking-tight text-[#002D57] mb-5 flex items-center gap-2"><TrendingDown size={16} className="text-red-400" /> Слабые критерии</h3>
          <div className="space-y-3">
            {criteria.slice(0, 8).map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-[#002D57]">{c.name}</span><span className={`text-xs font-display font-black ${c.avg >= 70 ? 'text-green-500' : c.avg >= 40 ? 'text-yellow-500' : 'text-red-400'}`}>{c.avg}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${c.avg >= 70 ? 'bg-green-500' : c.avg >= 40 ? 'bg-yellow-500' : 'bg-red-400'}`} style={{ width: `${c.avg}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Per scenario */}
        <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-6 sm:p-8">
          <h3 className="text-sm font-display font-black uppercase tracking-tight text-[#002D57] mb-5">По сценариям</h3>
          <div className="space-y-3">
            {scenarios.slice(0, 8).map((s) => (
              <div key={s.title} className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[#002D57] truncate">{s.title}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[10px] font-bold text-gray-300">{s.n} сес.</span>
                  <span className={`text-sm font-display font-black ${s.avg >= 70 ? 'text-green-500' : s.avg >= 40 ? 'text-yellow-500' : 'text-red-400'}`}>{s.avg}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per employee */}
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden p-6 sm:p-10">
        <h3 className="text-lg font-display font-black uppercase tracking-tight text-[#002D57] mb-6">Сотрудники</h3>
        <div className="space-y-2">
          {userRows.map((r) => {
            const isOpen = expanded === r.uid;
            return (
              <div key={r.uid} className="border border-gray-100 rounded-2xl overflow-hidden">
                <button onClick={() => setExpanded(isOpen ? null : r.uid)} className="w-full flex items-center justify-between gap-3 p-4 hover:bg-gray-50/50 transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center font-display font-black text-xs text-gray-400 shrink-0">{(r.emp?.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join('')}</div>
                    <div className="min-w-0 text-left">
                      <p className="font-display font-black uppercase text-sm text-[#002D57] truncate">{r.emp?.name || r.uid}</p>
                      <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">{r.emp?.department || '—'} · {r.list.length} сессий</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-lg font-display font-black ${r.avg >= 70 ? 'text-green-500' : r.avg >= 40 ? 'text-yellow-500' : 'text-red-400'}`}>{r.avg}</span>
                    <ChevronDown size={16} className={`text-gray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 bg-gray-50/40">
                    {r.list.map((s: any, i: number) => (
                      <div key={s.id || i} className="bg-white rounded-xl p-4 border border-gray-100">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-xs font-bold text-[#002D57] truncate">{s.scenarioTitle || 'Сценарий'}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] text-gray-300 font-bold">{s.timestamp ? new Date(s.timestamp).toLocaleDateString('ru-RU') : ''}</span>
                            <span className={`text-sm font-display font-black ${s.score >= 70 ? 'text-green-500' : 'text-red-400'}`}>{s.score}</span>
                          </div>
                        </div>
                        {s.feedback && <p className="text-[11px] text-gray-500 font-medium leading-snug mb-2">{s.feedback}</p>}
                        {(s.criteriaScores || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {s.criteriaScores.map((c: any, j: number) => (
                              <span key={j} className={`text-[9px] font-bold px-2 py-0.5 rounded ${c.score >= 70 ? 'bg-green-50 text-green-600' : c.score >= 40 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-500'}`}>{c.name}: {c.score}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
