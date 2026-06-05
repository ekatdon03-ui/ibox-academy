import React, { useState } from 'react';
import { UserProfile } from '../types';
import { motion } from 'motion/react';
import { Shield, LogIn } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

interface AuthViewProps {
  onLogin: (user: UserProfile) => void;
}

export default function AuthView({ onLogin }: AuthViewProps) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      onLogin({
        id: user.uid,
        name: user.displayName || 'Пользователь',
        email: user.email || '',
        position: 'Сотрудник iBOX',
        role: 'employee',
        avatar: user.photoURL || '',
        department: 'Общий отдел',
        assignedCourses: []
      });
    } catch (e: any) {
      console.error("Login Error:", e);
      if (e.code === 'auth/popup-blocked') {
        setError('Всплывающее окно заблокировано браузером. Разрешите popups для этого сайта.');
      } else if (e.code === 'auth/cancelled-popup-request') {
        setError('Вход отменён.');
      } else {
        setError('Ошибка входа. Попробуйте ещё раз.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-[#F5F7FA] font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white p-12 rounded-[40px] shadow-2xl border border-gray-100"
      >
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-[#00A3FF] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-[#00A3FF]/20">
            <Shield className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-display font-black uppercase tracking-tight text-[#002D57]">iBOX ACADEMY</h1>
          <p className="text-gray-400 font-bold text-[10px] uppercase tracking-widest mt-2">Добро пожаловать</p>
        </div>

        <div className="space-y-4">
          {error && (
            <p className="text-red-500 text-[10px] font-bold uppercase tracking-widest text-center mb-4 bg-red-50 p-3 rounded-2xl">
              {error}
            </p>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full group p-6 rounded-3xl bg-[#002D57] text-white flex items-center gap-6 hover:bg-[#00A3FF] transition-all shadow-xl disabled:opacity-60"
          >
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
              {loading
                ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <LogIn size={20} />
              }
            </div>
            <div className="flex-1 text-center">
              <p className="font-display font-bold uppercase text-sm">
                {loading ? 'Вход...' : 'Вход через Google'}
              </p>
            </div>
          </button>

          <div className="mt-8 pt-8 border-t border-gray-50 text-center">
            <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest leading-relaxed">
              Внутри Bitrix24 авторизация происходит автоматически
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
