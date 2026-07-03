'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isRealSupabase, supabase } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const finishLogin = async () => {
      if (!isRealSupabase || !supabase) {
        router.replace('/');
        return;
      }

      const code = new URLSearchParams(window.location.search).get('code');

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error('未收到有效的登入資訊');
        }

        router.replace('/');
        router.refresh();
      } catch (err: any) {
        setError(err.message || '登入驗證失敗，請重新登入');
      }
    };

    finishLogin();
  }, [router]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-bold text-slate-800">
            {error ? '登入驗證失敗' : '正在完成登入'}
          </CardTitle>
          <CardDescription>
            {error ? '請回到登入頁重新進行 Google 登入。' : '請稍候，系統正在接收 Supabase 登入結果。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {error ? (
            <>
              <ShieldAlert className="h-10 w-10 text-rose-500" />
              <p className="text-sm text-rose-600 text-center">{error}</p>
              <Button onClick={() => router.replace('/login')} className="bg-sky-600 text-white hover:bg-sky-500">
                回登入頁
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-sky-600" />
              <p className="text-sm text-slate-500">登入完成後會自動返回平台。</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
