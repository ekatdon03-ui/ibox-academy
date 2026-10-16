import React, { useState, useRef, useEffect } from 'react';
import { Send, X, Headphones, MessageCircle, Phone, ChevronRight, Award, CheckCircle, Clock, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { contentService } from '../services/contentService';
import { UserProfile } from '../types';

interface Props { user: UserProfile; }

type Msg = { role: 'user' | 'model'; parts: { text: string }[] };
type Scenario = {
  id: string; title: string; groupName: string; channel: string; difficulty: string;
  personaName: string; personaEmoji: string; personaDesc: string; startMessage: string;
  isPublic?: boolean; assignedToUsers?: string[]; assignedToDepartments?: string[];
};
type Evaluation = { score: number; criteriaScores: { name: string; score: number; comment: string }[]; good: string[]; feedback: string } | null;

const DIFFICULTY: Record<string, { label: string; cls: string }> = {
  basic: { label: 'Базовый', cls: 'bg-green-50 text-green-600' },
  medium: { label: 'Средний', cls: 'bg-yellow-50 text-yellow-600' },
  hard: { label: 'Сложный', cls: 'bg-red-50 text-red-500' },
};

export default function SupportTrainerView({ user }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Scenario | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    contentService.getTrainerScenarios().then((s) => { setScenarios(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, isLoading]);

  const canSee = (s: Scenario) => {
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (s.isPublic) return true;
    if ((s.assignedToUsers || []).includes(user.id)) return true;
    if (user.department && (s.assignedToDepartments || []).includes(user.department)) return true;
    return false;
  };
  const visible = scenarios.filter(canSee);
  const groups = Array.from(new Set(visible.map((s) => s.groupName || 'Сценарии')));

  const startScenario = (s: Scenario) => {
    setActive(s);
    setEvaluation(null);
    setMessages(s.startMessage ? [{ role: 'model', parts: [{ text: s.startMessage }] }] : []);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !active) return;
    const text = input.trim();
    const next = [...messages, { role: 'user' as const, parts: [{ text }] }];
    setMessages(next);
    setInput('');
    setIsLoading(true);
    try {
      const reply = await contentService.trainerChat(active.id, text, next);
      setMessages([...next, { role: 'model', parts: [{ text: reply || '…' }] }]);
    } catch {
      setMessages([...next, { role: 'model', parts: [{ text: 'Ошибка связи. Попробуйте ещё раз.' }] }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!active || evaluating) return;
    const userTurns = messages.filter((m) => m.role === 'user').length;
    if (userTurns === 0) { setActive(null); return; }
    setEvaluating(true);
    try {
      const ev = await contentService.trainerEvaluate(active.id, messages);
      setEvaluation(ev);
      await contentService.saveTrainerSession({
        userId: user.id, scenarioId: active.id, scenarioTitle: active.title,
        score: ev.score, criteriaScores: ev.criteriaScores, feedback: ev.feedback, chatHistory: messages,
      });
    } catch {
      setEvaluation({ score: 0, criteriaScores: [], good: [], feedback: 'Не удалось получить оценку.' });
    } finally {
      setEvaluating(false);
    }
  };

  const exit = () => { setActive(null); setMessages([]); setEvaluation(null); setInput(''); };

  // ── Scenario catalog ──────────────────────────────────────────────────────
  if (!active) {
    return (
      <div className="flex-1 p-4 sm:p-10 overflow-y-auto bg-[#F5F7FA]">
        <div className="max-w-5xl mx-auto">
          <header className="mb-6 sm:mb-12 flex items-center gap-4">
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#002D57] text-white rounded-2xl sm:rounded-3xl flex items-center justify-center shrink-0">
              <Headphones size={24} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-display font-black uppercase tracking-tight text-[#002D57]">Тренажёр поддержки</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-1 sm:mt-2">Диалог с AI-клиентом и разбор по критериям</p>
            </div>
          </header>

          {loading ? (
            <div className="py-20 text-center text-gray-300 font-black uppercase tracking-widest text-sm">Загрузка…</div>
          ) : visible.length === 0 ? (
            <div className="py-20 bg-white rounded-[48px] border border-dashed border-gray-200 text-center text-gray-400 font-display font-black text-xs uppercase tracking-widest">
              Сценарии ещё не назначены
            </div>
          ) : (
            groups.map((g) => (
              <section key={g} className="mb-8 sm:mb-12">
                <h2 className="text-xs sm:text-sm font-display font-black uppercase tracking-widest text-[#002D57] mb-4 ml-1">{g}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {visible.filter((s) => (s.groupName || 'Сценарии') === g).map((s) => (
                    <button key={s.id} onClick={() => startScenario(s)}
                      className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm hover:shadow-xl active:scale-95 transition-all text-left group">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-14 h-14 rounded-2xl bg-[#F5F7FA] flex items-center justify-center text-3xl shrink-0">{s.personaEmoji || '🙂'}</div>
                        <div className="min-w-0">
                          <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57] truncate">{s.personaName}</p>
                          <p className="text-[10px] font-bold text-gray-400 truncate">{s.personaDesc}</p>
                        </div>
                      </div>
                      <h3 className="font-bold text-[#002D57] text-sm leading-snug mb-4 line-clamp-2">{s.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${DIFFICULTY[s.difficulty]?.cls || 'bg-gray-50 text-gray-400'}`}>
                          {DIFFICULTY[s.difficulty]?.label || s.difficulty}
                        </span>
                        <span className="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest bg-[#00A3FF]/10 text-[#00A3FF] flex items-center gap-1">
                          {s.channel === 'call' ? <Phone size={10} /> : <MessageCircle size={10} />}
                          {s.channel === 'call' ? 'Звонок' : 'Чат'}
                        </span>
                        <ChevronRight size={16} className="text-gray-200 group-hover:text-[#00A3FF] transition-all ml-auto" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Evaluation result ─────────────────────────────────────────────────────
  if (evaluation) {
    const passed = evaluation.score >= 70;
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-10 bg-[#F5F7FA]">
        <div className="max-w-3xl mx-auto">
          <div className={`rounded-[40px] p-8 sm:p-12 text-white text-center mb-6 ${passed ? 'bg-green-500' : 'bg-orange-500'}`}>
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl">
              {passed ? <Award size={40} className="text-green-500" /> : <RotateCcw size={40} className="text-orange-500" />}
            </div>
            <h2 className="text-5xl font-display font-black uppercase mb-2">{evaluation.score}</h2>
            <p className="text-xs font-black uppercase tracking-widest opacity-90">{passed ? 'Хорошо!' : 'Нужно закрепить'}</p>
            <p className="text-sm font-medium mt-6 opacity-95 leading-relaxed">{evaluation.feedback}</p>
          </div>

          {evaluation.criteriaScores.length > 0 && (
            <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-8 mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-[#002D57] mb-5">Оценка по критериям</h3>
              <div className="space-y-4">
                {evaluation.criteriaScores.map((c, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-[#002D57]">{c.name}</span>
                      <span className={`text-sm font-display font-black ${c.score >= 70 ? 'text-green-500' : c.score >= 40 ? 'text-yellow-500' : 'text-red-400'}`}>{c.score}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                      <div className={`h-full rounded-full ${c.score >= 70 ? 'bg-green-500' : c.score >= 40 ? 'bg-yellow-500' : 'bg-red-400'}`} style={{ width: `${c.score}%` }} />
                    </div>
                    {c.comment && <p className="text-[11px] text-gray-400 font-medium leading-snug">{c.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {evaluation.good.length > 0 && (
            <div className="bg-green-50/60 border border-green-100 rounded-[32px] p-6 sm:p-8 mb-6">
              <h3 className="text-xs font-black uppercase tracking-widest text-green-600 mb-4">Что получилось хорошо</h3>
              <ul className="space-y-2">
                {evaluation.good.map((g, i) => (
                  <li key={i} className="flex gap-2 items-start text-sm font-medium text-[#002D57]">
                    <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" /> {g}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-4 flex-wrap">
            <button onClick={() => startScenario(active)} className="flex-1 py-5 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#00A3FF] transition-all">Пройти заново</button>
            <button onClick={exit} className="flex-1 py-5 bg-white border-2 border-gray-100 text-gray-500 rounded-2xl font-black uppercase tracking-widest text-xs hover:text-[#002D57] transition-all">К сценариям</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-hidden p-4 sm:p-10 bg-[#F5F7FA] flex flex-col h-full">
      <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col min-h-0">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-2xl shrink-0">{active.personaEmoji}</div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-display font-black uppercase tracking-tight text-[#002D57] truncate">{active.personaName}</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 truncate">{active.title}</p>
            </div>
          </div>
          <button onClick={exit} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-300 hover:text-red-500 transition-all border border-gray-100 shrink-0"><X size={18} /></button>
        </header>

        <div className="flex-1 bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] px-5 py-3.5 rounded-[20px] text-sm leading-relaxed font-medium ${m.role === 'user' ? 'bg-[#002D57] text-white rounded-tr-none' : 'bg-[#F5F7FA] text-[#002D57] rounded-tl-none'}`}>
                  {m.parts[0].text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-[#F5F7FA] px-5 py-4 rounded-[20px] rounded-tl-none flex gap-1">
                  {[0, 0.2, 0.4].map((d) => <motion.div key={d} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: d }} className="w-2 h-2 bg-[#002D57]/30 rounded-full" />)}
                </div>
              </div>
            )}
          </div>
          <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50/50 flex gap-3 items-center">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ваш ответ клиенту…" disabled={evaluating}
              className="flex-1 bg-white rounded-2xl py-4 px-6 outline-none border border-gray-100 font-medium focus:ring-4 focus:ring-[#00A3FF]/10 transition-all text-sm" />
            <button onClick={handleSend} disabled={isLoading || evaluating} className="w-12 h-12 bg-[#00A3FF] text-white rounded-2xl flex items-center justify-center hover:bg-[#002D57] transition-all shrink-0 disabled:opacity-40"><Send size={18} /></button>
          </div>
        </div>

        <button onClick={handleFinish} disabled={evaluating}
          className="mt-4 w-full py-4 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#00A3FF] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
          {evaluating ? <><Clock size={16} className="animate-spin" /> Оцениваем диалог…</> : 'Завершить и получить разбор'}
        </button>
      </div>
    </div>
  );
}
