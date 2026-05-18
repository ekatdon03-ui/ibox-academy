import React from 'react';
import { GraduationCap, Terminal, Book, User, LayoutDashboard, BarChart3, LogOut } from 'lucide-react';
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
    { id: 'training',  label: 'Обучение',   icon: GraduationCap },
    { id: 'simulator', label: 'Тренажер',   icon: Terminal },
    { id: 'glossary',  label: 'Глоссарий',  icon: Book },
    { id: 'profile',   label: 'Профиль',    icon: User },
  ];

  const managerItems = [
    { id: 'analytics', label: 'Аналитика', icon: BarChart3, show: true },
    { id: 'admin',     label: 'Админка',   icon: LayoutDashboard, show: isAdmin },
  ];

  const NavBtn = ({ id, label, icon: Icon }: { id: string; label: string; icon: any }) => (
    <button
      title={label}
      onClick={() => setActiveTab(id)}
      className={`relative group w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-200 ${
        activeTab === id
          ? 'bg-[#00A3FF] text-white shadow-lg shadow-[#00A3FF]/30'
          : 'text-white/40 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon size={20} />
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 bg-[#002D57] text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[9999] shadow-xl border border-white/10">
        {label}
      </span>
    </button>
  );

  return (
    <div className="w-16 h-full bg-[#002D57] text-white flex flex-col items-center py-6 fixed left-0 top-0 z-50 border-r border-[#00A3FF]/10 shadow-2xl">
      {/* Logo */}
      <div className="w-10 h-10 bg-[#00A3FF] rounded-2xl flex items-center justify-center font-display font-black text-lg shadow-lg shadow-[#00A3FF]/20 mb-8 shrink-0">
        A
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col items-center gap-2 overflow-y-auto w-full px-2">
        {menuItems.map(item => <NavBtn key={item.id} {...item} />)}

        {isManager && (
          <>
            <div className="w-8 h-px bg-white/10 my-2" />
            {managerItems.filter(i => i.show).map(item => <NavBtn key={item.id} {...item} />)}
          </>
        )}
      </nav>

      {/* Logout */}
      <button
        title="Выход"
        onClick={onLogout}
        className="group relative w-12 h-12 flex items-center justify-center rounded-2xl text-white/30 hover:bg-red-500/20 hover:text-red-400 transition-all mt-4"
      >
        <LogOut size={18} />
        <span className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 bg-[#002D57] text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[9999] shadow-xl border border-white/10">
          Выход
        </span>
      </button>
    </div>
  );
}
