'use client';

import { useEffect, useMemo, useState } from 'react';
import { authApi, isRealSupabase } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Download, FileCode2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

type LocalExportPayload = {
  format: 'nd-inventory-localstorage-v1';
  exportedAt: string;
  sourceOrigin: string;
  profiles: unknown[];
  transactions: unknown[];
  transactionItems: unknown[];
  assetPids: unknown[];
  loginLogs: unknown[];
};

const STORAGE_KEYS = {
  PROFILES: 'nd_inventory_profiles',
  TRANSACTIONS: 'nd_inventory_transactions',
  TRANSACTION_ITEMS: 'nd_inventory_transaction_items',
  ASSET_PIDS: 'nd_inventory_pids',
  LOGIN_LOGS: 'nd_inventory_login_logs',
};

const DEFAULT_ADMIN_EMAIL = 'raymond.chen@nextdrive.io';

function readLocalArray(key: string): unknown[] {
  if (typeof window === 'undefined') return [];

  try {
    const value = localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildLocalPayload(): LocalExportPayload {
  return {
    format: 'nd-inventory-localstorage-v1',
    exportedAt: new Date().toISOString(),
    sourceOrigin: window.location.origin,
    profiles: readLocalArray(STORAGE_KEYS.PROFILES),
    transactions: readLocalArray(STORAGE_KEYS.TRANSACTIONS),
    transactionItems: readLocalArray(STORAGE_KEYS.TRANSACTION_ITEMS),
    assetPids: readLocalArray(STORAGE_KEYS.ASSET_PIDS),
    loginLogs: readLocalArray(STORAGE_KEYS.LOGIN_LOGS),
  };
}

function downloadText(fileName: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fileStamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function jsonBlock(tag: string, value: unknown[]) {
  const text = JSON.stringify(value);
  const safeTag = tag.replace(/[^a-zA-Z0-9_]/g, '_');
  return `$${safeTag}$${text}$${safeTag}$`;
}

function buildImportSql(payload: LocalExportPayload, adminEmail: string) {
  const email = sqlString(adminEmail.trim());

  return `-- NextDrive inventory platform local test data import
-- Source: ${payload.sourceOrigin}
-- Exported at: ${payload.exportedAt}
-- Run this in Supabase SQL Editor on the production project.

begin;

do $$
begin
  if not exists (select 1 from public.profiles where email = ${email}) then
    raise exception 'Cannot find Admin profile for %', ${email};
  end if;
end $$;

alter table public.asset_pids disable trigger trigger_asset_status_and_history;

delete from public.asset_pids;
delete from public.transaction_items;
delete from public.transactions;

with import_user as (
  select id from public.profiles where email = ${email} limit 1
)
insert into public.transactions (
  id,
  tx_no,
  tx_type,
  direction,
  custom_owner,
  current_dept,
  source_dept,
  reason,
  created_by,
  updated_by,
  created_at
)
select
  x.id::uuid,
  x.tx_no,
  x.tx_type::tx_type_enum,
  x.direction::direction_enum,
  coalesce(x.custom_owner, ''),
  coalesce(x.current_dept, ''),
  nullif(x.source_dept, ''),
  coalesce(x.reason, ''),
  (select id from import_user),
  (select id from import_user),
  coalesce(nullif(x.created_at, '')::timestamptz, now())
from jsonb_to_recordset(${jsonBlock('transactions_json', payload.transactions)}::jsonb) as x(
  id text,
  tx_no text,
  tx_type text,
  direction text,
  custom_owner text,
  current_dept text,
  source_dept text,
  reason text,
  created_at text
);

insert into public.transaction_items (
  id,
  transaction_id,
  category,
  part_no,
  quantity,
  warehouse_id,
  actual_date,
  adjust_no,
  pending_pids,
  reconciliation_status,
  created_at
)
select
  x.id::uuid,
  x.transaction_id::uuid,
  coalesce(x.category, ''),
  coalesce(x.part_no, ''),
  greatest(coalesce(x.quantity, 1), 1),
  coalesce(x.warehouse_id, ''),
  nullif(x.actual_date, '')::date,
  nullif(x.adjust_no, ''),
  case
    when x.pending_pids is null or jsonb_typeof(x.pending_pids) <> 'array' then null
    else array(select jsonb_array_elements_text(x.pending_pids))
  end,
  nullif(x.reconciliation_status, '')::reconciliation_status_enum,
  coalesce(nullif(x.created_at, '')::timestamptz, now())
from jsonb_to_recordset(${jsonBlock('transaction_items_json', payload.transactionItems)}::jsonb) as x(
  id text,
  transaction_id text,
  category text,
  part_no text,
  quantity integer,
  warehouse_id text,
  actual_date text,
  adjust_no text,
  pending_pids jsonb,
  reconciliation_status text,
  created_at text
);

insert into public.asset_pids (
  id,
  pid,
  current_item_id,
  current_status,
  current_owner_id,
  custom_owner,
  current_dept,
  current_warehouse,
  history_logs,
  notes,
  created_at
)
select
  x.id::uuid,
  coalesce(x.pid, 'N/A'),
  nullif(x.current_item_id, '')::uuid,
  nullif(x.current_status, '')::asset_status_enum,
  null,
  nullif(x.custom_owner, ''),
  nullif(x.current_dept, ''),
  nullif(x.current_warehouse, ''),
  coalesce(x.history_logs, '[]'::jsonb),
  nullif(x.notes, ''),
  coalesce(nullif(x.created_at, '')::timestamptz, now())
from jsonb_to_recordset(${jsonBlock('asset_pids_json', payload.assetPids)}::jsonb) as x(
  id text,
  pid text,
  current_item_id text,
  current_status text,
  custom_owner text,
  current_dept text,
  current_warehouse text,
  history_logs jsonb,
  notes text,
  created_at text
);

alter table public.asset_pids enable trigger trigger_asset_status_and_history;

notify pgrst, 'reload schema';

commit;
`;
}

export default function AdminImportPage() {
  const [adminEmail, setAdminEmail] = useState(DEFAULT_ADMIN_EMAIL);
  const [payload, setPayload] = useState<LocalExportPayload | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkedUser, setCheckedUser] = useState(false);

  useEffect(() => {
    authApi.getCurrentUser().then((user) => {
      setIsAdmin(user?.role === 'Admin');
      setCheckedUser(true);
    });
  }, []);

  const counts = useMemo(() => {
    if (!payload) return null;
    return {
      transactions: payload.transactions.length,
      items: payload.transactionItems.length,
      assets: payload.assetPids.length,
    };
  }, [payload]);

  const sql = useMemo(() => {
    if (!payload || !adminEmail.trim()) return '';
    return buildImportSql(payload, adminEmail);
  }, [payload, adminEmail]);

  const refreshPayload = () => {
    const nextPayload = buildLocalPayload();
    setPayload(nextPayload);
    toast.success('已讀取本機測試資料');
  };

  const downloadJson = () => {
    const nextPayload = payload || buildLocalPayload();
    setPayload(nextPayload);
    downloadText(
      `nextdrive-inventory-local-${fileStamp()}.json`,
      JSON.stringify(nextPayload, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const downloadSql = () => {
    const nextPayload = payload || buildLocalPayload();
    setPayload(nextPayload);
    const nextSql = buildImportSql(nextPayload, adminEmail);
    downloadText(`nextdrive-inventory-import-${fileStamp()}.sql`, nextSql, 'text/sql;charset=utf-8');
  };

  if (checkedUser && !isAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <section className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>沒有匯入權限</CardTitle>
              <CardDescription>只有系統管理員可以使用既有資料匯入工具。</CardDescription>
            </CardHeader>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">既有資料匯入工具</h1>
            <p className="mt-2 text-sm text-slate-600">
              在本機測試站產生匯入檔，再到正式 Supabase SQL Editor 執行。
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            {isRealSupabase ? '正式站模式' : '本機測試模式'}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-sky-600" />
              讀取本機測試資料
            </CardTitle>
            <CardDescription>
              請先在原本測試資料所在的網址開啟本頁，通常是 localhost 的測試站，才能讀到那個網址的 localStorage。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="admin-email">正式站 Admin email</Label>
                <Input
                  id="admin-email"
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  placeholder="raymond.chen@nextdrive.io"
                />
              </div>
              <Button type="button" variant="outline" onClick={refreshPayload}>
                讀取資料
              </Button>
              <Button type="button" onClick={downloadJson}>
                <Download className="mr-2 h-4 w-4" />
                下載 JSON 備份
              </Button>
            </div>

            {counts && (
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="rounded-md border bg-white p-4">
                  <div className="text-slate-500">申請單</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{counts.transactions}</div>
                </div>
                <div className="rounded-md border bg-white p-4">
                  <div className="text-slate-500">明細項目</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{counts.items}</div>
                </div>
                <div className="rounded-md border bg-white p-4">
                  <div className="text-slate-500">掛帳 PID / N/A</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">{counts.assets}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-5 w-5 text-orange-600" />
              產生 Supabase 匯入 SQL
            </CardTitle>
            <CardDescription>
              此 SQL 會清空正式站目前的出入庫、待補與掛帳資料，再匯入本機測試資料；profiles 不會被覆蓋。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={downloadSql} disabled={!adminEmail.trim()}>
                <Download className="mr-2 h-4 w-4" />
                下載匯入 SQL
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!sql}
                onClick={() => {
                  navigator.clipboard.writeText(sql);
                  toast.success('已複製匯入 SQL');
                }}
              >
                複製 SQL
              </Button>
            </div>

            <textarea
              readOnly
              value={sql || '請先按「讀取資料」或「下載匯入 SQL」產生內容。'}
              className="min-h-[320px] w-full resize-y rounded-md border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none"
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
