import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, HelpCircle, Trophy, X, XCircle, Send, Zap, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Course, UserProfile } from '../types';
import { contentService } from '../services/contentService';
import { aiService } from '../services/aiService';
import ScormPlayer from './ScormPlayer';

interface CoursePlayerProps {
  course: Course;
  user: UserProfile;
  onClose: () => void;
}

// Minimum percentage required to pass a course quiz
const PASS_THRESHOLD = 80;

// ─── Shared: build rich AI context from course data ───────────────────────────
function buildRichContext(course: Course): string {
  let ctx = `--- КУРС: ${course.title} ---\nОПИСАНИЕ: ${course.description}\n\n`;
  ctx += 'СОДЕРЖАНИЕ УРОКОВ:\n';
  course.lessons.forEach((l, i) => {
    ctx += `УРОК ${i + 1}: ${l.title}\n${l.content}\n`;
    if (l.aiKnowledge) ctx += `БАЗА ЗНАНИЙ: ${l.aiKnowledge}\n`;
    ctx += '\n';
  });
  return ctx;
}

// ─── Inline simulator (embedded inside CoursePlayer after test) ───────────────
function EmbeddedSimulator({
  course, user, quizScore,
  onComplete,
}: {
  course: Course;
  user: UserProfile;
  quizScore: number;
  onComplete: (simScore: number, feedback: string) => void;
}) {
  const maxTurns = course.simulatorTurns ?? 3;
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; parts: { text: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [settings, setSettings] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => { contentService.getAISettings().then(setSettings).catch(() => {}); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  // Auto-start once settings loaded
  useEffect(() => {
    if (startedRef.current || isLoading) return;
    startedRef.current = true;
    setIsLoading(true);
    const context = buildRichContext(course);
    aiService.trainingTutor(
      'Начни тренировку. Представься и задай первую конкретную рабочую ситуацию по материалам этого курса.',
      context, [], settings?.tutorPrompt
    ).then(response => {
      setMessages([{ role: 'model', parts: [{ text: response || 'Привет! Начнём тренировку.' }] }]);
    }).catch(() => {
      setMessages([{ role: 'model', parts: [{ text: 'Привет! Начнём тренировку по курсу.' }] }]);
    }).finally(() => setIsLoading(false));
  }, [settings]);  // eslint-disable-line

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    const next = [...messages, { role: 'user' as const, parts: [{ text }] }];
    setMessages(next);
    setInput('');
    setIsLoading(true);
    const nextTurn = turnCount + 1;
    setTurnCount(nextTurn);

    try {
      const context = buildRichContext(course);
      const finalHint = nextTurn >= maxTurns
        ? '\n[СИСТЕМНОЕ: Это последний ход. Подведи итог и заверши сессию.]' : '';
      const raw = await aiService.trainingTutor(text + finalHint, context, messages.slice(-20), settings?.tutorPrompt);
      const clean = (raw || '').replace(/\bsuccess\b/gi, '').split('\n').filter(l => l.trim()).join('\n').trim();
      const updated = [...next, { role: 'model' as const, parts: [{ text: clean }] }];
      setMessages(updated);

      if (nextTurn >= maxTurns || raw.toLowerCase().includes('success')) {
        setIsLoading(true);
        const evalResult = await aiService.evaluateSimulatorSession(updated, context).catch(() => ({ score: 70, feedback: 'Тренировка завершена.' }));
        // Save session
        if (user.id) {
          contentService.saveSimulatorSession({
            userId: user.id, courseId: course.id, lessonId: '',
            score: evalResult.score, feedback: evalResult.feedback,
            timestamp: new Date().toISOString(), chatHistory: updated,
          }).catch(() => {});
        }
        onComplete(evalResult.score, evalResult.feedback);
      }
    } catch {
      setMessages(p => [...p, { role: 'model', parts: [{ text: 'Ошибка связи. Попробуй ещё раз.' }] }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div key="embedded-sim" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto px-10 py-10 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-display font-black uppercase tracking-tight text-[#002D57]">ИИ Тренажёр</h2>
          <p className="text-[9px] font-black uppercase tracking-widest text-[#00A3FF] mt-1">
            Обязательный · ход {Math.min(turnCount + 1, maxTurns)} из {maxTurns}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: maxTurns }, (_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-all ${i < turnCount ? 'bg-[#002D57]' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>

      {/* Quiz score badge */}
      <div className="mb-4 flex items-center gap-3 bg-green-50 border border-green-100 rounded-2xl px-5 py-3">
        <CheckCircle size={16} className="text-green-500 shrink-0" />
        <p className="text-xs font-black uppercase tracking-widest text-green-700">Тест пройден · {quizScore}% · Теперь закрепи знания на практике</p>
      </div>

      {/* Chat */}
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-xl overflow-hidden flex flex-col" style={{ height: '52vh', minHeight: 380 }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-5 py-4 rounded-[20px] text-sm leading-relaxed font-medium shadow-sm ${
                msg.role === 'user' ? 'bg-[#002D57] text-white rounded-tr-none' : 'bg-[#F5F7FA] text-[#002D57] rounded-tl-none'
              }`}>
                {msg.role === 'user' ? msg.parts[0].text : (
                  <div className="markdown-content">
                    <ReactMarkdown>{msg.parts[0].text.replace('[SUCCESS]', '')}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-[#F5F7FA] px-5 py-4 rounded-[20px] rounded-tl-none">
                <div className="flex gap-1.5">
                  {[0, 0.2, 0.4].map((d, i) => (
                    <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: d }}
                      className="w-2 h-2 bg-[#002D57]/30 rounded-full" />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="relative">
            <input
              type="text" value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ваш ответ..."
              disabled={isLoading}
              className="w-full bg-white rounded-2xl py-4 pl-5 pr-14 outline-none shadow-sm border border-gray-100 font-medium text-sm focus:ring-2 focus:ring-[#002D57]/10 transition-all disabled:opacity-50"
            />
            <button onClick={handleSend} disabled={isLoading || !input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 bg-[#002D57] text-white rounded-xl flex items-center justify-center hover:bg-[#00A3FF] transition-all disabled:opacity-30">
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Course player component ──────────────────────────────────────────────────
export default function CoursePlayer({ course, user, onClose }: CoursePlayerProps) {
  // ── All hooks first (Rules of Hooks — never call hooks after a return) ──
  const [currentLessonIdx, setCurrentLessonIdx] = useState(0);
  const [quizType, setQuizType] = useState<'lesson' | 'final' | null>(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState<{ q: string; a: string }[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  // Simulator phase: 'off' = not required, 'pending' = waiting to start, 'running' = chat active, 'done' = completed
  const [simPhase, setSimPhase] = useState<'off' | 'pending' | 'running' | 'done'>('off');
  const [simScore, setSimScore] = useState(0);
  const [simFeedback, setSimFeedback] = useState('');

  // ── Fullscreen overlay state (works inside any iframe / Bitrix Mobile) ──
  const [fullscreenContent, setFullscreenContent] = useState<{
    url: string;
    type: 'video' | 'iframe' | 'image' | 'audio';
    iframeSrc?: string;
  } | null>(null);

  const showQuiz = quizType !== null;
  const testMode = course.testMode ?? 'final';
  // A course-level SCORM package with no manual lessons becomes a single SCORM lesson.
  const lessons = (course.lessons && course.lessons.length > 0)
    ? course.lessons
    : (course.scormPackageId
        ? [{ id: 'scorm-main', title: course.title || 'Курс', content: '', scormPackageId: course.scormPackageId }]
        : []);
  const usesBank = !!course.testConfig?.questionBankId;
  const hasFinalQuiz = (testMode === 'final' || testMode === 'both') &&
    ((course.testConfig?.questions?.length ?? 0) > 0 || usesBank);
  const hasPerLessonQuiz = testMode === 'per_lesson' || testMode === 'both';

  // When the final test draws from a Moodle bank, fetch & randomize the questions.
  const [bankQuestions, setBankQuestions] = useState<typeof course.testConfig.questions | null>(null);
  useEffect(() => {
    const bankId = course.testConfig?.questionBankId;
    if (!bankId) { setBankQuestions(null); return; }
    contentService.getQuestionBank(bankId).then((bank: any) => {
      const all = bank?.questions || [];
      const shuffled = [...all].sort(() => Math.random() - 0.5);
      const n = course.testConfig?.randomCount || shuffled.length;
      setBankQuestions(shuffled.slice(0, Math.max(1, n)));
    }).catch(() => setBankQuestions([]));
  }, [course.testConfig?.questionBankId, course.testConfig?.randomCount]);

  const finalQuestions = usesBank ? (bankQuestions ?? []) : (course.testConfig?.questions ?? []);

  const activeQuestions = quizType === 'lesson'
    ? (lessons[currentLessonIdx]?.testConfig?.questions ?? [])
    : finalQuestions;

  const allAnswered = activeQuestions.length > 0 &&
    activeQuestions.every((_, idx) => Number.isInteger(selectedAnswers[idx]));

  // Resume from last incomplete lesson
  useEffect(() => {
    if (!user.id || !course.id || lessons.length === 0) return;
    contentService.getCourseProgress(user.id, course.id)
      .then(progress => {
        if (!progress) return;
        const firstIncomplete = lessons.findIndex(l =>
          !progress.lessons.find(pl => pl.lessonId === l.id && pl.completed)
        );
        if (firstIncomplete > 0) setCurrentLessonIdx(firstIncomplete);
      })
      .catch(() => {});
  }, [course.id, user.id]);

  // Check if current lesson is already completed
  useEffect(() => {
    const currentLesson = lessons[currentLessonIdx];
    if (!user.id || !course.id || !currentLesson) return;
    contentService.getCourseProgress(user.id, course.id)
      .then(p => {
        const done = p?.lessons.find(l => l.lessonId === currentLesson.id)?.completed || false;
        setIsCompleted(done);
      })
      .catch(() => {});
  }, [currentLessonIdx, course.id, user.id]);

  // ── Guard: no lessons ─────────────────────────────────────────────────────
  if (lessons.length === 0) {
    return (
      <div className="fixed inset-0 bg-white z-[999] flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-500 mb-4">В этом курсе пока нет уроков</p>
          <button onClick={onClose} className="px-8 py-3 bg-[#002D57] text-white rounded-xl">Вернуться</button>
        </div>
      </div>
    );
  }

  const currentLesson = lessons[currentLessonIdx];

  // ── Helpers ───────────────────────────────────────────────────────────────
  const handleMarkAsDone = async () => {
    if (user.id && course.id && currentLesson) {
      try {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, lessons.length);
        setIsCompleted(true);
      } catch (e) {}
    }
  };

  const getEmbedUrl = (rawUrl: string) => {
    if (rawUrl.includes('docs.google.com/presentation/d/')) {
      const docId = rawUrl.split('/d/')[1].split('/')[0];
      return `https://docs.google.com/presentation/d/${docId}/embed?start=false&loop=false&delayms=3000&rm=minimal`;
    }
    if (rawUrl.includes('drive.google.com')) {
      let driveId = '';
      if (rawUrl.includes('/d/')) driveId = rawUrl.split('/d/')[1].split('/')[0];
      else if (rawUrl.includes('id=')) driveId = rawUrl.split('id=')[1].split('&')[0];
      if (driveId) return `https://drive.google.com/file/d/${driveId}/preview`;
    }
    if (rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be')) {
      let videoId = '';
      if (rawUrl.includes('v=')) videoId = rawUrl.split('v=')[1].split('&')[0];
      else if (rawUrl.includes('shorts/')) videoId = rawUrl.split('shorts/')[1].split('?')[0];
      else if (rawUrl.includes('embed/')) videoId = rawUrl.split('embed/')[1].split('?')[0];
      else videoId = rawUrl.split('?')[0].split('/').pop() || '';
      return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0`;
    }
    // Office formats + SharePoint
    const pathLower = rawUrl.split('?')[0].toLowerCase();
    if (pathLower.match(/\.(pptx|ppt|docx|xlsx)$/) || rawUrl.includes('sharepoint.com')) {
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  };

  // ── Detect media type from any URL (path ext or ?filename= param) ────────
  const detectFileType = (url: string): 'video' | 'audio' | 'image' | 'pdf' | 'office' | 'embed' => {
    if (!url) return 'embed';
    // Special embed services — handled by getEmbedUrl, keep as embed
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'embed';
    if (url.includes('drive.google.com')) return 'embed';
    if (url.includes('docs.google.com')) return 'embed';
    if (url.includes('sharepoint.com')) return 'embed';

    // Try to extract extension from ?filename=xxx.ext or path
    let ext = '';
    try {
      const parsed = new URL(url);
      const fn = parsed.searchParams.get('filename') || parsed.searchParams.get('name') || '';
      if (fn) {
        ext = fn.split('.').pop()?.toLowerCase() || '';
      } else {
        ext = parsed.pathname.split('.').pop()?.toLowerCase() || '';
      }
    } catch {
      ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
    }

    if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'm4v', 'ogv', '3gp'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['pptx', 'ppt', 'docx', 'doc', 'xlsx', 'xls'].includes(ext)) return 'office';
    return 'embed';
  };

  const isYandexUrl = (url: string) =>
    url.includes('disk.yandex.') || url.includes('yandex.ru/d/') ||
    url.includes('yandex.ru/i/') || url.includes('yadi.sk');

  // ── MediaBlock: resolves URL, detects type, renders with fullscreen button ──
  const MediaBlock = ({ rawUrl }: { rawUrl: string }) => {
    const [resolvedUrl, setResolvedUrl] = useState('');
    const [fileType, setFileType] = useState<'video' | 'audio' | 'image' | 'pdf' | 'office' | 'embed'>('embed');
    const [resolving, setResolving] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!rawUrl) { setResolving(false); return; }
      if (isYandexUrl(rawUrl)) {
        setResolving(true); setError('');
        fetch(`/api/resolve-public?url=${encodeURIComponent(rawUrl)}`)
          .then(r => r.json())
          .then(d => {
            if (d.url) {
              setResolvedUrl(d.url);
              const t = detectFileType(d.url);
              setFileType(t !== 'embed' ? t : detectFileType(rawUrl));
            } else {
              setError('Не удалось получить ссылку на файл');
              setResolvedUrl(rawUrl); setFileType('embed');
            }
          })
          .catch(() => { setError('Ошибка при загрузке файла с Яндекс Диска'); setResolvedUrl(rawUrl); setFileType('embed'); })
          .finally(() => setResolving(false));
      } else {
        setResolvedUrl(rawUrl);
        setFileType(detectFileType(rawUrl));
        setResolving(false);
      }
    }, [rawUrl]);

    // Universal fullscreen button — always visible, works on all content
    const FsBtn = ({ onFs, dark }: { onFs: () => void; dark?: boolean }) => (
      <button
        onClick={onFs}
        title="На весь экран"
        className={`absolute bottom-3 right-3 z-20 flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide touch-manipulation shadow-lg transition-all active:scale-95 ${
          dark
            ? 'bg-black/60 hover:bg-black/80 text-white border border-white/10'
            : 'bg-white/95 hover:bg-white text-[#002D57] border border-gray-200'
        }`}
      >
        <Maximize2 size={13} />
        <span>Полный экран</span>
      </button>
    );

    if (resolving) return (
      <div className="w-full h-full flex items-center justify-center bg-[#F5F7FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-[#002D57]/20 border-t-[#002D57] rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Загрузка файла...</p>
        </div>
      </div>
    );

    if (!resolvedUrl) return null;

    // ── Video ──────────────────────────────────────────────────────────────
    if (fileType === 'video') {
      return (
        <div className="relative w-full h-full bg-black">
          <video
            src={resolvedUrl}
            controls
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
            onError={() => setError('Не удалось воспроизвести видео')}
          />
          <FsBtn dark onFs={() => setFullscreenContent({ url: resolvedUrl, type: 'video' })} />
        </div>
      );
    }

    // ── Audio ──────────────────────────────────────────────────────────────
    if (fileType === 'audio') {
      return (
        <div className="relative w-full h-full flex items-center justify-center bg-[#F5F7FA]">
          <audio src={resolvedUrl} controls className="w-3/4" onError={() => setError('Не удалось воспроизвести аудио')} />
          <FsBtn onFs={() => setFullscreenContent({ url: resolvedUrl, type: 'audio' })} />
        </div>
      );
    }

    // ── Image ──────────────────────────────────────────────────────────────
    if (fileType === 'image') {
      return (
        <div className="relative w-full h-full flex items-center justify-center bg-[#F5F7FA]">
          <img src={resolvedUrl} alt="Изображение" className="max-w-full max-h-full object-contain" onError={() => setError('Не удалось загрузить изображение')} />
          <FsBtn onFs={() => setFullscreenContent({ url: resolvedUrl, type: 'image' })} />
        </div>
      );
    }

    // ── Embed URL transform (YouTube, Google Drive, etc.) ─────────────────
    const embedUrl = getEmbedUrl(resolvedUrl);
    const isEmbedService = embedUrl !== resolvedUrl;
    const needsProxy = !isEmbedService && isYandexUrl(rawUrl);
    const iframeSrc = needsProxy ? `/api/proxy-media?url=${encodeURIComponent(resolvedUrl)}` : embedUrl;

    // ── Office files → Microsoft Office Online ────────────────────────────
    if (fileType === 'office' && !isEmbedService) {
      const officeSrc = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resolvedUrl)}`;
      return (
        <div className="relative w-full h-full bg-white">
          <iframe src={officeSrc} className="absolute inset-0 w-full h-full border-none" allowFullScreen title="Office Viewer" />
          <FsBtn onFs={() => setFullscreenContent({ url: resolvedUrl, type: 'iframe', iframeSrc: officeSrc })} />
        </div>
      );
    }

    // ── Generic iframe (PDF, YouTube, Google Slides, Yandex proxy…) ──────
    return (
      <div className="relative w-full h-full bg-white">
        {error && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-red-50 border-b border-red-200 px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-red-600">{error}</span>
            <a href={resolvedUrl} target="_blank" rel="noreferrer" className="text-xs text-[#002D57] underline ml-auto">Открыть в новой вкладке</a>
          </div>
        )}
        <iframe
          src={iframeSrc}
          className="absolute inset-0 w-full h-full border-none"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Content Player"
        />
        <FsBtn onFs={() => setFullscreenContent({ url: resolvedUrl, type: 'iframe', iframeSrc })} />
      </div>
    );
  };

  const handleLessonChange = (idx: number) => {
    setCurrentLessonIdx(idx);
    setQuizType(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const completeCourseWithoutQuiz = async () => {
    try {
      if (user.id && course.id) {
        await contentService.saveResult({ userId: user.id, courseId: course.id, score: 100, progress: 100, timestamp: new Date().toISOString() });
      }
    } catch (e) {}
    onClose();
  };

  const handleNext = async () => {
    try {
      if (user.id && course.id && currentLesson) {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, lessons.length);
      }
    } catch (e) {}

    const lessonQs = lessons[currentLessonIdx]?.testConfig?.questions ?? [];
    const isLastLesson = currentLessonIdx >= lessons.length - 1;

    if (hasPerLessonQuiz && lessonQs.length > 0) {
      setSelectedAnswers([]);
      setQuizType('lesson');
      return;
    }

    if (!isLastLesson) {
      setCurrentLessonIdx(prev => prev + 1);
    } else if (hasFinalQuiz) {
      setSelectedAnswers([]);
      setQuizType('final');
    } else {
      await completeCourseWithoutQuiz();
    }
  };

  const handleQuizSubmit = async () => {
    const total = activeQuestions.length;
    let correct = 0;
    const wrong: { q: string; a: string }[] = [];
    activeQuestions.forEach((q, idx) => {
      if (Number(selectedAnswers[idx]) === Number(q.correctAnswer)) {
        correct++;
      } else {
        // Record which question was missed + the chosen answer (never the correct one).
        wrong.push({ q: q.question, a: q.options[selectedAnswers[idx]] ?? 'Нет ответа' });
      }
    });
    const finalScore = total > 0 ? Math.round((correct / total) * 100) : 100;

    if (quizType === 'lesson') {
      setQuizType(null);
      setSelectedAnswers([]);
      const isLastLesson = currentLessonIdx >= lessons.length - 1;
      if (!isLastLesson) {
        setCurrentLessonIdx(prev => prev + 1);
      } else if (hasFinalQuiz) {
        setSelectedAnswers([]);
        setQuizType('final');
      } else {
        await completeCourseWithoutQuiz();
      }
      return;
    }

    // Final quiz
    setScore(finalScore);
    setMistakes(wrong);
    setQuizFinished(true);

    const simRequired = course.simulatorMode === 'required' && finalScore >= PASS_THRESHOLD;
    if (simRequired) setSimPhase('pending');

    try {
      if (user.id && course.id) {
        const lastLessonId = lessons[lessons.length - 1].id;
        if (finalScore >= PASS_THRESHOLD) {
          await contentService.updateLessonProgress(user.id, course.id, lastLessonId, true, lessons.length);
          await contentService.saveResult({ userId: user.id, courseId: course.id, score: finalScore, progress: simRequired ? 50 : 100, mistakes: wrong, timestamp: new Date().toISOString() });
        } else {
          await contentService.saveResult({ userId: user.id, courseId: course.id, score: finalScore, progress: 50, mistakes: wrong, timestamp: new Date().toISOString() });
        }
      }
    } catch (e) {}
  };

  // Called when inline simulator finishes
  const handleSimComplete = async (sScore: number, sFeedback: string) => {
    setSimScore(sScore);
    setSimFeedback(sFeedback);
    setSimPhase('done');
    // Update result to 100% progress once sim is done
    try {
      if (user.id && course.id) {
        await contentService.saveResult({ userId: user.id, courseId: course.id, score, progress: 100, timestamp: new Date().toISOString() });
      }
    } catch (e) {}
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-white z-[999] flex flex-col">

      {/* ── Universal fullscreen overlay — absolute inset-0 inside CoursePlayer ── */}
      {/* Works in Bitrix iframe and Bitrix Mobile because CoursePlayer is already  */}
      {/* fixed inset-0 (= viewport), so this overlay fills the entire viewport.    */}
      {fullscreenContent && (
        <div
          className="absolute inset-0 z-50 bg-black flex flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* Close button */}
          <button
            onClick={() => setFullscreenContent(null)}
            title="Свернуть"
            className="absolute top-4 right-4 z-10 flex items-center gap-1.5 pl-2.5 pr-3 py-2 bg-black/60 hover:bg-black/80 active:bg-black text-white rounded-xl text-[10px] font-black uppercase tracking-wide touch-manipulation shadow-lg"
          >
            <Minimize2 size={14} />
            <span>Свернуть</span>
          </button>
          <div className="flex-1 relative overflow-hidden">
            {/* Video */}
            {fullscreenContent.type === 'video' && (
              <video
                src={fullscreenContent.url}
                controls autoPlay playsInline
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
            {/* Image */}
            {fullscreenContent.type === 'image' && (
              <img
                src={fullscreenContent.url}
                alt=""
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
            {/* Audio */}
            {fullscreenContent.type === 'audio' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-[#001830]">
                <div className="w-24 h-24 bg-[#00A3FF]/20 rounded-[32px] flex items-center justify-center">
                  <Zap size={48} className="text-[#00A3FF]" />
                </div>
                <audio src={fullscreenContent.url} controls autoPlay className="w-3/4 max-w-md" />
              </div>
            )}
            {/* Iframe: PDF / Google Slides / YouTube / Office / Yandex proxy */}
            {fullscreenContent.type === 'iframe' && (
              <iframe
                src={fullscreenContent.iframeSrc || fullscreenContent.url}
                className="absolute inset-0 w-full h-full border-none"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                title="Полный экран"
              />
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <header className="h-14 sm:h-20 border-b border-gray-100 px-4 sm:px-10 flex items-center justify-between shrink-0 gap-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1 sm:gap-2 font-bold text-gray-400 hover:text-[#002D57] transition-colors text-xs sm:text-sm shrink-0"
        >
          <ChevronLeft size={18} />
          <span className="hidden sm:inline">Назад к курсам</span>
        </button>
        <div className="text-center min-w-0 flex-1">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-0.5 hidden sm:block">{course.category}</p>
          <h3 className="font-display font-black text-[#002D57] tracking-tight uppercase leading-none text-xs sm:text-sm truncate">{course.title}</h3>
        </div>
        <div className="w-20 sm:w-40 h-1.5 sm:h-2 bg-gray-100 rounded-full overflow-hidden shrink-0">
          <div
            className="h-full bg-[#00A3FF] transition-all duration-500"
            style={{ width: `${((currentLessonIdx + (showQuiz ? 1 : 0)) / (lessons.length + (hasFinalQuiz ? 1 : 0))) * 100}%` }}
          />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop sidebar — lessons list */}
        <aside className="w-72 border-r border-gray-100 bg-gray-50/10 overflow-y-auto p-6 hidden lg:block shrink-0">
          <h4 className="text-[10px] uppercase tracking-widest font-black text-[#002D57]/20 mb-6 font-display">Содержание</h4>
          <div className="space-y-2">
            {lessons.map((lesson, idx) => (
              <button
                key={lesson.id || idx}
                onClick={() => handleLessonChange(idx)}
                className={`w-full flex items-start gap-3 p-4 rounded-2xl text-left transition-all ${
                  quizType === null && currentLessonIdx === idx
                    ? 'bg-white shadow-xl text-[#002D57] font-bold border border-gray-50'
                    : 'text-gray-400 opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-display font-black text-xs shrink-0 ${quizType === null && currentLessonIdx === idx ? 'bg-[#002D57] text-white' : 'bg-gray-100'}`}>
                  {idx + 1}
                </div>
                <p className="text-xs font-black uppercase tracking-tight line-clamp-2 pt-1">{lesson.title}</p>
              </button>
            ))}
            {hasFinalQuiz && (
              <button
                onClick={() => { setSelectedAnswers([]); setQuizType('final'); }}
                className={`w-full flex items-start gap-3 p-4 rounded-2xl text-left transition-all ${
                  quizType === 'final'
                    ? 'bg-white shadow-xl text-[#002D57] font-bold border border-gray-50'
                    : 'text-gray-400 opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${quizType === 'final' ? 'bg-[#00A3FF] text-white' : 'bg-gray-100'}`}>
                  <HelpCircle size={13} />
                </div>
                <div className="pt-1">
                  <p className="text-xs font-black uppercase tracking-tight">Итоговый тест</p>
                  <p className="text-[8px] opacity-60 font-black uppercase tracking-widest mt-0.5">Обязательно</p>
                </div>
              </button>
            )}
          </div>
        </aside>

        {/* Mobile lesson selector strip (shown only on < lg) */}
        <div className="lg:hidden flex-none w-full border-b border-gray-100 bg-gray-50/50 overflow-x-auto absolute top-14 left-0 right-0 z-10 hidden"
             style={{ display: 'none' }} />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-white flex flex-col">
          {/* Mobile/tablet lesson picker */}
          {lessons.length > 1 && (
            <div className="lg:hidden flex gap-2 px-4 py-2.5 overflow-x-auto shrink-0 border-b border-gray-100 bg-gray-50/60"
                 style={{ WebkitOverflowScrolling: 'touch' }}>
              {lessons.map((lesson, idx) => (
                <button
                  key={lesson.id || idx}
                  onClick={() => handleLessonChange(idx)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap text-[9px] font-black uppercase tracking-wide shrink-0 transition-all ${
                    quizType === null && currentLessonIdx === idx
                      ? 'bg-[#002D57] text-white shadow-md'
                      : 'bg-white border border-gray-200 text-gray-400'
                  }`}
                >
                  <span className="font-display">{idx + 1}</span>
                  <span className="max-w-[80px] truncate">{lesson.title}</span>
                </button>
              ))}
              {hasFinalQuiz && (
                <button
                  onClick={() => { setSelectedAnswers([]); setQuizType('final'); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap text-[9px] font-black uppercase tracking-wide shrink-0 transition-all ${
                    quizType === 'final' ? 'bg-[#00A3FF] text-white' : 'bg-white border border-gray-200 text-gray-400'
                  }`}
                >
                  <HelpCircle size={11} /> Тест
                </button>
              )}
            </div>
          )}

          <AnimatePresence mode="wait">
            {quizType === null ? (
              <motion.article
                key={currentLesson.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto px-4 py-5 sm:px-10 sm:py-10 md:px-16 md:py-12 w-full"
              >
                <h1 className="text-2xl sm:text-4xl font-display font-black uppercase tracking-tight mb-5 sm:mb-10 leading-tight">
                  {currentLesson.title}
                </h1>

                {/* SCORM lesson — plays the package full-size via our runtime */}
                {currentLesson.scormPackageId && !showQuiz && (
                  <div className="relative mb-5 sm:mb-10 overflow-hidden border-2 border-gray-100 shadow-sm sm:shadow-2xl bg-white rounded-2xl sm:rounded-[32px] h-[88vw] min-h-[380px] sm:h-[82vh] sm:min-h-[560px]">
                    <ScormPlayer
                      packageId={currentLesson.scormPackageId}
                      user={user}
                      onComplete={(score) => {
                        if (user.id && course.id && currentLesson) {
                          contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, lessons.length).catch(() => {});
                          if (score != null) {
                            contentService.saveResult({ userId: user.id, courseId: course.id, score, progress: 100, timestamp: new Date().toISOString() }).catch(() => {});
                          }
                        }
                      }}
                    />
                  </div>
                )}

                {/* Media viewer — supports multiple files per lesson */}
                {!currentLesson.scormPackageId && (() => {
                  const urls = (
                    currentLesson.fileUrls?.length ? currentLesson.fileUrls
                    : currentLesson.fileUrl ? [currentLesson.fileUrl]
                    : course.fileUrl ? [course.fileUrl]
                    : []
                  ).filter(u => u?.trim());
                  return urls.length > 0 && !showQuiz ? urls.map((url, i) => (
                    <div key={i} className="mb-5 sm:mb-10 overflow-hidden border-2 border-gray-100 shadow-sm sm:shadow-2xl bg-gray-50 rounded-2xl sm:rounded-[32px] h-[62vw] min-h-[240px] sm:h-[65vh] sm:min-h-[400px]">
                      <MediaBlock rawUrl={url} />
                    </div>
                  )) : null;
                })()}

                <div className="markdown-content max-w-none">
                  <ReactMarkdown>{currentLesson.content}</ReactMarkdown>
                </div>

                <div className="mt-8 sm:mt-16 pt-5 sm:pt-8 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                  <button
                    onClick={() => setCurrentLessonIdx(i => i - 1)}
                    disabled={currentLessonIdx === 0}
                    className="px-5 sm:px-8 py-3 sm:py-4 border border-gray-100 rounded-2xl font-bold disabled:opacity-30 hover:bg-gray-50 transition-all text-xs sm:text-sm flex items-center gap-2"
                  >
                    <ChevronLeft size={15} /> <span className="hidden sm:inline">Предыдущий</span><span className="sm:hidden">Назад</span>
                  </button>

                  <div className="flex gap-2 sm:gap-3 flex-wrap justify-end">
                    <button
                      onClick={handleMarkAsDone}
                      disabled={isCompleted}
                      className={`px-4 sm:px-6 py-3 sm:py-4 rounded-2xl font-bold transition-all flex items-center gap-2 text-xs sm:text-sm ${isCompleted ? 'bg-green-50 text-green-500 border border-green-100' : 'bg-white border border-[#00A3FF] text-[#00A3FF] hover:bg-[#00A3FF]/5'}`}
                    >
                      {isCompleted && <CheckCircle size={14} />}
                      {isCompleted ? 'Изучен' : 'Завершить урок'}
                    </button>

                    <button
                      onClick={handleNext}
                      className="px-5 sm:px-8 py-3 sm:py-4 bg-[#002D57] text-white rounded-2xl font-bold shadow-lg hover:bg-[#00A3FF] transition-all text-xs sm:text-sm flex items-center gap-2"
                    >
                      {currentLessonIdx === lessons.length - 1
                        ? (hasFinalQuiz ? 'К тесту' : 'Завершить курс')
                        : 'Далее'}
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </motion.article>
            ) : !quizFinished ? (
              <motion.div
                key="quiz"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-2xl mx-auto px-4 py-6 sm:px-10 sm:py-12 w-full"
              >
                <h2 className="text-2xl sm:text-4xl font-display font-black uppercase mb-3 sm:mb-4 text-center">
                  {quizType === 'lesson' ? `Тест: ${lessons[currentLessonIdx]?.title}` : 'Итоговый тест'}
                </h2>
                {quizType === 'lesson' && (
                  <p className="text-center text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6 sm:mb-10">Проверка по уроку</p>
                )}
                <div className="space-y-12">
                  {activeQuestions.map((q, qIdx) => (
                    <div key={qIdx} className="space-y-6">
                      <p className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">{qIdx + 1}. {q.question}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {q.options.map((opt, oIdx) => (
                          <button
                            key={oIdx}
                            onClick={() => { const a = [...selectedAnswers]; a[qIdx] = oIdx; setSelectedAnswers(a); }}
                            className={`p-6 rounded-[32px] text-left font-bold border-2 transition-all ${selectedAnswers[qIdx] === oIdx ? 'bg-[#002D57] border-[#002D57] text-white shadow-xl' : 'bg-[#F5F7FA] border-[#F5F7FA] hover:border-gray-200'}`}
                          >
                            <div className="flex items-center gap-4">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-display text-xs ${selectedAnswers[qIdx] === oIdx ? 'bg-white/10' : 'bg-white shadow-sm'}`}>
                                {String.fromCharCode(65 + oIdx)}
                              </div>
                              <span className="text-sm">{opt}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleQuizSubmit}
                  disabled={!allAnswered}
                  className="w-full mt-8 sm:mt-20 py-5 sm:py-8 bg-[#002D57] text-white rounded-[32px] sm:rounded-[40px] font-display font-black uppercase tracking-[0.15em] sm:tracking-[0.2em] shadow-xl sm:shadow-2xl disabled:opacity-30 hover:bg-[#00A3FF] transition-all text-sm sm:text-base"
                >
                  {quizType === 'lesson' ? 'Продолжить' : 'Завершить курс'}
                </button>
              </motion.div>
            ) : simPhase === 'pending' ? (
              /* ── Transition: quiz passed, simulator required ── */
              <motion.div key="sim-pending" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="max-w-xl mx-auto py-10 sm:py-20 px-6 sm:px-16 text-center w-full">
                <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-[32px] sm:rounded-[40px] bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-6 sm:mb-10 shadow-xl sm:shadow-2xl">
                  <CheckCircle size={36} />
                </div>
                <h2 className="text-4xl sm:text-5xl font-display font-black uppercase mb-2 sm:mb-3 tracking-tighter text-[#002D57]">{score}%</h2>
                <p className="text-xs font-black uppercase tracking-widest text-green-500 mb-4 sm:mb-6">Тест пройден!</p>
                <p className="text-sm sm:text-base font-bold text-gray-400 mb-8 sm:mb-12 leading-relaxed">
                  Последний шаг — закрепи знания на практике в ИИ-тренажёре. Без него курс не засчитывается.
                </p>
                <button
                  onClick={() => setSimPhase('running')}
                  className="w-full py-5 sm:py-6 bg-[#002D57] text-white rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all flex items-center justify-center gap-3"
                >
                  <Zap size={18} /> Начать тренажёр
                </button>
              </motion.div>

            ) : simPhase === 'running' ? (
              /* ── Inline simulator chat ── */
              <EmbeddedSimulator
                course={course} user={user} quizScore={score}
                onComplete={handleSimComplete}
              />

            ) : simPhase === 'done' ? (
              /* ── Final screen: quiz + sim both done ── */
              <motion.div key="sim-done" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="max-w-xl mx-auto py-8 sm:py-16 px-6 sm:px-16 text-center w-full">
                <div className="w-28 h-28 rounded-[40px] bg-[#002D57] text-white flex items-center justify-center mx-auto mb-10 shadow-2xl">
                  <Trophy size={48} />
                </div>
                <h2 className="text-5xl font-display font-black uppercase mb-3 tracking-tighter text-[#002D57]">Курс завершён!</h2>
                <p className="text-xs font-black uppercase tracking-widest text-[#00A3FF] mb-10">Все этапы пройдены</p>
                <div className="grid grid-cols-2 gap-4 mb-10">
                  <div className="bg-[#F5F7FA] rounded-2xl p-5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Тест</p>
                    <p className="text-3xl font-display font-black text-[#002D57]">{score}%</p>
                  </div>
                  <div className={`rounded-2xl p-5 ${simScore >= 70 ? 'bg-green-50' : 'bg-orange-50'}`}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Тренажёр</p>
                    <p className={`text-3xl font-display font-black ${simScore >= 70 ? 'text-green-600' : 'text-orange-500'}`}>{simScore}/100</p>
                  </div>
                </div>
                {simFeedback && (
                  <p className="text-sm font-medium text-gray-500 mb-10 leading-relaxed text-left bg-gray-50 rounded-2xl p-5">{simFeedback}</p>
                )}
                <button onClick={onClose} className="w-full py-6 bg-[#002D57] text-white rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all">
                  В личный кабинет
                </button>
              </motion.div>

            ) : (
              /* ── Normal result screen (no required sim) ── */
              <motion.div
                key="result"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="max-w-xl mx-auto py-8 sm:py-20 text-center bg-white rounded-[32px] sm:rounded-[64px] border border-gray-100 px-6 sm:px-16 shadow-lg sm:shadow-2xl m-4 sm:m-auto w-auto"
              >
                <div className={`w-20 h-20 sm:w-32 sm:h-32 rounded-[32px] sm:rounded-[48px] flex items-center justify-center mx-auto mb-6 sm:mb-10 shadow-xl sm:shadow-2xl ${score >= PASS_THRESHOLD ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {score >= PASS_THRESHOLD ? <Trophy size={36} /> : <X size={36} />}
                </div>
                <h2 className="text-5xl sm:text-6xl font-display font-black uppercase mb-3 sm:mb-4 tracking-tighter text-[#002D57]">{score}%</h2>
                <p className="text-xs font-black uppercase tracking-widest text-[#00A3FF] mb-12">
                  {score >= PASS_THRESHOLD ? 'Курс успешно зачтен' : 'Попробуйте еще раз'}
                </p>
                <p className="text-lg font-bold text-gray-400 mb-8 sm:mb-12 leading-relaxed">
                  {score >= PASS_THRESHOLD
                    ? 'Вы отлично справились с материалом курса!'
                    : `Для зачета необходимо набрать минимум ${PASS_THRESHOLD}%. Рекомендуем ещё раз ознакомиться с уроками.`}
                </p>

                {mistakes.length > 0 && (
                  <div className="mb-10 text-left">
                    <div className="flex items-center gap-2 mb-4">
                      <XCircle size={16} className="text-red-500" />
                      <h3 className="text-xs font-black uppercase tracking-widest text-[#002D57]">
                        Вопросы с ошибками ({mistakes.length})
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {mistakes.map((m, i) => (
                        <div key={i} className="bg-red-50/60 border border-red-100 rounded-2xl px-5 py-4">
                          <p className="text-sm font-bold text-[#002D57] leading-snug">{m.q}</p>
                          <p className="text-[11px] font-medium text-red-500 mt-1.5">Ваш ответ: {m.a}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 mt-4 leading-relaxed">
                      Повторите материал по этим темам и пройдите тест снова.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-4">
                  <button onClick={onClose} className="w-full py-6 bg-[#002D57] text-white rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all">
                    В личный кабинет
                  </button>
                  {score < PASS_THRESHOLD && (
                    <button
                      onClick={() => { setScore(0); setMistakes([]); setQuizFinished(false); setSelectedAnswers([]); setQuizType(null); setCurrentLessonIdx(0); setSimPhase('off'); }}
                      className="w-full py-6 border-2 border-gray-100 rounded-3xl font-display font-black uppercase tracking-widest text-gray-400 hover:text-[#002D57] transition-all"
                    >
                      Пройти заново
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
