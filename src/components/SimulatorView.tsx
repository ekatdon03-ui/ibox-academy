import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Send, X, Bot, Zap, MessageCircle, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { aiService } from '../services/aiService';
import { contentService, AISettings } from '../services/contentService';
import { Course, UserProfile, GlossaryTerm } from '../types';

interface SimulatorViewProps {
  courses: Course[];
  user: UserProfile | null;
  onRefreshUser?: () => void;
}

export default function SimulatorView({ courses, user, onRefreshUser }: SimulatorViewProps) {
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [evaluation, setEvaluation] = useState<{ feedback: string, score: number } | null>(null);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadSettings = async () => {
      const s = await contentService.getAISettings();
      setSettings(s);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const buildRichContext = (course: Course, lessonId?: string | null) => {
    let context = `--- ПОЛНЫЙ КОНТЕКСТ КУРСА: ${course.title} ---\n`;
    context += `ОПИСАНИЕ: ${course.description}\n\n`;
    
    context += `ДЕТАЛЬНОЕ СОДЕРЖАНИЕ ВСЕХ УРОКОВ КУРСА:\n`;
    course.lessons.forEach((l, i) => {
      context += `УРОК ${i + 1}: ${l.title}\n`;
      context += `КОНТЕНТ УРОКА: ${l.content}\n`;
      if (l.aiKnowledge) {
        context += `БАЗА ЗНАНИЙ (извлечено ИИ из медиа-файлов): ${l.aiKnowledge}\n`;
      }
      context += `\n`;
    });

    if (lessonId) {
      const lesson = course.lessons.find(l => l.id === lessonId);
      if (lesson) {
        context += `\nВНИМАНИЕ: СЕЙЧАС ТРЕНИРОВКА СФОКУСИРОВАНА НА УРОКЕ: "${lesson.title}".\n`;
        context += `ИСПОЛЬЗУЙ ЭТУ ТЕМУ КАК ОСНОВНУЮ ДЛЯ КЕЙСА.\n`;
      }
    } else {
      context += `\nВНИМАНИЕ: ЭТО ОБЩАЯ ТРЕНИРОВКА ПО ВСЕМУ КУРСУ. ОХВАТИ РАЗНЫЕ АСПЕКТЫ.\n`;
    }

    return context;
  };

  const startSimulator = async (course: Course, lessonId?: string) => {
    setSelectedCourse(course);
    setSelectedLessonId(lessonId || null);
    setIsLoading(true);
    setMessages([]);
    setTurnCount(0);
    try {
      const context = buildRichContext(course, lessonId);
      const response = await aiService.trainingTutor("Начни тренировку. Представься и задай первую сложную рабочую ситуацию, связанную с темами этого курса.", context, [], settings?.tutorPrompt);
      setMessages([{ role: 'model', parts: [{ text: response || "Привет! Давай начнем тренировку." }] }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !selectedCourse) return;

    const userText = input.trim();
    const newMessages = [...messages, { role: 'user' as const, parts: [{ text: userText }] }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    
    const nextTurnCount = turnCount + 1;
    setTurnCount(nextTurnCount);

    try {
      const context = buildRichContext(selectedCourse, selectedLessonId);
      const history = messages.slice(-20);

      // On the 3rd turn, tell AI to wrap up — but we finish regardless of SUCCESS keyword
      const finalHint = nextTurnCount >= 3
        ? "\n[СИСТЕМНОЕ: Это последний ход тренировки. Подведи итог ответа ученика и заверши сессию.]"
        : "";

      const responseRaw = await aiService.trainingTutor(userText + finalHint, context, history, settings?.tutorPrompt);

      const cleanResponse = (responseRaw || "")
        .replace(/success/gi, '')
        .split('\n').filter(line => line.trim()).join('\n')
        .trim();

      const updatedMessages: { role: 'user' | 'model', parts: { text: string }[] }[] = [
        ...newMessages as any,
        { role: 'model', parts: [{ text: cleanResponse }] }
      ];
      setMessages(updatedMessages);

      // Finish after exactly 3 user turns OR if AI explicitly signals success
      const isFinishing = nextTurnCount >= 3 || responseRaw.toLowerCase().includes('success');
      if (isFinishing) {
        await handleFinishWithResponse(cleanResponse, context, updatedMessages);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: "Ошибка связи с наставником." }] }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinishWithResponse = async (lastText: string, context: string, fullHistory: any[]) => {
    setIsLoading(true);
    try {
      // evaluateSimulatorSession never throws — has built-in fallback
      const evalResult = await aiService.evaluateSimulatorSession(fullHistory, context);
      setEvaluation(evalResult);
      setIsSuccess(true);

      const currentUser = user || JSON.parse(localStorage.getItem('academy_user') || '{}');
      if (currentUser.id && selectedCourse) {
        try {
          await contentService.saveSimulatorSession({
            userId: currentUser.id,
            courseId: selectedCourse.id,
            lessonId: selectedLessonId || '',
            score: evalResult.score,
            feedback: evalResult.feedback,
            timestamp: new Date().toISOString(),
            chatHistory: fullHistory
          });
          if (onRefreshUser) onRefreshUser();
        } catch (saveErr) {
          console.warn('Session save failed (non-critical):', saveErr);
        }
      }
    } catch (e) {
      console.error('Finish error:', e);
      // Still show completion screen with fallback evaluation
      setEvaluation({ score: 70, feedback: 'Тренировка завершена. Результат сохранён.' });
      setIsSuccess(true);
    } finally {
      setIsLoading(false);
    }
  };

  if (!selectedCourse) {
    return (
      <div className="flex-1 p-10 bg-[#F5F7FA]">
        <div className="max-w-4xl mx-auto">
          <header className="mb-12">
            <h1 className="text-4xl font-display font-black uppercase tracking-tight text-[#002D57]">Тренажер ситуаций</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-4">Выберите курс для отработки навыков в режиме диалога</p>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {courses.filter(c => c.hasSimulator !== false).map(course => (
              <button
                key={course.id}
                onClick={() => setSelectedCourse(course)}
                className="bg-white p-10 rounded-[48px] border border-gray-100 shadow-sm hover:shadow-xl transition-all text-left flex items-center justify-between group"
              >
                <div className="flex items-center gap-6">
                   <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center text-[#002D57] group-hover:bg-[#002D57] group-hover:text-white transition-all">
                      <Zap size={24} />
                   </div>
                   <div>
                      <h3 className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">{course.title}</h3>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-1">{course.category}</p>
                   </div>
                </div>
                <ChevronRight size={24} className="text-gray-200 group-hover:text-[#00A3FF] transition-all" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If course selected but no lesson (and course has lessons), show lesson selection OR standard course training
  if (selectedCourse && !selectedLessonId && !messages.length && !isLoading) {
    return (
      <div className="flex-1 p-10 bg-[#F5F7FA]">
        <div className="max-w-4xl mx-auto">
          <header className="mb-12 flex items-center gap-6">
            <button onClick={() => setSelectedCourse(null)} className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-gray-400 hover:text-[#002D57] transition-all border border-gray-100">
               <X size={20} />
            </button>
            <div>
              <h1 className="text-4xl font-display font-black uppercase tracking-tight text-[#002D57]">{selectedCourse.title}</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#00A3FF] mt-2">Выберите уровень детализации тренировки</p>
            </div>
          </header>
          
          <div className="grid grid-cols-1 gap-4">
             <button 
                onClick={() => startSimulator(selectedCourse)}
                className="bg-[#002D57] p-10 rounded-[40px] text-white shadow-xl hover:bg-[#00A3FF] transition-all text-left group"
             >
                <h3 className="text-xl font-display font-black uppercase tracking-tight mb-2">Общая тренировка по курсу</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Отработка общих концепций и стратегий</p>
             </button>
             
             {selectedCourse.lessons.map(lesson => (
               <button 
                key={lesson.id}
                onClick={() => startSimulator(selectedCourse, lesson.id)}
                className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:border-[#002D57] transition-all text-left flex items-center justify-between group"
               >
                 <div>
                    <h3 className="text-lg font-display font-black uppercase tracking-tight text-[#002D57]">{lesson.title}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-300 mt-1">Отработка конкретной темы урока</p>
                 </div>
                 <ChevronRight size={20} className="text-gray-200 group-hover:text-[#00A3FF] transition-all" />
               </button>
             ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-10 bg-ibox-bg flex flex-col h-full">
      <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col">
        <header className="mb-10 flex items-center justify-between">
          <div>
             <h1 className="text-4xl font-display font-black uppercase tracking-tight mb-2">AI Тренажер</h1>
             <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Тренажер для отработки навыков</p>
          </div>
          <div className="flex items-center gap-4">
             <p className="text-[10px] font-black uppercase tracking-widest text-[#00A3FF]">Ход {turnCount} из 3</p>
             <button 
               onClick={() => { setSelectedCourse(null); setSelectedLessonId(null); setMessages([]); setIsSuccess(false); }}
              className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-300 hover:text-red-500 transition-all border border-gray-100"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Result screen — natural height block, parent overflow-y-auto handles scroll */}
        {isSuccess ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`rounded-[40px] shadow-xl mb-8 text-white text-center px-12 pt-16 pb-12 ${evaluation && evaluation.score >= 70 ? 'bg-green-500' : 'bg-orange-500'}`}
          >
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-8 shadow-2xl relative">
              {evaluation && evaluation.score >= 70
                ? <Zap size={48} className="text-green-500" fill="currentColor" />
                : <X size={48} className="text-orange-500" />}
              <div className="absolute -right-4 -top-4 bg-[#002D57] text-white w-14 h-14 rounded-full flex items-center justify-center font-display font-black text-xl shadow-xl">
                {evaluation?.score ?? 0}
              </div>
            </div>

            <h2 className="text-5xl font-display font-black uppercase mb-8 leading-tight">
              {evaluation && evaluation.score >= 70 ? 'Успех!' : 'Нужно закрепить'}
            </h2>

            <p className="text-base font-medium mb-10 opacity-95 leading-relaxed">
              {evaluation?.feedback || (evaluation && evaluation.score >= 70
                ? 'Тема усвоена. Отличная работа!'
                : 'Попробуйте ещё раз, чтобы лучше запомнить материал.')}
            </p>

            <div className="flex gap-4 justify-center flex-wrap">
              <button
                onClick={() => {
                  setIsSuccess(false);
                  setEvaluation(null);
                  startSimulator(selectedCourse!, selectedLessonId || undefined);
                }}
                className="bg-white text-gray-800 px-10 py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl hover:bg-gray-100 transition-all"
              >
                Попробовать заново
              </button>
              <button
                onClick={() => {
                  setSelectedCourse(null);
                  setSelectedLessonId(null);
                  setMessages([]);
                  setIsSuccess(false);
                }}
                className="bg-[#002D57] text-white px-10 py-5 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl hover:bg-[#003D70] transition-all"
              >
                В каталог
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="flex-1 bg-white rounded-[40px] border border-gray-100 shadow-xl overflow-hidden flex flex-col mb-8">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-6 rounded-[24px] text-sm leading-relaxed font-medium shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-ibox-action text-white rounded-tr-none'
                      : 'bg-ibox-bg text-ibox-blue rounded-tl-none'
                  }`}>
                    {msg.role === 'user' ? (
                      msg.parts[0].text
                    ) : (
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.parts[0].text.replace('[SUCCESS]', '')}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-ibox-bg p-6 rounded-[24px] rounded-tl-none">
                    <div className="flex gap-1">
                      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 bg-ibox-blue/20 rounded-full" />
                      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 bg-ibox-blue/20 rounded-full" />
                      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 bg-ibox-blue/20 rounded-full" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-10 border-t border-gray-100 bg-gray-50/50">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ваш ответ..."
                  className="w-full bg-white rounded-[24px] py-6 pl-10 pr-20 outline-none shadow-sm border border-gray-100 font-bold focus:ring-4 focus:ring-ibox-action/5 transition-all text-lg"
                />
                <button
                  onClick={handleSend}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-ibox-blue text-white rounded-2xl flex items-center justify-center hover:bg-ibox-action transition-all shadow-lg"
                >
                  <Send size={20} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
