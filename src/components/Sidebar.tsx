import React from 'react';
import { GraduationCap, Terminal, Book, User, LayoutDashboard, BarChart3 } from 'lucide-react';
import { UserProfile } from '../types';

interface SidebarProps {
  user: UserProfile;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

function NavBtn({ id, label, icon: Icon, active, onClick }: {
  id: string; label: string; icon: any; active: boolean; onClick: () => void;
}) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-11 h-11 flex items-center justify-center rounded-2xl transition-all duration-200 ${
          active
            ? 'bg-[#00A3FF] text-white shadow-lg shadow-[#00A3FF]/30'
            : 'text-white/40 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Icon size={19} />
      </button>
      <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 z-[9999]
                      opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <div className="bg-[#001a38] text-white text-[10px] font-black uppercase tracking-widest
                        px-3 py-1.5 rounded-xl whitespace-nowrap shadow-xl border border-white/10">
          {label}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ user, activeTab, setActiveTab }: SidebarProps) {
  const isAdmin   = user.role === 'admin';
  const isManager = user.role === 'manager' || user.role === 'admin';

  return (
    <div className="hidden sm:flex w-16 h-full bg-[#002D57] flex-col items-center py-5 gap-2
                    fixed left-0 top-0 z-50 border-r border-[#00A3FF]/10 shadow-2xl overflow-visible">

      {/* Logo */}
      <div className="w-10 h-10 bg-[#00A3FF] rounded-2xl flex items-center justify-center
                      font-display font-black text-xl shadow-lg shadow-[#00A3FF]/20 mb-4 shrink-0">
        A
      </div>

      {/* Main nav */}
      <NavBtn id="training"  label="Обучение"  icon={GraduationCap} active={activeTab==='training'}  onClick={() => setActiveTab('training')} />
      <NavBtn id="simulator" label="Тренажер"  icon={Terminal}       active={activeTab==='simulator'} onClick={() => setActiveTab('simulator')} />
      <NavBtn id="glossary"  label="Глоссарий" icon={Book}           active={activeTab==='glossary'}  onClick={() => setActiveTab('glossary')} />
      <NavBtn id="profile"   label="Профиль"   icon={User}           active={activeTab==='profile'}   onClick={() => setActiveTab('profile')} />

      {isManager && (
        <>
          <div className="w-8 h-px bg-white/10 my-1" />
          <NavBtn id="analytics" label="Аналитика" icon={BarChart3}      active={activeTab==='analytics'} onClick={() => setActiveTab('analytics')} />
          {isAdmin && (
            <NavBtn id="admin" label="Админка" icon={LayoutDashboard} active={activeTab==='admin'} onClick={() => setActiveTab('admin')} />
          )}
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
