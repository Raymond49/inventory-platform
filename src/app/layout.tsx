import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/layout/navbar";
import AuthProvider from "@/components/layout/auth-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "NextDrive 出入庫紀錄與 PID 掛帳追蹤平台",
  description: "出入庫紀錄與借貨庫 PID 掛帳追蹤的單一事實來源 (SSOT) 管理系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 selection:bg-sky-500/30 selection:text-sky-900">
        <AuthProvider>
          <Navbar />
          <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>
        </AuthProvider>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
