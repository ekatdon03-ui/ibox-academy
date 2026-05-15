import React, { useState, useRef, useEffect } from 'react';
import { Send, X, MessageSquare, Bot, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { aiService } from '../services/aiService';
import { contentService, AISettings } from '../services/contentService';
import { Course, GlossaryTerm } from '../types';

interface AIAssistantProps {
  allCourses: Course[];
  glossary: GlossaryTerm[];
}

export default function AIAssistant({ allCourses, glossary }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', parts: { text: string }[] }[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadSettings = async () => {
      const s = await contentService.getAISettings();
      setSettings(s);
    };
    loadSettings();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        role: 'model',
        parts: [{ text: "Привет! Я твой надежный помощник iBOX Academy. 🚀 Могу помочь тебе разобраться в курсах, ответить на вопросы по глоссарию или подсказать, как пользоваться платформой. Чем могу помочь?" }]
      }]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const newMessages = [...messages, { role: 'user' as const, parts: [{ text: userText }] }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const kbContext = contentService.getKnowledgeBaseContext(allCourses, glossary);

      const response = await aiService.smartAssistant(
        userText,
        kbContext,
        messages.slice(-10),
        settings?.assistantPrompt
      );

      const cleanResponse = (response || "Извините, не удалось найти информацию.")
        .split('\n').filter(line => line.trim()).join('\n');

      setMessages(prev => [...prev, { role: 'model', parts: [{ text: cleanResponse }] }]);
    } catch (error: any) {
      console.error('[AIAssistant] Error:', error);
      const detail = error?.message || String(error);
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: `Ошибка связи с ИИ: ${detail}` }] }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="fixed bottom-10 right-10 w-16 h-16 bg-[#002D57] text-white rounded-[24px] shadow-2xl flex items-center justify-center hover:scale-110 transition-transform z-40 border-4 border-white"
      >
        <MessageSquare size={28} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-[110px] right-10 w-[420px] h-[600px] bg-white rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.2)] z-50 overflow-hidden flex flex-col border border-gray-100"
            style={{ maxHeight: 'calc(100vh - 160px)' }}
          >
            <div className="bg-[#002D57] p-8 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#00A3FF] rounded-2xl flex items-center justify-center shadow-lg">
                  <Bot size={24} />
                </div>
                <div>
                  <p className="font-black font-display uppercase tracking-tight text-sm">ИИ-помощник</p>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">В сети</p>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="w-10 h-10 rounded-xl hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-8 space-y-6 bg-[#F5F7FA] custom-scrollbar"
            >
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-5 rounded-[28px] text-sm font-medium leading-relaxed shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-[#002D57] text-white rounded-tr-none' 
                      : 'bg-white text-[#002D57] rounded-tl-none border border-gray-100'
                  }`}>
                    {msg.role === 'user' ? (
                      msg.parts[0].text
                    ) : (
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.parts[0].text}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white p-5 rounded-[28px] rounded-tl-none shadow-sm border border-gray-100">
                    <div className="flex gap-1.5">
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} className="w-1.5 h-1.5 bg-[#00A3FF] rounded-full" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.2 }} className="w-1.5 h-1.5 bg-[#00A3FF] rounded-full" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: 0.4 }} className="w-1.5 h-1.5 bg-[#00A3FF] rounded-full" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-gray-100 bg-white shrink-0">
              <div className="relative">
                <textarea 
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ваш вопрос..."
                  className="w-full bg-[#F5F7FA] rounded-2xl py-4 pl-6 pr-16 text-sm font-bold outline-none focus:ring-4 focus:ring-[#00A3FF]/10 transition-all resize-none max-h-32"
                />
                <button 
                  onClick={handleSend}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#00A3FF] text-white rounded-xl flex items-center justify-center hover:bg-[#002D57] transition-all shadow-lg"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
