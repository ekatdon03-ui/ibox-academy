import React, { useState, useRef, useEffect } from 'react';
import {
  Send, X, Headphones, MessageCircle, Phone, PhoneCall, ChevronRight, Award, CheckCircle,
  Clock, RotateCcw, Lightbulb, BookOpen, History, Check, PhoneOff, FileText, ArrowLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { contentService } from '../services/contentService';
import { UserProfile } from '../types';
import PixelAvatar, { moodFromEmoji } from './PixelAvatar';

interface Props { user: UserProfile; }

type Msg = { role: 'user' | 'model'; parts: { text: string }[] };
type Scenario = {
  id: string; title: string; groupName: string; channel: string; difficulty: string;
  personaName: string; personaEmoji: string; personaDesc: string; startMessage: string;
  referenceDialog?: string; answerFormat?: string; trainerMode?: string;
  isPublic?: boolean; assignedToUsers?: string[]; assignedToDepartments?: string[];
};
type Opt = { id: string; text: string; correct: boolean; note: string };
type Evaluation = { score: number; criteriaScores: { name: string; score: number; comment: string }[]; good: string[]; feedback: string } | null;

const DIFFICULTY: Record<string, { label: string; cls: string }> = {
  basic: { label: 'Базовый', cls: 'bg-green-50 text-green-600' },
  medium: { label: 'Средний', cls: 'bg-yellow-50 text-yellow-600' },
  hard: { label: 'Сложный', cls: 'bg-red-50 text-red-500' },
};

export default function SupportTrainerView({ user }: Props) {
  const [tab, setTab] = useState<'scenarios' | 'materials' | 'history'>('scenarios');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [settings, setSettings] = useState<{ knowledge: string; templates: { title: string; text: string }[]; docs: { title: string; text: string }[] }>({ knowledge: '', templates: [], docs: [] });
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [active, setActive] = useState<Scenario | null>(null);
  const [phase, setPhase] = useState<'config' | 'calling' | 'chat' | 'result'>('config');
  const [format, setFormat] = useState<'free' | 'choice'>('free');
  const [training, setTraining] = useState(true);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation>(null);
  const [showRef, setShowRef] = useState(false);

  const [options, setOptions] = useState<Opt[]>([]);
  const [optLoading, setOptLoading] = useState(false);
  const [picked, setPicked] = useState<Opt | null>(null);
  const [choiceStats, setChoiceStats] = useState({ correct: 0, total: 0 });

  const [hint, setHint] = useState('');
  const [hintLoading, setHintLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      contentService.getTrainerScenarios(),
      contentService.getTrainerSettings(),
      contentService.getMyTrainerSessions(),
    ]).then(([sc, st, ss]) => {
      setScenarios(sc);
      setSettings({ knowledge: st.knowledge || '', templates: st.templates || [], docs: (st as any).docs || [] });
      setSessions(ss);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, isLoading, options, optLoading]);

  const canSee = (s: Scenario) => {
    if (user.role === 'admin' || user.role === 'manager') return true;
    if (s.isPublic) return true;
    if ((s.assignedToUsers || []).includes(user.id)) return true;
    if (user.department && (s.assignedToDepartments || []).includes(user.department)) return true;
    return false;
  };
  const visible = scenarios.filter(canSee);
  const groups = Array.from(new Set(visible.map((s) => s.groupName || 'Сценарии')));
  const mood = (s: Scenario) => moodFromEmoji(s.personaEmoji, s.difficulty);

  const openScenario = (s: Scenario) => {
    // Mode is configured by the lead on the scenario, not chosen by the employee.
    setActive(s); setPhase('config');
    setFormat(s.answerFormat === 'choice' ? 'choice' : 'free');
    setTraining(s.trainerMode !== 'attestation');
    setMessages([]); setEvaluation(null); setShowRef(false);
    setOptions([]); setPicked(null); setChoiceStats({ correct: 0, total: 0 }); setHint('');
  };

  const beginDialog = () => {
    if (!active) return;
    setMessages(active.startMessage ? [{ role: 'model', parts: [{ text: active.startMessage }] }] : []);
    setPhase('chat');
    if (format === 'choice') loadOptions(active.startMessage ? [{ role: 'model', parts: [{ text: active.startMessage }] }] : []);
  };

  const start = () => {
    if (!active) return;
    if (active.channel === 'call') setPhase('calling');
    else beginDialog();
  };

  const loadOptions = async (hist: Msg[]) => {
    if (!active) return;
    setOptLoading(true); setPicked(null); setOptions([]);
    try { setOptions(await contentService.trainerOptions(active.id, hist)); }
    finally { setOptLoading(false); }
  };

  const sendText = async (text: string, afterHist: Msg[]) => {
    if (!active) return;
    setIsLoading(true); setHint('');
    try {
      const reply = await contentService.trainerChat(active.id, text, afterHist);
      const withReply = [...afterHist, { role: 'model' as const, parts: [{ text: reply || '…' }] }];
      setMessages(withReply);
      if (format === 'choice') await loadOptions(withReply);
    } catch {
      setMessages([...afterHist, { role: 'model', parts: [{ text: 'Ошибка связи. Попробуйте ещё раз.' }] }]);
    } finally { setIsLoading(false); }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    const next = [...messages, { role: 'user' as const, parts: [{ text }] }];
    setMessages(next); setInput('');
    sendText(text, next);
  };

  const pickOption = (o: Opt) => {
    if (picked) return;
    setPicked(o);
    setChoiceStats((s) => ({ correct: s.correct + (o.correct ? 1 : 0), total: s.total + 1 }));
    const next = [...messages, { role: 'user' as const, parts: [{ text: o.text }] }];
    setMessages(next);
    if (training) {
      // show feedback briefly, then continue
      setTimeout(() => sendText(o.text, next), 900);
    } else {
      sendText(o.text, next);
    }
  };

  const getHint = async () => {
    if (!active || hintLoading) return;
    setHintLoading(true);
    try { setHint(await contentService.trainerHint(active.id, messages)); }
    finally { setHintLoading(false); }
  };

  const finish = async () => {
    if (!active || evaluating) return;
    if (messages.filter((m) => m.role === 'user').length === 0) { setActive(null); return; }
    setEvaluating(true);
    try {
      const ev = await contentService.trainerEvaluate(active.id, messages);
      setEvaluation(ev); setPhase('result');
      await contentService.saveTrainerSession({
        userId: user.id, scenarioId: active.id, scenarioTitle: active.title,
        score: ev.score, criteriaScores: ev.criteriaScores, feedback: ev.feedback, chatHistory: messages,
      });
      contentService.getMyTrainerSessions().then(setSessions).catch(() => {});
    } catch {
      setEvaluation({ score: 0, criteriaScores: [], good: [], feedback: 'Не удалось получить оценку.' });
      setPhase('result');
    } finally { setEvaluating(false); }
  };

  const exit = () => { setActive(null); setMessages([]); setEvaluation(null); setInput(''); setOptions([]); setPicked(null); };

  // ══ Active scenario flow ══════════════════════════════════════════════════
  if (active) {
    // ── Config ──
    if (phase === 'config') {
      return (
        <div className="flex-1 overflow-y-auto p-4 sm:p-10 bg-[#F5F7FA]">
          <div className="max-w-xl mx-auto">
            <button onClick={exit} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-[#002D57] mb-6"><ArrowLeft size={14} /> Назад</button>
            <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-8 text-center">
              <PixelAvatar seed={active.personaName} mood={mood(active)} size={110} className="mx-auto mb-4 rounded-[20px] shadow-md" />
              <h1 className="text-2xl font-display font-black uppercase tracking-tight text-[#002D57]">{active.personaName}</h1>
              <p className="text-xs font-bold text-gray-400 mt-1 mb-1">{active.personaDesc}</p>
              <p className="text-sm font-bold text-[#002D57] mt-3">{active.title}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${DIFFICULTY[active.difficulty]?.cls}`}>{DIFFICULTY[active.difficulty]?.label}</span>
                <span className="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest bg-[#00A3FF]/10 text-[#00A3FF] flex items-center gap-1">
                  {active.channel === 'call' ? <Phone size={10} /> : <MessageCircle size={10} />}{active.channel === 'call' ? 'Звонок' : 'Чат'}
                </span>
              </div>

              <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
                <span className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-gray-100 text-gray-500">
                  {format === 'choice' ? 'Выбор из 3 вариантов' : 'Свободный ответ'}
                </span>
                <span className="px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-gray-100 text-gray-500">
                  {training ? 'Обучение (подсказки)' : 'Аттестация'}
                </span>
              </div>

              <button onClick={start} className="mt-8 w-full py-5 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#00A3FF] transition-all flex items-center justify-center gap-2">
                {active.channel === 'call' ? <><PhoneCall size={16} /> Принять звонок</> : <><MessageCircle size={16} /> Начать диалог</>}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── Incoming call screen ──
    if (phase === 'calling') {
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-gradient-to-b from-[#002D57] to-[#001B38]">
          <div className="text-center text-white">
            <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} className="mx-auto mb-8 relative">
              <div className="absolute inset-0 rounded-[32px] bg-[#00A3FF]/30 blur-2xl" />
              <PixelAvatar seed={active.personaName} mood={mood(active)} size={150} className="relative rounded-[28px] shadow-2xl" />
            </motion.div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00A3FF] mb-2">Входящий звонок</p>
            <h1 className="text-3xl font-display font-black uppercase tracking-tight mb-1">{active.personaName}</h1>
            <p className="text-xs font-bold text-white/50 mb-12">{active.personaDesc}</p>
            <div className="flex items-center justify-center gap-10">
              <button onClick={exit} className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-xl hover:bg-red-600 transition-all"><PhoneOff size={26} /></div>
                <span className="text-[9px] font-black uppercase tracking-widest text-white/50">Отклонить</span>
              </button>
              <button onClick={beginDialog} className="flex flex-col items-center gap-2">
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-xl hover:bg-green-600 transition-all"><PhoneCall size={26} /></motion.div>
                <span className="text-[9px] font-black uppercase tracking-widest text-white/50">Ответить</span>
              </button>
            </div>
            <p className="text-[10px] text-white/40 font-bold mt-10 max-w-xs mx-auto leading-relaxed">Это звонок. Начните с приветствия: «Добрый день, поддержка iBOX, меня зовут …»</p>
          </div>
        </div>
      );
    }

    // ── Result ──
    if (phase === 'result' && evaluation) {
      const passed = evaluation.score >= 70;
      return (
        <div className="flex-1 overflow-y-auto p-4 sm:p-10 bg-[#F5F7FA]">
          <div className="max-w-3xl mx-auto">
            <div className={`rounded-[40px] p-8 sm:p-12 text-white text-center mb-6 ${passed ? 'bg-green-500' : 'bg-orange-500'}`}>
              <PixelAvatar seed={active.personaName} mood={passed ? 'happy' : mood(active)} size={90} className="mx-auto mb-5 rounded-[18px] shadow-xl" />
              <h2 className="text-5xl font-display font-black uppercase mb-2">{evaluation.score}</h2>
              <p className="text-xs font-black uppercase tracking-widest opacity-90">{passed ? 'Хорошо!' : 'Нужно закрепить'}</p>
              {choiceStats.total > 0 && <p className="text-[11px] font-bold mt-2 opacity-80">Верных выборов: {choiceStats.correct} из {choiceStats.total}</p>}
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
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1"><div className={`h-full rounded-full ${c.score >= 70 ? 'bg-green-500' : c.score >= 40 ? 'bg-yellow-500' : 'bg-red-400'}`} style={{ width: `${c.score}%` }} /></div>
                      {c.comment && <p className="text-[11px] text-gray-400 font-medium leading-snug">{c.comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {evaluation.good.length > 0 && (
              <div className="bg-green-50/60 border border-green-100 rounded-[32px] p-6 sm:p-8 mb-6">
                <h3 className="text-xs font-black uppercase tracking-widest text-green-600 mb-4">Что получилось хорошо</h3>
                <ul className="space-y-2">{evaluation.good.map((g, i) => (<li key={i} className="flex gap-2 items-start text-sm font-medium text-[#002D57]"><CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" /> {g}</li>))}</ul>
              </div>
            )}

            {active.referenceDialog && (
              <div className="mb-6">
                <button onClick={() => setShowRef(!showRef)} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#00A3FF] mb-3"><FileText size={14} /> {showRef ? 'Скрыть' : 'Посмотреть'} эталонный диалог</button>
                {showRef && <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-8 text-sm text-[#002D57] markdown-content"><ReactMarkdown>{active.referenceDialog}</ReactMarkdown></div>}
              </div>
            )}

            <div className="flex gap-4 flex-wrap">
              <button onClick={() => openScenario(active)} className="flex-1 py-5 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#00A3FF] transition-all">Пройти заново</button>
              <button onClick={exit} className="flex-1 py-5 bg-white border-2 border-gray-100 text-gray-500 rounded-2xl font-black uppercase tracking-widest text-xs hover:text-[#002D57] transition-all">К сценариям</button>
            </div>
          </div>
        </div>
      );
    }

    // ── Chat ──
    return (
      <div className="flex-1 overflow-hidden p-4 sm:p-8 bg-[#F5F7FA] flex flex-col h-full">
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col min-h-0">
          <header className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <PixelAvatar seed={active.personaName} mood={mood(active)} size={44} className="rounded-xl shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-xl font-display font-black uppercase tracking-tight text-[#002D57] truncate flex items-center gap-2">
                  {active.personaName}
                  {active.channel === 'call' && <span className="text-[8px] font-black uppercase tracking-widest text-green-500 flex items-center gap-1"><PhoneCall size={10} /> звонок</span>}
                </h1>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 truncate">{format === 'choice' ? 'Выбор из вариантов' : 'Свободный ответ'} · {training ? 'обучение' : 'аттестация'}</p>
              </div>
            </div>
            <button onClick={exit} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-300 hover:text-red-500 transition-all border border-gray-100 shrink-0"><X size={18} /></button>
          </header>

          <div className="flex-1 bg-white rounded-[28px] border border-gray-100 shadow-sm overflow-hidden flex flex-col min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'model' && <PixelAvatar seed={active.personaName} mood={mood(active)} size={28} className="rounded-lg shrink-0 mb-1" />}
                  <div className={`max-w-[80%] px-4 py-3 rounded-[18px] text-sm leading-relaxed font-medium ${m.role === 'user' ? 'bg-[#002D57] text-white rounded-br-none' : 'bg-[#F5F7FA] text-[#002D57] rounded-bl-none'}`}>{m.parts[0].text}</div>
                </div>
              ))}
              {isLoading && (
                <div className="flex items-end gap-2 justify-start">
                  <PixelAvatar seed={active.personaName} mood={mood(active)} size={28} className="rounded-lg mb-1" />
                  <div className="bg-[#F5F7FA] px-5 py-4 rounded-[18px] rounded-bl-none flex gap-1">{[0, 0.2, 0.4].map((d) => <motion.div key={d} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: d }} className="w-2 h-2 bg-[#002D57]/30 rounded-full" />)}</div>
                </div>
              )}

              {/* Hint bubble (training) */}
              {hint && <div className="flex justify-center"><div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2.5 rounded-2xl text-xs font-bold flex items-start gap-2 max-w-[90%]"><Lightbulb size={14} className="mt-0.5 shrink-0" /> {hint}</div></div>}
            </div>

            {/* Input area */}
            <div className="p-3 sm:p-4 border-t border-gray-100 bg-gray-50/50">
              {format === 'choice' ? (
                <div className="space-y-2">
                  {optLoading && <div className="text-center text-[10px] font-black uppercase tracking-widest text-gray-400 py-4">ИИ готовит варианты…</div>}
                  {!optLoading && options.map((o) => {
                    const chosen = picked?.id === o.id;
                    const showMark = training && !!picked;
                    return (
                      <button key={o.id} onClick={() => pickOption(o)} disabled={!!picked || isLoading}
                        className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-medium border-2 transition-all disabled:cursor-default ${
                          showMark && o.correct ? 'border-green-400 bg-green-50' :
                          showMark && chosen && !o.correct ? 'border-red-300 bg-red-50' :
                          chosen ? 'border-[#002D57] bg-[#002D57]/5' : 'border-gray-100 bg-white hover:border-[#00A3FF]/40'}`}>
                        <span className="text-[#002D57]">{o.text}</span>
                        {showMark && (chosen || o.correct) && (
                          <span className={`block mt-1.5 text-[11px] font-bold ${o.correct ? 'text-green-600' : 'text-red-500'}`}>
                            {o.correct ? '✓ Верно' : '✗ Ошибка'}{o.note ? ` — ${o.note}` : ''}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {!optLoading && options.length === 0 && !picked && (
                    <button onClick={() => loadOptions(messages)} className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-[#00A3FF]">Показать варианты</button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  {training && (
                    <button onClick={getHint} disabled={hintLoading} title="Подсказка" className="w-11 h-11 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center hover:bg-amber-200 transition-all shrink-0 disabled:opacity-50"><Lightbulb size={18} /></button>
                  )}
                  <input value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Ваш ответ клиенту…" disabled={evaluating}
                    className="flex-1 bg-white rounded-2xl py-3.5 px-5 outline-none border border-gray-100 font-medium focus:ring-4 focus:ring-[#00A3FF]/10 transition-all text-sm" />
                  <button onClick={handleSend} disabled={isLoading || evaluating} className="w-11 h-11 bg-[#00A3FF] text-white rounded-xl flex items-center justify-center hover:bg-[#002D57] transition-all shrink-0 disabled:opacity-40"><Send size={18} /></button>
                </div>
              )}
            </div>
          </div>

          <button onClick={finish} disabled={evaluating} className="mt-3 w-full py-4 bg-[#002D57] text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-[#00A3FF] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {evaluating ? <><Clock size={16} className="animate-spin" /> Оцениваем диалог…</> : <>{active.channel === 'call' ? 'Завершить звонок' : 'Завершить'} и получить разбор</>}
          </button>
        </div>
      </div>
    );
  }

  // ══ Catalog / materials / history ════════════════════════════════════════
  return (
    <div className="flex-1 p-4 sm:p-10 overflow-y-auto bg-[#F5F7FA]">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6 sm:mb-10 flex items-center gap-4">
          <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[#002D57] text-white rounded-2xl sm:rounded-3xl flex items-center justify-center shrink-0"><Headphones size={24} /></div>
          <div>
            <h1 className="text-2xl sm:text-4xl font-display font-black uppercase tracking-tight text-[#002D57]">Тренажёр поддержки</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-1">Диалог с AI-клиентом, обучение и разбор</p>
          </div>
        </header>

        <div className="flex bg-white p-1 rounded-2xl border border-gray-100 shadow-sm mb-8 w-fit">
          {[{ id: 'scenarios', label: 'Сценарии', Icon: MessageCircle }, { id: 'materials', label: 'Материалы', Icon: BookOpen }, { id: 'history', label: 'История', Icon: History }].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as any)} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === t.id ? 'bg-[#002D57] text-white shadow-lg' : 'text-gray-400 hover:text-[#002D57]'}`}>
              <t.Icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center text-gray-300 font-black uppercase tracking-widest text-sm">Загрузка…</div>
        ) : tab === 'scenarios' ? (
          visible.length === 0 ? (
            <div className="py-20 bg-white rounded-[48px] border border-dashed border-gray-200 text-center text-gray-400 font-display font-black text-xs uppercase tracking-widest">Сценарии ещё не назначены</div>
          ) : (
            groups.map((g) => (
              <section key={g} className="mb-8 sm:mb-12">
                <h2 className="text-xs sm:text-sm font-display font-black uppercase tracking-widest text-[#002D57] mb-4 ml-1">{g}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {visible.filter((s) => (s.groupName || 'Сценарии') === g).map((s) => (
                    <button key={s.id} onClick={() => openScenario(s)} className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm hover:shadow-xl active:scale-95 transition-all text-left group">
                      <div className="flex items-center gap-4 mb-4">
                        <PixelAvatar seed={s.personaName} mood={mood(s)} size={56} className="rounded-2xl shrink-0" />
                        <div className="min-w-0">
                          <p className="font-display font-black uppercase text-sm tracking-tight text-[#002D57] truncate">{s.personaName}</p>
                          <p className="text-[10px] font-bold text-gray-400 truncate">{s.personaDesc}</p>
                        </div>
                      </div>
                      <h3 className="font-bold text-[#002D57] text-sm leading-snug mb-4 line-clamp-2">{s.title}</h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${DIFFICULTY[s.difficulty]?.cls || 'bg-gray-50 text-gray-400'}`}>{DIFFICULTY[s.difficulty]?.label || s.difficulty}</span>
                        <span className="px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest bg-[#00A3FF]/10 text-[#00A3FF] flex items-center gap-1">{s.channel === 'call' ? <Phone size={10} /> : <MessageCircle size={10} />}{s.channel === 'call' ? 'Звонок' : 'Чат'}</span>
                        <ChevronRight size={16} className="text-gray-200 group-hover:text-[#00A3FF] transition-all ml-auto" />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )
        ) : tab === 'materials' ? (
          <div className="space-y-6">
            {settings.knowledge && (
              <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-10">
                <h2 className="text-lg font-display font-black uppercase tracking-tight text-[#002D57] mb-5 flex items-center gap-2"><BookOpen size={18} /> База знаний</h2>
                <div className="text-sm text-[#002D57] whitespace-pre-wrap leading-relaxed font-medium">{settings.knowledge}</div>
              </div>
            )}
            {settings.templates.length > 0 && (
              <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-10">
                <h2 className="text-lg font-display font-black uppercase tracking-tight text-[#002D57] mb-5 flex items-center gap-2"><FileText size={18} /> Шаблоны ответов</h2>
                <div className="space-y-4">
                  {settings.templates.map((t, i) => (
                    <div key={i} className="border border-gray-100 rounded-2xl p-5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] mb-2">{t.title}</p>
                      <p className="text-sm text-[#002D57] whitespace-pre-wrap leading-relaxed">{t.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {settings.docs.length > 0 && (
              <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 sm:p-10">
                <h2 className="text-lg font-display font-black uppercase tracking-tight text-[#002D57] mb-5 flex items-center gap-2"><BookOpen size={18} /> Учебные документы</h2>
                <div className="space-y-4">
                  {settings.docs.map((d, i) => (
                    <details key={i} className="border border-gray-100 rounded-2xl p-5">
                      <summary className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF] cursor-pointer">📄 {d.title}</summary>
                      <p className="text-sm text-[#002D57] whitespace-pre-wrap leading-relaxed mt-3">{d.text}</p>
                    </details>
                  ))}
                </div>
              </div>
            )}
            {!settings.knowledge && settings.templates.length === 0 && settings.docs.length === 0 && (
              <div className="py-20 bg-white rounded-[48px] border border-dashed border-gray-200 text-center text-gray-400 font-display font-black text-xs uppercase tracking-widest">Материалы ещё не добавлены</div>
            )}
          </div>
        ) : (
          sessions.length === 0 ? (
            <div className="py-20 bg-white rounded-[48px] border border-dashed border-gray-200 text-center text-gray-400 font-display font-black text-xs uppercase tracking-widest">Вы ещё не проходили тренажёр</div>
          ) : (
            <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
              {sessions.map((s, i) => (
                <div key={s.id || i} className="p-5 sm:p-6 border-b border-gray-50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-display font-black text-sm shrink-0 ${s.score >= 70 ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-500'}`}>{s.score}</div>
                    <div className="min-w-0">
                      <p className="font-bold text-[#002D57] text-sm truncate">{s.scenarioTitle || 'Сценарий'}</p>
                      <p className="text-[11px] text-gray-400 font-medium line-clamp-1">{s.feedback}</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-300 shrink-0">{s.timestamp ? new Date(s.timestamp).toLocaleDateString('ru-RU') : ''}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

