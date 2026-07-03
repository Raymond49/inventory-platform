// 使用者驗證與路徑防護 Provider
// 未登入同仁將自動被引導至 /login 頁面
// 所有註解均使用繁體中文

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authApi } from '@/lib/supabase/client';
import { Profile } from '@/lib/supabase/mockDb';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Profile | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      // 排除登入頁面本身，避免無限循環
      if (pathname === '/login' || pathname.startsWith('/auth/callback')) {
        setLoading(false);
        return;
      }

      const currentUser = await authApi.getCurrentUser();
      if (!currentUser) {
        // 未登入，重新導向至登入頁面
        router.push('/login');
      } else {
        setUser(currentUser);
        
        // 額外權限限制：如果是 Editor 專屬頁面 (如 /entry 資料補登)，而角色是 Viewer，則限制存取
        if (pathname === '/entry' && currentUser.role === 'Viewer') {
          router.push('/');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [pathname, router]);

  if (loading && pathname !== '/login') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 font-sans">
        <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400 font-medium tracking-wide">安全載入中，請稍候...</p>
      </div>
    );
  }

  return <>{children}</>;
}
