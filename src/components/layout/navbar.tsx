// 頂部導覽列 - 庫存異動與資產生命週期管理平台
// 強制使用繁體中文，支援角色切換 (Mock 模式) 與登出
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authApi, isRealSupabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Profile } from '@/lib/supabase/mockDb';
import { 
  Database, 
  AlertTriangle, 
  Search, 
  LogOut, 
  User, 
  RefreshCw,
  LayoutDashboard,
  type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Profile['role'][];
};

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);

  useEffect(() => {
    // 獲取當前使用者
    const fetchUser = async () => {
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, [pathname]);

  const handleLogout = async () => {
    await authApi.logout();
    toast.success('已安全登出');
    router.push('/login');
    if (typeof window !== 'undefined') {
      // 確保畫面完全重構
      setTimeout(() => {
        window.location.reload();
      }, 500);
    }
  };

  // 方便展示用的角色切換
  const handleRoleChange = (role: 'Admin' | 'Editor' | 'Viewer') => {
    authApi.switchRole(role);
    toast.success(`已切換系統角色為：${
      role === 'Admin' ? '系統管理員' : role === 'Editor' ? '庫管人員' : '一般同仁'
    }`);
    // 重新載入使用者資訊與刷新頁面
    authApi.getCurrentUser().then(res => {
      setCurrentUser(res);
      // 觸發頁面刷新以更新視圖
      window.location.reload();
    });
  };

  if (pathname === '/login') return null;

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'Admin': return '系統管理員';
      case 'Editor': return '庫管人員';
      case 'Viewer': return '一般同仁';
      default: return '一般同仁';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'Admin': return 'bg-rose-50 text-rose-600 border border-rose-200';
      case 'Editor': return 'bg-amber-50 text-amber-600 border border-amber-200';
      case 'Viewer': return 'bg-slate-100 text-slate-600 border border-slate-200';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  const navItems: NavItem[] = [
    { href: '/', label: '出入庫紀錄', icon: LayoutDashboard },
    { href: '/reconciliation', label: '待補對帳', icon: AlertTriangle },
    { href: '/lifecycle', label: 'PID 掛帳查詢', icon: Search },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/90 backdrop-blur-md font-sans text-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="p-2 bg-gradient-to-tr from-sky-500 to-emerald-400 rounded-xl text-slate-950 group-hover:scale-105 transition-transform duration-200">
                <Database size={18} />
              </div>
              <span className="font-bold text-lg tracking-wider bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
                NextDrive 出入庫追蹤平台
              </span>
            </Link>

            {/* Links */}
            <div className="hidden md:flex items-center gap-1.5">
              {navItems.map((item) => {
                // 如果該功能有限制角色，且當前使用者不符，則隱藏
                if (item.roles && currentUser && !item.roles.includes(currentUser.role)) {
                  return null;
                }

                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-sky-50 text-sky-700 border border-sky-100'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* User Info / Actions */}
          <div className="flex items-center gap-4">
            {currentUser && (
              <div className="flex items-center gap-3">
                {/* 快捷切換角色 - 僅在非真實 Supabase 時顯示，超方便測試！ */}
                {!isRealSupabase && (
                  <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <RefreshCw size={10} className="animate-spin-slow" /> 切換視角:
                    </span>
                    <button 
                      onClick={() => handleRoleChange('Admin')}
                      className={`px-1.5 py-0.5 text-[10px] rounded font-semibold transition-all ${
                        currentUser.role === 'Admin' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Admin
                    </button>
                    <button 
                      onClick={() => handleRoleChange('Editor')}
                      className={`px-1.5 py-0.5 text-[10px] rounded font-semibold transition-all ${
                        currentUser.role === 'Editor' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Editor
                    </button>
                    <button 
                      onClick={() => handleRoleChange('Viewer')}
                      className={`px-1.5 py-0.5 text-[10px] rounded font-semibold transition-all ${
                        currentUser.role === 'Viewer' ? 'bg-slate-500 text-white' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      Viewer
                    </button>
                  </div>
                )}

                {/* 使用者資訊與角色標籤 */}
                <div className="hidden lg:flex flex-col items-end">
                  <span className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                    <User size={12} className="text-slate-400" />
                    {currentUser.name}
                  </span>
                  <span className="text-[10px] text-slate-500">{currentUser.email}</span>
                </div>

                <span className={`px-2 py-0.5 text-xs font-semibold rounded ${getRoleColor(currentUser.role)}`}>
                  {getRoleLabel(currentUser.role)}
                </span>

                {/* 登出 */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg"
                  title="安全登出"
                >
                  <LogOut size={16} />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
