import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, HelpCircle, Trophy, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Course, UserProfile } from '../types';
import { contentService } from '../services/contentService';

interface CoursePlayerProps {
  course: Course;
  user: UserProfile;
  onClose: () => void;
}

// Minimum percentage required to pass a course quiz
const PASS_THRESHOLD = 80;

// ─── Course player component ──────────────────────────────────────────────────
export default function CoursePlayer({ course, user, onClose }: CoursePlayerProps) {
  // ── All hooks first (Rules of Hooks — never call hooks after a return) ──
  const [currentLessonIdx, setCurrentLessonIdx] = useState(0);
  const [quizType, setQuizType] = useState<'lesson' | 'final' | null>(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  const showQuiz = quizType !== null;
  const testMode = course.testMode ?? 'final';
  const lessons = course.lessons || [];
  const hasFinalQuiz = (testMode === 'final' || testMode === 'both') && (course.testConfig?.questions?.length ?? 0) > 0;
  const hasPerLessonQuiz = testMode === 'per_lesson' || testMode === 'both';

  const activeQuestions = quizType === 'lesson'
    ? (lessons[currentLessonIdx]?.testConfig?.questions ?? [])
    : (course.testConfig?.questions ?? []);

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
    if (rawUrl.match(/\.(pptx|ppt|docx|xlsx)$/) || rawUrl.includes('sharepoint.com')) {
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  };

  const renderMedia = (url: string) => {
    if (!url) return null;

    const embedUrl = getEmbedUrl(url);
    const isVideo = url.toLowerCase().includes('video/') || url.toLowerCase().endsWith('.mp4');

    if (isVideo && !url.includes('drive.google.com')) {
      return <video src={url} controls className="w-full h-full object-contain bg-black rounded-[28px]" />;
    }

    return (
      <div className="w-full h-full bg-white relative">
        <iframe
          src={embedUrl}
          className="absolute inset-0 w-full h-full border-none"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Content Player"
        />
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
    activeQuestions.forEach((q, idx) => {
      if (Number(selectedAnswers[idx]) === Number(q.correctAnswer)) correct++;
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
    setQuizFinished(true);

    try {
      if (user.id && course.id) {
        const lastLessonId = lessons[lessons.length - 1].id;
        if (finalScore >= PASS_THRESHOLD) {
          await contentService.updateLessonProgress(user.id, course.id, lastLessonId, true, lessons.length);
          await contentService.saveResult({ userId: user.id, courseId: course.id, score: finalScore, progress: 100, timestamp: new Date().toISOString() });
        } else {
          await contentService.saveResult({ userId: user.id, courseId: course.id, score: finalScore, progress: 50, timestamp: new Date().toISOString() });
        }
      }
    } catch (e) {}
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-white z-[999] flex flex-col">
      <header className="h-20 border-b border-gray-100 px-10 flex items-center justify-between shrink-0">
        <button
          onClick={onClose}
          className="flex items-center gap-2 font-bold text-gray-400 hover:text-[#002D57] transition-colors text-sm"
        >
          <ChevronLeft size={20} />
          Назад к курсам
        </button>
        <div className="text-center">
          <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest mb-1">{course.category}</p>
          <h3 className="font-display font-black text-[#002D57] tracking-tight uppercase leading-none">{course.title}</h3>
        </div>
        <div className="w-40 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#00A3FF] transition-all duration-500"
            style={{ width: `${((currentLessonIdx + (showQuiz ? 1 : 0)) / (lessons.length + (hasFinalQuiz ? 1 : 0))) * 100}%` }}
          />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
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

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-white">
          <AnimatePresence mode="wait">
            {quizType === null ? (
              <motion.article
                key={currentLesson.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto px-10 py-10 md:px-16 md:py-12"
              >
                <h1 className="text-4xl font-display font-black uppercase tracking-tight mb-10 leading-none">
                  {currentLesson.title}
                </h1>

                {/* Media viewer — tall container, no fixed aspect ratio */}
                {(course.fileUrl || currentLesson.fileUrl) && !showQuiz && (
                  <div className="mb-10 rounded-[32px] overflow-hidden border-2 border-gray-100 shadow-2xl bg-gray-50"
                       style={{ height: '78vh', minHeight: 560 }}>
                    {renderMedia(currentLesson.fileUrl || course.fileUrl || '')}
                  </div>
                )}

                <div className="markdown-content max-w-none">
                  <ReactMarkdown>{currentLesson.content}</ReactMarkdown>
                </div>

                <div className="mt-16 pt-8 border-t border-gray-100 flex items-center justify-between">
                  <button
                    onClick={() => setCurrentLessonIdx(i => i - 1)}
                    disabled={currentLessonIdx === 0}
                    className="px-8 py-4 border border-gray-100 rounded-2xl font-bold disabled:opacity-30 hover:bg-gray-50 transition-all text-sm flex items-center gap-2"
                  >
                    <ChevronLeft size={16} /> Предыдущий
                  </button>

                  <div className="flex gap-3">
                    <button
                      onClick={handleMarkAsDone}
                      disabled={isCompleted}
                      className={`px-6 py-4 rounded-2xl font-bold transition-all flex items-center gap-2 text-sm ${isCompleted ? 'bg-green-50 text-green-500 border border-green-100' : 'bg-white border border-[#00A3FF] text-[#00A3FF] hover:bg-[#00A3FF]/5'}`}
                    >
                      {isCompleted && <CheckCircle size={16} />}
                      {isCompleted ? 'Урок изучен' : 'Завершить урок'}
                    </button>

                    <button
                      onClick={handleNext}
                      className="px-8 py-4 bg-[#002D57] text-white rounded-2xl font-bold shadow-lg hover:bg-[#00A3FF] transition-all text-sm flex items-center gap-2"
                    >
                      {currentLessonIdx === lessons.length - 1
                        ? (hasFinalQuiz ? 'К тесту' : 'Завершить курс')
                        : 'Далее'}
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </motion.article>
            ) : !quizFinished ? (
              <motion.div
                key="quiz"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-2xl mx-auto px-10 py-12"
              >
                <h2 className="text-4xl font-display font-black uppercase mb-4 text-center">
                  {quizType === 'lesson' ? `Тест: ${lessons[currentLessonIdx]?.title}` : 'Итоговый тест'}
                </h2>
                {quizType === 'lesson' && (
                  <p className="text-center text-[10px] font-black uppercase tracking-widest text-gray-400 mb-10">Проверка по уроку</p>
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
                  className="w-full mt-20 py-8 bg-[#002D57] text-white rounded-[40px] font-display font-black uppercase tracking-[0.2em] shadow-2xl disabled:opacity-30 hover:bg-[#00A3FF] transition-all"
                >
                  {quizType === 'lesson' ? 'Продолжить' : 'Завершить курс и отправить результат'}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="result"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="max-w-xl mx-auto py-20 text-center bg-white rounded-[64px] border border-gray-100 px-16 shadow-2xl"
              >
                <div className={`w-32 h-32 rounded-[48px] flex items-center justify-center mx-auto mb-10 shadow-2xl ${score >= PASS_THRESHOLD ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {score >= PASS_THRESHOLD ? <Trophy size={48} /> : <X size={48} />}
                </div>
                <h2 className="text-6xl font-display font-black uppercase mb-4 tracking-tighter text-[#002D57]">{score}%</h2>
                <p className="text-xs font-black uppercase tracking-widest text-[#00A3FF] mb-12">
                  {score >= PASS_THRESHOLD ? 'Курс успешно зачтен' : 'Попробуйте еще раз'}
                </p>
                <p className="text-lg font-bold text-gray-400 mb-12 leading-relaxed">
                  {score >= PASS_THRESHOLD
                    ? 'Вы отлично справились с материалом курса!'
                    : `Для зачета необходимо набрать минимум ${PASS_THRESHOLD}%. Рекомендуем ещё раз ознакомиться с уроками.`}
                </p>
                <div className="flex flex-col gap-4">
                  <button onClick={onClose} className="w-full py-6 bg-[#002D57] text-white rounded-3xl font-display font-black uppercase tracking-widest shadow-xl hover:bg-[#00A3FF] transition-all">
                    В личный кабинет
                  </button>
                  {score < PASS_THRESHOLD && (
                    <button
                      onClick={() => { setScore(0); setQuizFinished(false); setSelectedAnswers([]); setQuizType(null); setCurrentLessonIdx(0); }}
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
