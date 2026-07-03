// 資料補登表單頁面 - 庫存異動與資產生命週期管理平台
// 支援一對多登錄：同一個申請單號下可動態新增多筆物料明細
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, transactionsApi } from '@/lib/supabase/client';
import { Profile, TX_TYPE_DIRECTION, PRODUCT_CATEGORIES, TxType } from '@/lib/supabase/mockDb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClipboardCheck,
  Layers,
  ArrowUpDown,
  UserCheck,
  Info,
  CheckCircle2,
  Plus,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

interface FormItem {
  category: string;
  partNo: string;
  quantity: number;
  warehouseId: string;
}

const TX_TYPE_OPTIONS: { value: TxType; label: string; direction: string }[] = [
  { value: '領料', label: '領料', direction: '出庫' },
  { value: '轉撥', label: '轉撥 (掛帳出庫)', direction: '出庫' },
  { value: '內部轉調', label: '內部轉調 (移轉出庫)', direction: '出庫' },
  { value: '製令', label: '製令 (出庫)', direction: '出庫' },
  { value: '銷售', label: '銷售 (出庫)', direction: '出庫' },
  { value: '退料', label: '退料 (進庫)', direction: '進庫' },
  { value: '請購', label: '請購 (入庫)', direction: '進庫' },
  { value: '轉撥退回', label: '轉撥退回 (入庫)', direction: '進庫' },
  { value: '報廢', label: '報廢 (除帳)', direction: '出庫' },
];

export default function EntryPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);

  // 主表狀態
  const [txNo, setTxNo] = useState('');
  const [txType, setTxType] = useState<TxType>('領料');
  const [direction, setDirection] = useState('出庫');
  const [customOwner, setCustomOwner] = useState('');
  const [currentDept, setCurrentDept] = useState('');
  const [sourceDept, setSourceDept] = useState('');
  const [reason, setReason] = useState('');

  // 明細表狀態 (至少要有一項物料)
  const [items, setItems] = useState<FormItem[]>([
    { category: PRODUCT_CATEGORIES[0], partNo: '', quantity: 1, warehouseId: '' }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [lastTxNo, setLastTxNo] = useState<string | null>(null);

  useEffect(() => {
    authApi.getCurrentUser().then((user) => {
      if (!user) {
        router.push('/login');
      } else {
        setCurrentUser(user);
      }
    });
  }, [router]);

  useEffect(() => {
    setDirection(TX_TYPE_DIRECTION[txType]);
  }, [txType]);

  // 動態增減明細項目
  const handleAddItem = () => {
    setItems(prev => [...prev, { category: PRODUCT_CATEGORIES[0], partNo: '', quantity: 1, warehouseId: '' }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      toast.error('必須至少有一筆產品物料項目');
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof FormItem, value: any) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    if (currentUser.role === 'Viewer') {
      toast.error('權限不足：您目前為「一般同仁」，無補登權限。');
      return;
    }

    // 主表驗證
    if (!txNo.trim()) { toast.error('請輸入系統申請單號'); return; }
    if (!customOwner.trim()) { toast.error('請輸入掛帳同仁姓名'); return; }
    if (!currentDept.trim()) { toast.error('請輸入掛帳單位'); return; }
    if (!reason.trim()) { toast.error('請輸入需求原因/備註'); return; }

    // 明細表驗證
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.partNo.trim()) { toast.error(`請輸入第 ${i + 1} 項物料的產品料號`); return; }
      if (!item.warehouseId.trim()) { toast.error(`請輸入第 ${i + 1} 項物料的異動庫別`); return; }
      if (item.quantity < 1) { toast.error(`第 ${i + 1} 項物料的數量必須大於 0`); return; }
    }

    setSubmitting(true);

    const txPayload = {
      tx_no: txNo.trim(),
      tx_type: txType,
      direction: direction as '進庫' | '出庫',
      custom_owner: customOwner.trim(),
      current_dept: currentDept.trim(),
      source_dept: (txType === '轉撥' || txType === '內部轉調') ? sourceDept.trim() : undefined,
      reason: reason.trim(),
      created_by: currentUser.id,
      updated_by: currentUser.id,
    };

    const itemsPayload = items.map(item => ({
      category: item.category,
      part_no: item.partNo.trim(),
      quantity: item.quantity,
      warehouse_id: item.warehouseId.trim(),
    }));

    try {
      const res = await transactionsApi.create(txPayload, itemsPayload);
      if (res.success && res.tx_no) {
        setLastTxNo(res.tx_no);
        toast.success(`單據 ${res.tx_no} 已登錄成功！包含 ${items.length} 項物料，請至「待補對帳」補齊明細實際資料與 PID。`);
        // 重置表單
        setTxNo('');
        setCustomOwner('');
        setCurrentDept('');
        setReason('');
        setItems([{ category: PRODUCT_CATEGORIES[0], partNo: '', quantity: 1, warehouseId: '' }]);
      } else {
        toast.error(`登錄失敗：${res.error}`);
      }
    } catch (err: any) {
      toast.error(`提交出錯：${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const isViewer = currentUser?.role === 'Viewer';

  return (
    <div className="space-y-6 font-sans text-slate-100 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col gap-1.5 border-b border-slate-900 pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent flex items-center gap-2">
          <ClipboardCheck className="text-sky-400" />
          登錄出入庫紀錄單據
        </h1>
        <p className="text-slate-400 text-sm">
          填寫系統申請單號與掛帳資訊，並於下方動態新增多個產品別、料號及異動庫別。待簽核完畢後至「待補對帳」補齊實際異動日期與 PID。
        </p>
      </div>

      {isViewer && (
        <div className="p-4 bg-rose-950/30 border border-rose-900/40 rounded-xl flex items-start gap-3 text-rose-300">
          <Info className="shrink-0 mt-0.5" size={18} />
          <div>
            <span className="font-bold block text-sm">唯讀檢視模式</span>
            您目前的角色為 <span className="underline font-semibold">一般同仁 (Viewer)</span>，僅可檢視數據。
          </div>
        </div>
      )}

      {lastTxNo && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-900/40 rounded-xl flex items-start gap-3 text-emerald-300">
          <CheckCircle2 className="shrink-0 mt-0.5" size={18} />
          <div className="text-sm">
            <span className="font-bold block">上一筆登錄成功</span>
            單號：<span className="font-mono font-bold text-emerald-200">{lastTxNo}</span>。請至<strong className="underline ml-1">待補對帳</strong>進行物料明細修補。
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">

          {/* 申請單基本資訊 */}
          <Card className="border-slate-900 bg-slate-950/40 backdrop-blur-md">
            <CardHeader className="border-b border-slate-900/60 pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-slate-200">
                <Layers size={18} className="text-emerald-400" />
                單據基本資訊
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-6">
              
              <div className="space-y-2 sm:col-span-3">
                <Label className="text-slate-300">系統申請單號 <span className="text-rose-400">*</span></Label>
                <Input
                  disabled={isViewer}
                  placeholder="例如：REQ-20260615-0001"
                  value={txNo}
                  onChange={(e) => setTxNo(e.target.value)}
                  className="bg-slate-900/60 border-slate-800 text-slate-100 font-mono"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">表單異動別 <span className="text-rose-400">*</span></Label>
                <Select disabled={isViewer} value={txType} onValueChange={(v) => setTxType(v as TxType)}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-800 text-slate-100">
                    {/* 明確顯示目前選定的異動別名稱 */}
                    <span className="flex items-center gap-2">
                      {TX_TYPE_OPTIONS.find(o => o.value === txType)?.label ?? '請選擇表單異動別'}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-950 border-slate-800 text-slate-100">
                    {TX_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.direction === '出庫' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                          {opt.label}
                          <span className="text-slate-500 text-xs">({opt.direction})</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label className="text-slate-300 flex items-center gap-1.5">
                  <ArrowUpDown size={14} className="text-slate-400" />
                  進出庫方向 (自動對應)
                </Label>
                <div className={`h-10 px-3 py-2 rounded-md border text-sm flex items-center font-semibold ${
                  direction === '進庫'
                    ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-400'
                    : 'bg-rose-950/30 border-rose-900/50 text-rose-400'
                }`}>
                  {direction === '進庫' ? '進庫 (＋)' : '出庫 (－)'}
                </div>
              </div>

            </CardContent>
          </Card>

          {/* 動態產品物料清單 */}
          <Card className="border-slate-900 bg-slate-950/40 backdrop-blur-md">
            <CardHeader className="border-b border-slate-900/60 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg text-slate-200">異動產品物料明細</CardTitle>
                <CardDescription className="text-xs">請填入此張申請單所包含的所有物料項目</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isViewer}
                onClick={handleAddItem}
                className="border-slate-800 hover:bg-slate-900 text-xs font-bold gap-1"
              >
                <Plus size={14} />
                新增物料項目
              </Button>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {items.map((item, idx) => (
                <div key={idx} className="relative p-4 border border-slate-900 bg-slate-950/60 rounded-xl space-y-4">
                  {/* 行編號與刪除按鈕 */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-900/60">
                    <span className="text-xs font-bold font-mono text-slate-500">項目 #{idx + 1}</span>
                    {items.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(idx)}
                        className="h-8 w-8 text-rose-500 hover:bg-rose-500/10 hover:text-rose-400 rounded-md"
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    {/* 產品別 */}
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-400">產品別</Label>
                      <Select
                        disabled={isViewer}
                        value={item.category}
                        onValueChange={(v) => handleItemChange(idx, 'category', v)}
                      >
                        <SelectTrigger className="bg-slate-900 border-slate-800 text-slate-100 text-xs h-9">
                          {/* 明確顯示目前選定的產品別名稱（白色字體） */}
                          <span className="text-slate-100">
                            {item.category || '請選擇產品別'}
                          </span>
                        </SelectTrigger>
                        <SelectContent className="bg-slate-950 border-slate-800 text-slate-100">
                          {PRODUCT_CATEGORIES.map(cat => (
                            <SelectItem key={cat} value={cat} className="text-slate-100">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 產品料號 */}
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-400">產品料號</Label>
                      <Input
                        disabled={isViewer}
                        placeholder="例如：PN-ATTO-V3"
                        value={item.partNo}
                        onChange={(e) => handleItemChange(idx, 'partNo', e.target.value)}
                        className="bg-slate-900 border-slate-800 text-slate-100 text-xs h-9"
                        required
                      />
                    </div>

                    {/* 數量 */}
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-400">申請數量</Label>
                      <Input
                        type="number"
                        min="1"
                        disabled={isViewer}
                        value={item.quantity}
                        onChange={(e) => handleItemChange(idx, 'quantity', parseInt(e.target.value) || 1)}
                        className="bg-slate-900 border-slate-800 text-slate-100 text-xs h-9"
                        required
                      />
                    </div>

                    {/* 庫別 */}
                    <div className="space-y-2">
                      <Label className="text-xs text-slate-400">異動庫別</Label>
                      <Input
                        disabled={isViewer}
                        placeholder="例如：南港 A 庫"
                        value={item.warehouseId}
                        onChange={(e) => handleItemChange(idx, 'warehouseId', e.target.value)}
                        className="bg-slate-900 border-slate-800 text-slate-100 text-xs h-9"
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 掛帳資訊 */}
          <Card className="border-slate-900 bg-slate-950/40 backdrop-blur-md">
            <CardHeader className="border-b border-slate-900/60 pb-4">
              <CardTitle className="text-md flex items-center gap-2 text-slate-200">
                <UserCheck size={16} className="text-sky-400" />
                掛帳同仁資訊 <span className="text-xs text-rose-400 font-normal ml-1">(強制必填)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-6">

              <div className="space-y-2">
                <Label className="text-slate-300">掛帳同仁姓名 <span className="text-rose-400">*</span></Label>
                <Input
                  disabled={isViewer}
                  placeholder="例如：陳大文"
                  value={customOwner}
                  onChange={(e) => setCustomOwner(e.target.value)}
                  className="bg-slate-900/60 border-slate-800 text-slate-100"
                  required
                />
              </div>

              {(txType === '轉撥' || txType === '內部轉調') && (
                <div className="space-y-2">
                  <Label className="text-amber-400 flex items-center gap-1.5">
                    轉出單位 (原所屬單位)
                    <span className="text-[10px] text-slate-500 font-normal">(選填，若不填將自動從 PID 歷史提取)</span>
                  </Label>
                  <Input
                    disabled={isViewer}
                    placeholder="例如：研發二部"
                    value={sourceDept}
                    onChange={(e) => setSourceDept(e.target.value)}
                    className="bg-slate-900/60 border-amber-900/40 text-slate-100"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-slate-300">掛帳同仁所屬單位 { (txType === '轉撥' || txType === '內部轉調') ? '(轉入單位)' : '' } <span className="text-rose-400">*</span></Label>
                <Input
                  disabled={isViewer}
                  placeholder="例如：研發一部"
                  value={currentDept}
                  onChange={(e) => setCurrentDept(e.target.value)}
                  className="bg-slate-900/60 border-slate-800 text-slate-100"
                  required
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label className="text-slate-300">需求原因 / 備註 <span className="text-rose-400">*</span></Label>
                <textarea
                  disabled={isViewer}
                  rows={3}
                  placeholder="請輸入申請原因或其他備註說明..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-md bg-slate-900/60 border border-slate-800 text-slate-100 p-2.5 text-sm focus:ring-1 focus:ring-sky-500 focus:outline-none placeholder:text-slate-700 disabled:opacity-50"
                  required
                />
              </div>

            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isViewer || submitting}
              className="bg-gradient-to-r from-sky-500 to-emerald-500 text-slate-950 font-bold px-8 py-5 hover:from-sky-400 hover:to-emerald-400 transition-all text-sm"
            >
              {submitting ? '登錄中...' : '確認登錄單據'}
            </Button>
          </div>

        </div>
      </form>
    </div>
  );
}
