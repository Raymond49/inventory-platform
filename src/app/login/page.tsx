// 登入頁面 - 庫存異動與資產生命週期管理平台
// 強制使用繁體中文，且支援 `@nextdrive.io` 網域限制
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, isRealSupabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { KeyRound, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 若已登入，直接導入首頁
  useEffect(() => {
    const user = authApi.getCurrentUser();
    user.then((res) => {
      if (res) {
        router.push('/');
      }
    });
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    if (!email) {
      setErrorMsg('請輸入電子信箱');
      setLoading(false);
      return;
    }

    if (!email.endsWith('@nextdrive.io')) {
      setErrorMsg('僅限公司網域信箱 (@nextdrive.io) 登入');
      toast.error('登入失敗：網域不符');
      setLoading(false);
      return;
    }

    try {
      if (isRealSupabase) {
        // 真實 Supabase 使用 Google OAuth
        const { success, error } = await authApi.login(email, name);
        if (!success) {
          setErrorMsg(error || '登入失敗，請稍後再試');
          toast.error('登入失敗');
        }
      } else {
        // 本機模擬登入
        const res = await authApi.login(email, name);
        if (res.success) {
          setSuccessMsg('登入成功！正在跳轉...');
          toast.success('登入成功，已寫入軌跡');
          setTimeout(() => {
            router.push('/');
            // 重新整理頁面以更新導覽列狀態
            window.location.reload();
          }, 1200);
        } else {
          setErrorMsg(res.error || '登入失敗');
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || '發生未知錯誤');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-radial from-slate-50 via-slate-100 to-slate-200 overflow-hidden font-sans text-slate-900">
      <Toaster position="top-center" richColors />
      
      {/* 裝飾背景漸變球 */}
      <div className="absolute top-1/4 -left-1/4 w-[500px] h-[500px] bg-sky-200/60 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-emerald-200/60 rounded-full blur-3xl animate-pulse delay-75" />

      <div className="w-full max-w-md p-4 z-10">
        <Card className="border-slate-200 bg-white/90 backdrop-blur-xl shadow-xl transition-all duration-300 hover:border-slate-300">
          <CardHeader className="space-y-2 text-center pb-6">
            <div className="flex justify-center mb-2">
              <div className="p-3 bg-gradient-to-tr from-sky-500 to-emerald-400 rounded-2xl shadow-lg shadow-sky-500/20 text-slate-950">
                <KeyRound size={28} />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-slate-700 to-slate-600 bg-clip-text text-transparent">
              資產管理平台登入
            </CardTitle>
            <CardDescription className="text-slate-500 text-sm">
              Single Source of Truth (SSOT) 出入庫紀錄與 PID 掛帳追蹤
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5 text-xs text-slate-600">
              <ShieldAlert className="text-amber-500 shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-semibold text-slate-800 block">安全網域限制</span>
                僅允許結尾為 <code className="text-sky-600 font-mono">@nextdrive.io</code> 的公司信箱進行登入。系統將自動記錄登入軌跡。
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-700 text-sm">公司電子信箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="yourname@nextdrive.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500 focus-visible:border-sky-500"
                  required
                />
              </div>

              {!isRealSupabase && (
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-700 text-sm">您的姓名 (本機展示用)</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="例如：張庫管"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus-visible:ring-sky-500 focus-visible:border-sky-500"
                  />
                </div>
              )}

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
                  <ShieldAlert size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-600 flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  <span>{successMsg}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-semibold hover:from-sky-600 hover:to-emerald-600 focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-all duration-300 py-5 rounded-lg shadow-md"
              >
                {loading
                  ? '驗證中...'
                  : isRealSupabase
                    ? '透過 Google 帳號登入'
                    : '模擬 Google 安全登入'}
              </Button>
            </form>
          </CardContent>
          
          <CardFooter className="text-center justify-center pt-2 pb-6 border-t border-slate-100 mt-2">
            <span className="text-[11px] text-slate-500">
              © {new Date().getFullYear()} NextDrive. All rights reserved.
            </span>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
