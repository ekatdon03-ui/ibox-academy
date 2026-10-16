import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X, Search, Check, Settings2, Users as UsersIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';
import { UserProfile } from '../types';

interface Props { employees: UserProfile[]; showToast: (msg: string, isError?: boolean) => void; }

type Scenario = {
  id?: string; title: string; groupName: string; channel: string; difficulty: string;
  personaName: string; personaEmoji: string; personaDesc: string; startMessage: string;
  clientPrompt: string; active: boolean; isPublic: boolean;
  assignedToUsers: string[]; assignedToDepartments: string[]; position?: number;
};

const EMPTY: Scenario = {
  title: '', groupName: '', channel: 'chat', difficulty: 'basic',
  personaName: '', personaEmoji: '🙂', personaDesc: '', startMessage: '', clientPrompt: '',
  active: true, isPublic: true, assignedToUsers: [], assignedToDepartments: [],
};

const INPUT = 'w-full bg-[#F5F7FA] rounded-2xl px-4 py-3 outline-none font-bold text-sm focus:ring-4 focus:ring-[#00A3FF]/10 transition-all';
const TEXTAREA = 'w-full bg-[#F5F7FA] rounded-2xl px-4 py-3 outline-none font-medium text-sm leading-relaxed focus:ring-4 focus:ring-[#00A3FF]/10 transition-all resize-y';

export default function TrainerAdmin({ employees, showToast }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [settings, setSettings] = useState({ clientRules: '', evalRules: '', criteria: [] as string[], knowledge: '' });
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const load = async () => {
    const [sc, st] = await Promise.all([contentService.getTrainerScenarios(), contentService.getTrainerSettings()]);
    setScenarios(sc);
    setSettings({ clientRules: st.clientRules || '', evalRules: st.evalRules || '', criteria: st.criteria || [], knowledge: st.knowledge || '' });
  };
  useEffect(() => { load(); }, []);

  const departments = Array.from(new Set(employees.map(e => e.department || '').filter(Boolean)));

  const saveSettings = async () => {
    setSaving(true);
    try { await contentService.saveTrainerSettings(settings); showToast('Настройки тренажёра сохранены'); }
    catch (e: any) { showToast('Ошибка: ' + (e?.message || ''), true); }
    finally { setSaving(false); }
  };

  const saveScenario = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { showToast('Укажите название сценария', true); return; }
    setSaving(true);
    try {
      await contentService.saveTrainerScenario(editing);
      showToast('Сценарий сохранён');
      setEditing(null);
      await load();
    } catch (e: any) { showToast('Ошибка: ' + (e?.message || ''), true); }
    finally { setSaving(false); }
  };

  const removeScenario = async (id?: string) => {
    if (!id) return;
    await contentService.deleteTrainerScenario(id);
    showToast('Сценарий удалён');
    load();
  };

  const upd = (patch: Partial<Scenario>) => setEditing(e => e ? { ...e, ...patch } : e);
  const toggleUser = (uid: string) => upd({ assignedToUsers: editing!.assignedToUsers.includes(uid) ? editing!.assignedToUsers.filter(x => x !== uid) : [...editing!.assignedToUsers, uid] });
  const toggleDept = (d: string) => upd({ assignedToDepartments: editing!.assignedToDepartments.includes(d) ? editing!.assignedToDepartments.filter(x => x !== d) : [...editing!.assignedToDepartments, d] });

  const filteredEmployees = employees.filter(e => !userSearch || (e.name || '').toLowerCase().includes(userSearch.toLowerCase()));

  return (
    <div className="max-w-5xl space-y-8">
      {/* ── Settings ── */}
      <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 sm:p-10">
        <header className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 bg-[#002D57] text-white rounded-2xl flex items-center justify-center"><Settings2 size={20} /></div>
          <div>
            <h2 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">Инструкции и база знаний</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">Редактируется только здесь, в админке</p>
          </div>
        </header>
        <div className="space-y-6">
          <Field label="Правила поведения AI-клиента" hint="Как ведёт себя клиент (общее для всех сценариев). Не содержит правильных ответов.">
            <textarea value={settings.clientRules} onChange={e => setSettings({ ...settings, clientRules: e.target.value })} rows={5} className={TEXTAREA} />
          </Field>
          <Field label="Правила AI-оценщика" hint="Как оценивать ответы сотрудника.">
            <textarea value={settings.evalRules} onChange={e => setSettings({ ...settings, evalRules: e.target.value })} rows={4} className={TEXTAREA} />
          </Field>
          <Field label="База знаний (эталон для оценки)" hint="Факты, по которым проверяется правильность ответов. AI-клиенту не передаётся.">
            <textarea value={settings.knowledge} onChange={e => setSettings({ ...settings, knowledge: e.target.value })} rows={8} className={TEXTAREA} />
          </Field>
          <Field label="Критерии оценки" hint="По одному в строке.">
            <textarea value={settings.criteria.join('\n')} onChange={e => setSettings({ ...settings, criteria: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} rows={5} className={TEXTAREA} />
          </Field>
          <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 px-8 py-4 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-[#00A3FF] transition-all disabled:opacity-50">
            <Save size={14} /> Сохранить настройки
          </button>
        </div>
      </div>

      {/* ── Scenarios ── */}
      <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-8 sm:p-10">
        <header className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">Сценарии ({scenarios.length})</h2>
          <button onClick={() => { setEditing({ ...EMPTY }); setUserSearch(''); }} className="flex items-center gap-2 px-6 py-3 bg-[#00A3FF] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-[#002D57] transition-all">
            <Plus size={14} /> Добавить
          </button>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {scenarios.map(s => (
            <div key={s.id} className="border border-gray-100 rounded-3xl p-5 flex items-start gap-4 hover:border-[#002D57]/20 transition-all">
              <div className="w-12 h-12 rounded-2xl bg-[#F5F7FA] flex items-center justify-center text-2xl shrink-0">{s.personaEmoji}</div>
              <div className="flex-1 min-w-0">
                <p className="font-display font-black uppercase text-sm text-[#002D57] truncate">{s.title}</p>
                <p className="text-[10px] font-bold text-gray-400 truncate">{s.groupName}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded ${s.active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>{s.active ? 'Активен' : 'Скрыт'}</span>
                  <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded bg-[#00A3FF]/10 text-[#00A3FF]">{s.isPublic ? 'Всем' : `${s.assignedToUsers.length + s.assignedToDepartments.length} назнач.`}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button onClick={() => { setEditing({ ...EMPTY, ...s }); setUserSearch(''); }} className="p-2 text-[#00A3FF] hover:bg-[#002D57]/5 rounded-lg text-[9px] font-black uppercase">Ред.</button>
                <button onClick={() => removeScenario(s.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Editor modal ── */}
      <AnimatePresence>
        {editing && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-[#002D57]/60 backdrop-blur-sm" onClick={() => setEditing(null)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[32px] w-full max-w-2xl relative z-10 max-h-[90vh] overflow-y-auto p-6 sm:p-10">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">{editing.id ? 'Редактировать' : 'Новый'} сценарий</h3>
                <button onClick={() => setEditing(null)} className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:text-red-500"><X size={16} /></button>
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Название сценария"><input value={editing.title} onChange={e => upd({ title: e.target.value })} className={INPUT} /></Field>
                  <Field label="Группа"><input value={editing.groupName} onChange={e => upd({ groupName: e.target.value })} placeholder="А — ..." className={INPUT} /></Field>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Field label="Имя клиента"><input value={editing.personaName} onChange={e => upd({ personaName: e.target.value })} className={INPUT} /></Field>
                  <Field label="Эмодзи"><input value={editing.personaEmoji} onChange={e => upd({ personaEmoji: e.target.value })} className={`${INPUT} text-center`} /></Field>
                  <Field label="Канал">
                    <select value={editing.channel} onChange={e => upd({ channel: e.target.value })} className={INPUT}><option value="chat">Чат</option><option value="call">Звонок</option></select>
                  </Field>
                  <Field label="Сложность">
                    <select value={editing.difficulty} onChange={e => upd({ difficulty: e.target.value })} className={INPUT}><option value="basic">Базовый</option><option value="medium">Средний</option><option value="hard">Сложный</option></select>
                  </Field>
                </div>
                <Field label="Описание персоны"><input value={editing.personaDesc} onChange={e => upd({ personaDesc: e.target.value })} className={INPUT} /></Field>
                <Field label="Первое сообщение клиента"><textarea value={editing.startMessage} onChange={e => upd({ startMessage: e.target.value })} rows={2} className={TEXTAREA} /></Field>
                <Field label="Скрытая инструкция AI-клиенту" hint="Поведение, скрытые факты, ловушки, развязка. Сотрудник этого НЕ видит.">
                  <textarea value={editing.clientPrompt} onChange={e => upd({ clientPrompt: e.target.value })} rows={6} className={TEXTAREA} />
                </Field>

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editing.active} onChange={e => upd({ active: e.target.checked })} className="w-4 h-4 accent-[#002D57]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">Активен</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editing.isPublic} onChange={e => upd({ isPublic: e.target.checked })} className="w-4 h-4 accent-[#00A3FF]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#002D57]">Доступно всем</span>
                  </label>
                </div>

                {!editing.isPublic && (
                  <div className="border border-gray-100 rounded-3xl p-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#002D57] flex items-center gap-2"><UsersIcon size={13} /> Назначить сотрудникам</p>
                    {departments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {departments.map(d => (
                          <button key={d} onClick={() => toggleDept(d)} className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${editing.assignedToDepartments.includes(d) ? 'bg-[#002D57] text-white' : 'bg-gray-50 text-gray-400'}`}>
                            {editing.assignedToDepartments.includes(d) && <Check size={10} className="inline mr-1" />}{d}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                      <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Поиск сотрудника..." className={`${INPUT} pl-11`} />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {filteredEmployees.slice(0, 50).map(emp => (
                        <button key={emp.id} onClick={() => toggleUser(emp.id)} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all ${editing.assignedToUsers.includes(emp.id) ? 'bg-[#00A3FF]/10' : 'hover:bg-gray-50'}`}>
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${editing.assignedToUsers.includes(emp.id) ? 'bg-[#00A3FF] text-white' : 'border border-gray-200'}`}>{editing.assignedToUsers.includes(emp.id) && <Check size={12} />}</div>
                          <span className="text-xs font-bold text-[#002D57] truncate">{emp.name}</span>
                          <span className="text-[9px] text-gray-300 ml-auto shrink-0">{emp.department}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button onClick={saveScenario} disabled={saving} className="flex-1 py-4 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-[#00A3FF] transition-all disabled:opacity-50 flex items-center justify-center gap-2"><Save size={14} /> Сохранить</button>
                  <button onClick={() => setEditing(null)} className="px-8 py-4 bg-gray-100 text-gray-500 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-all">Отмена</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1 block">{label}</label>
      {hint && <p className="text-[9px] text-gray-300 font-medium ml-1 -mt-1 mb-1">{hint}</p>}
      {children}
    </div>
  );
}
