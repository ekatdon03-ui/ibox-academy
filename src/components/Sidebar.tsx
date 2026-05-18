import React from 'react';
import { GraduationCap, Terminal, Book, User, LayoutDashboard, BarChart3, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { UserProfile } from '../types';

interface SidebarProps {
  user: UserProfile;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export default function Sidebar({ user, activeTab, setActiveTab, onLogout }: SidebarProps) {
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager' || user.role === 'admin';

  const menuItems = [
    { id: 'training',  label: 'Обучение',  icon: GraduationCap },
    { id: 'simulator', label: 'Тренажер',  icon: Terminal },
    { id: 'glossary',  label: 'Глоссарий', icon: Book },
    { id: 'profile',   label: 'Профиль',   icon: User },
  ];

  return (
    <div className="w-72 h-full bg-[#002D57] text-white flex flex-col p-8 fixed left-0 top-0 z-50 border-r border-[#00A3FF]/10 shadow-2xl">
      <div className="mb-16 mt-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#00A3FF] rounded-2xl flex items-center justify-center font-display font-black text-2xl shadow-lg shadow-[#00A3FF]/20">A</div>
          <div>
            <span className="text-2xl font-display font-black tracking-tight leading-none block uppercase">Academy</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00A3FF]/60">iBOX Platform</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-4 ml-4">Основное меню</p>
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${
              activeTab === item.id
                ? 'bg-[#00A3FF] text-white shadow-lg shadow-[#00A3FF]/20 font-bold'
                : 'text-white/40 hover:bg-white/5 hover:text-white/70'
            }`}
          >
            <item.icon size={20} className={activeTab === item.id ? 'opacity-100' : 'opacity-50'} />
            <span className="text-sm uppercase font-display font-bold tracking-tight">{item.label}</span>
          </button>
        ))}

        {isManager && (
          <div className="mt-8">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-4 ml-4">Управление</p>
            <div className="space-y-1">
              <button
                onClick={() => setActiveTab('analytics')}
                className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${
                  activeTab === 'analytics'
                    ? 'bg-[#00A3FF] text-white shadow-lg'
                    : 'text-white/40 hover:bg-white/5 hover:text-white/70'
                }`}
              >
                <BarChart3 size={20} className={activeTab === 'analytics' ? 'opacity-100' : 'opacity-50'} />
                <span className="text-sm uppercase font-display font-bold tracking-tight">Аналитика</span>
              </button>

              {isAdmin && (
                <button
                  onClick={() => setActiveTab('admin')}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 ${
                    activeTab === 'admin'
                      ? 'bg-[#00A3FF] text-white shadow-lg'
                      : 'text-white/40 hover:bg-white/5 hover:text-white/70'
                  }`}
                >
                  <LayoutDashboard size={20} className={activeTab === 'admin' ? 'opacity-100' : 'opacity-50'} />
                  <span className="text-sm uppercase font-display font-bold tracking-tight">Админка</span>
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      <div className="mt-auto pt-8 border-t border-white/5">
        <button
          onClick={onLogout}
          className="flex items-center gap-4 p-4 rounded-2xl w-full hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-all font-display font-bold uppercase text-[10px] tracking-widest"
        >
          <LogOut size={20} />
          <span>Выход из системы</span>
        </button>
      </div>
    </div>
  );
}
