import React, { useState, useEffect } from 'react';
import { ChevronLeft, CheckCircle, HelpCircle, Trophy, X, Zap, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Course, UserProfile } from '../types';
import { contentService, XP_REWARDS } from '../services/contentService';

interface CoursePlayerProps {
  course: Course;
  user: UserProfile;
  onClose: () => void;
}

export default function CoursePlayer({ course, user, onClose }: CoursePlayerProps) {
  const [currentLessonIdx, setCurrentLessonIdx] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [score, setScore] = useState(0);

  if (!course.lessons || course.lessons.length === 0) {
    return (
      <div className="fixed inset-0 bg-white z-[999] flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-500 mb-4">В этом курсе пока нет уроков</p>
          <button onClick={onClose} className="px-8 py-3 bg-[#002D57] text-white rounded-xl">Вернуться</button>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const startCourse = async () => {
      if (user.id && course.id) {
        try {
          const currentProgress = await contentService.getCourseProgress(user.id, course.id);
          if (currentProgress) {
            const lessons = course.lessons || [];
            // Find the last incomplete lesson
            const firstIncomplete = lessons.findIndex(l => 
              !currentProgress.lessons.find(pl => pl.lessonId === l.id && pl.completed)
            );
            if (firstIncomplete > 0) {
              setCurrentLessonIdx(firstIncomplete);
            }
          }
        } catch (e) {
          console.error("Error starting/resuming course:", e);
        }
      }
    };
    startCourse();
  }, [course.id, user.id]);

  const currentLesson = course.lessons[currentLessonIdx];
  const lessonProgress = user.id && course.id ? contentService.getCourseProgress(user.id, course.id) : null;
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    const checkLessonDone = async () => {
       if (user.id && course.id && currentLesson) {
         const p = await contentService.getCourseProgress(user.id, course.id);
         const done = p?.lessons.find(l => l.lessonId === currentLesson.id)?.completed || false;
         setIsCompleted(done);
       }
    };
    checkLessonDone();
  }, [currentLessonIdx, course.id, user.id]);

  const handleMarkAsDone = async () => {
    if (user.id && course.id && currentLesson) {
      try {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, course.lessons.length);
        await contentService.updateUserScore(user.id || 'anonymous', XP_REWARDS.LESSON);
        setIsCompleted(true);
      } catch (e) {}
    }
  };

  const renderMedia = (url: string) => {
    if (!url) return null;
    
    const getEmbedUrl = (rawUrl: string) => {
      // Google Drive Presentations Logic
      if (rawUrl.includes('docs.google.com/presentation/d/')) {
        const docId = rawUrl.split('/d/')[1].split('/')[0];
        // Use preview?rm=minimal for clean embed. start=true makes it behave like a slideshow immediately.
        return `https://docs.google.com/presentation/d/${docId}/embed?start=true&loop=false&delayms=3000&rm=minimal`;
      }
      
      // Google Drive Files
      if (rawUrl.includes('drive.google.com')) {
        let driveId = '';
        if (rawUrl.includes('/d/')) driveId = rawUrl.split('/d/')[1].split('/')[0];
        else if (rawUrl.includes('id=')) driveId = rawUrl.split('id=')[1].split('&')[0];
        if (driveId) return `https://drive.google.com/file/d/${driveId}/preview`;
      }
      // YouTube
      if (rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be')) {
        let videoId = '';
        if (rawUrl.includes('v=')) videoId = rawUrl.split('v=')[1].split('&')[0];
        else if (rawUrl.includes('shorts/')) videoId = rawUrl.split('shorts/')[1].split('?')[0];
        else if (rawUrl.includes('embed/')) videoId = rawUrl.split('embed/')[1].split('?')[0];
        else videoId = rawUrl.split('?')[0].split('/').pop() || '';
        return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0`;
      }
      // Office
      if (rawUrl.match(/\.(pptx|ppt|docx|xlsx)$/) || rawUrl.includes('sharepoint.com')) {
        return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(rawUrl)}`;
      }
      return rawUrl;
    };

    const embedUrl = getEmbedUrl(url);
    const isVideo = url.toLowerCase().includes('video/') || url.toLowerCase().endsWith('.mp4');

    if (isVideo && !url.includes('drive.google.com')) {
      return <video src={url} controls className="w-full h-full object-contain bg-black" />;
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

  const handleLessonChange = async (idx: number) => {
    // Mark current lesson as completed before moving if not quiz
    if (!showQuiz && user.id && course.id && currentLesson) {
      try {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, course.lessons.length);
      } catch (e) {}
    }
    setCurrentLessonIdx(idx);
    setShowQuiz(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = async () => {
    // Save current lesson progress
    try {
      if (user.id && course.id && currentLesson) {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, true, course.lessons.length);
      }
    } catch (e) {
      console.error("Progress update error:", e);
    }

    if (currentLessonIdx < course.lessons.length - 1) {
      setCurrentLessonIdx(prev => prev + 1);
    } else if (course.testConfig?.questions && course.testConfig.questions.length > 0) {
      setShowQuiz(true);
    } else {
      try {
        if (user.id && course.id) {
          await contentService.saveResult({
            userId: user.id || 'anonymous',
            courseId: course.id,
            score: 100,
            progress: 100,
            timestamp: new Date().toISOString()
          });
          await contentService.updateUserScore(user.id || 'anonymous', XP_REWARDS.QUIZ);
        }
      } catch (e) {
        console.error("Save result error:", e);
      }
      onClose();
    }
  };

  const handleQuizSubmit = async () => {
    let correct = 0;
    const questions = course.testConfig?.questions || [];
    selectedAnswers.forEach((ans, idx) => {
      if (ans === questions[idx].correctAnswer) correct++;
    });

    const finalScore = Math.round((correct / questions.length) * 100);
    setScore(finalScore);
    setQuizFinished(true);

    if (finalScore >= 80) {
      try {
        if (user.id && course.id) {
          // Explicitly mark all lessons as completed to trigger 100% and status: completed
          const lastLessonId = course.lessons[course.lessons.length - 1].id;
          await contentService.updateLessonProgress(user.id, course.id, lastLessonId, true, course.lessons.length);
          
          await contentService.saveResult({
            userId: user.id || 'anonymous',
            courseId: course.id,
            score: finalScore,
            progress: 100,
            timestamp: new Date().toISOString()
          });
          await contentService.updateUserScore(user.id || 'anonymous', XP_REWARDS.QUIZ);
        }
      } catch (e) {
        console.error("Final progress save error:", e);
      }
    } else {
      // If failed, we don't save 100% result or move to completed
      console.log("Quiz failed, score below 80%");
      if (user.id && course.id) {
        // Just save result but don't mark 100% progress
        await contentService.saveResult({
          userId: user.id || 'anonymous',
          courseId: course.id,
          score: finalScore,
          progress: score, // Progress based on score? No, usually progress is based on content consumption.
          // But user wants to show it's not "done" yet.
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const handleClose = async () => {
    // Save current progress before closing
    if (user.id && course.id && currentLesson && !showQuiz) {
      try {
        await contentService.updateLessonProgress(user.id, course.id, currentLesson.id, false, course.lessons.length);
      } catch (e) {
        console.error("Error saving progress on close:", e);
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-white z-[999] flex flex-col">
      <header className="h-20 border-b border-gray-100 px-10 flex items-center justify-between">
        <button 
          onClick={handleClose}
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
            style={{ width: `${((currentLessonIdx + (showQuiz ? 1 : 0)) / (course.lessons.length + (course.testConfig ? 1 : 0))) * 100}%` }}
          />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-gray-100 bg-gray-50/10 overflow-y-auto p-8 hidden lg:block">
          <h4 className="text-[10px] uppercase tracking-widest font-black text-[#002D57]/20 mb-8 font-display">Содержание</h4>
          <div className="space-y-2">
            {course.lessons.map((lesson, idx) => (
              <button
                key={lesson.id || idx}
                onClick={() => handleLessonChange(idx)}
                className={`w-full flex items-start gap-4 p-5 rounded-3xl text-left transition-all ${
                  !showQuiz && currentLessonIdx === idx 
                    ? 'bg-white shadow-xl text-[#002D57] font-bold border border-gray-50' 
                    : 'text-gray-400 opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-display font-black text-xs ${!showQuiz && currentLessonIdx === idx ? 'bg-[#002D57] text-white' : 'bg-gray-100'}`}>
                  {idx + 1}
                </div>
                <div className="flex-1 pt-1">
                  <p className="text-sm font-black uppercase tracking-tight line-clamp-1">{lesson.title}</p>
                </div>
              </button>
            ))}
            {course.testConfig && (
              <button
                onClick={() => setShowQuiz(true)}
                className={`w-full flex items-start gap-4 p-5 rounded-3xl text-left transition-all ${
                  showQuiz 
                    ? 'bg-white shadow-xl text-[#002D57] font-bold border border-gray-50' 
                    : 'text-gray-400 opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${showQuiz ? 'bg-[#00A3FF] text-white' : 'bg-gray-100'}`}>
                  <HelpCircle size={14} />
                </div>
                <div className="pt-1">
                  <p className="text-sm font-black uppercase tracking-tight">Итоговый тест</p>
                  <p className="text-[8px] opacity-60 font-black uppercase tracking-widest mt-1">Обязательно</p>
                </div>
              </button>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-10 md:p-24 bg-white">
          <AnimatePresence mode="wait">
            {!showQuiz ? (
              <motion.article 
                key={currentLesson.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-3xl mx-auto"
              >
                <h1 className="text-5xl font-display font-black uppercase tracking-tight mb-12 leading-none">{currentLesson.title}</h1>
                
                {(course.fileUrl || currentLesson.fileUrl) && !showQuiz && (
                  <div className="mb-12 rounded-[32px] overflow-hidden border-4 border-gray-50 shadow-2xl bg-gray-900 aspect-video relative group">
                    {renderMedia(currentLesson.fileUrl || course.fileUrl)}
                  </div>
                )}

                <div className="markdown-content max-w-none">
                   <ReactMarkdown>{currentLesson.content}</ReactMarkdown>
                </div>
                <div className="mt-20 pt-10 border-t border-gray-100 flex items-center justify-between">
                   <button 
                     onClick={() => setCurrentLessonIdx(i => i - 1)} 
                     disabled={currentLessonIdx === 0} 
                     className="px-8 py-4 border border-gray-100 rounded-2xl font-bold disabled:opacity-30 hover:bg-gray-50 transition-all text-sm"
                   >
                     Предыдущий
                   </button>

                   <div className="flex gap-4">
                     <button 
                       onClick={handleMarkAsDone}
                       disabled={isCompleted}
                       className={`px-8 py-4 rounded-2xl font-bold transition-all flex items-center gap-2 text-sm ${isCompleted ? 'bg-green-50 text-green-500 border border-green-100' : 'bg-white border border-ibox-blue text-ibox-blue hover:bg-ibox-blue/5'}`}
                     >
                       {isCompleted ? <CheckCircle size={18} /> : null}
                       {isCompleted ? 'Урок изучен' : 'Завершить изучение урока'}
                     </button>
                     
                     <button 
                       onClick={handleNext} 
                       className="px-10 py-4 bg-ibox-blue text-white rounded-2xl font-bold shadow-lg shadow-ibox-blue/20 hover:bg-ibox-action transition-all text-sm"
                     >
                       {currentLessonIdx === course.lessons.length - 1 ? 'К итоговому тесту' : 'Далее'}
                     </button>
                   </div>
                </div>
              </motion.article>
            ) : !quizFinished ? (
              <motion.div 
                key="quiz"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-2xl mx-auto py-12"
              >
                <h2 className="text-4xl font-display font-black uppercase mb-12 text-center">Проверка знаний</h2>
                <div className="space-y-12">
                  {course.testConfig?.questions.map((q, qIdx) => (
                    <div key={qIdx} className="space-y-6">
                       <p className="text-xl font-display font-black uppercase tracking-tight text-[#002D57]">{qIdx + 1}. {q.question}</p>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         {q.options.map((opt, oIdx) => (
                           <button 
                             key={oIdx}
                             onClick={() => { const a = [...selectedAnswers]; a[qIdx] = oIdx; setSelectedAnswers(a); }}
                             className={`p-6 rounded-[32px] text-left font-bold border-2 transition-all group ${selectedAnswers[qIdx] === oIdx ? 'bg-[#002D57] border-[#002D57] text-white shadow-xl' : 'bg-[#F5F7FA] border-[#F5F7FA] hover:border-gray-200'}`}
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
                  disabled={selectedAnswers.length < (course.testConfig?.questions.length || 0)}
                  className="w-full mt-20 py-8 bg-[#002D57] text-white rounded-[40px] font-display font-black uppercase tracking-[0.2em] shadow-2xl disabled:opacity-30 hover:bg-[#00A3FF] transition-all"
                >
                  Завершить курс и отправить результат
                </button>
              </motion.div>
            ) : (
              <motion.div 
                key="result"
                initial={{ scale: 0.9, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }}
                className="max-w-xl mx-auto py-20 text-center bg-white rounded-[64px] border border-gray-100 p-16 shadow-2xl"
              >
                <div className={`w-32 h-32 rounded-[48px] flex items-center justify-center mx-auto mb-10 shadow-2xl ${score >= 80 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                  {score >= 80 ? <Trophy size={48} /> : <X size={48} />}
                </div>
                <h2 className="text-6xl font-display font-black uppercase mb-4 tracking-tighter text-[#002D57]">{score}%</h2>
                <p className="text-xs font-black uppercase tracking-widest text-[#00A3FF] mb-12">{score >= 80 ? 'Курс успешно зачтен' : 'Попробуйте еще раз'}</p>
                <p className="text-lg font-bold text-gray-400 mb-12 leading-relaxed">{score >= 80 ? 'Вы отлично справились с материалом. Ваши баллы уже зачислены в общий рейтинг.' : 'Для зачета обучения необходимо набрать минимум 80%. Рекомендуем еще раз ознакомиться с уроками.'}</p>
                <div className="flex flex-col gap-4">
                  <button onClick={onClose} className="w-full py-6 bg-[#002D57] text-white rounded-3xl font-display font-black uppercase tracking-widest shadow-xl">В личный кабинет</button>
                  {score < 80 && (
                    <button onClick={() => { setQuizFinished(false); setSelectedAnswers([]); setShowQuiz(false); setCurrentLessonIdx(0); }} className="w-full py-6 border-2 border-gray-100 rounded-3xl font-display font-black uppercase tracking-widest text-gray-400 hover:text-[#002D57] transition-all">Пройти заново</button>
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
