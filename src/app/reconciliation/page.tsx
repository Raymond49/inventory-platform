// 異常對帳看板頁面 - 庫存異動與資產生命週期管理平台
// 重構後：以 transaction_items 為卡片對象，點擊時修補特定的 item 資訊與 PID
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect } from 'react';
import { authApi, transactionsApi, assetPidsApi } from '@/lib/supabase/client';
import { Profile, Transaction, TransactionItem, AssetPid, PID_REQUIRED_TX_TYPES, resolveLedgerActionForItem } from '@/lib/supabase/mockDb';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ClipboardEdit, Search, AlertCircle, CheckCircle, User, MapPin, CalendarDays, FileBarChart2, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

type DisplayItem = TransactionItem & { tx: Transaction };

export default function ReconciliationPage() {
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [allItems, setAllItems] = useState<DisplayItem[]>([]);
  const [assetPids, setAssetPids] = useState<AssetPid[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 修補對話框狀態
  const [selectedItem, setSelectedItem] = useState<DisplayItem | null>(null);
  const [repairDate, setRepairDate] = useState('');
  const [repairAdjustNo, setRepairAdjustNo] = useState('');
  const [repairPids, setRepairPids] = useState<string[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [repairSubmitting, setRepairSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);
      const allItems = await transactionsApi.getAll();
      const pidList = await assetPidsApi.getAll();
      // 僅篩選「明細待補」的明細行
      setAllItems(allItems);
      setItems(allItems.filter(i => i.reconciliation_status === '明細待補'));
      setAssetPids(pidList);
    } catch {
      toast.error('無法載入對帳資料');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const getSavedPids = (item: DisplayItem) => {
    const pending = (item.pending_pids || []).map(pid => String(pid || ''));
    if (pending.some(pid => pid.trim() !== '')) return pending;
    return assetPids.filter(p => p.current_item_id === item.id).map(p => p.pid);
  };

  const getLinkedPidCount = (item: DisplayItem) =>
    getSavedPids(item).filter(pid => pid.trim() !== '').length;

  const normalizeLedgerKey = (value: string | null | undefined) =>
    (value || '').replace(/\s+/g, '').toUpperCase();

  const isOpenLedgerAsset = (asset: AssetPid) =>
    asset.current_status !== '結案/在庫' && Boolean(asset.current_item_id);

  const getLinkedItem = (asset: AssetPid) =>
    allItems.find(i => String(i.id) === String(asset.current_item_id));

  const isSameLedgerWarehouse = (asset: AssetPid, warehouseId: string) =>
    normalizeLedgerKey(asset.current_warehouse) === normalizeLedgerKey(warehouseId) ||
    normalizeLedgerKey(asset.current_dept) === normalizeLedgerKey(warehouseId);

  const isSameLedgerOwner = (asset: AssetPid, owner: string | null | undefined) =>
    normalizeLedgerKey(asset.custom_owner) === normalizeLedgerKey(owner);

  const getClearableAssets = (item: DisplayItem) =>
    assetPids.filter(asset => {
      const linkedItem = getLinkedItem(asset);
      const isNaLedger = asset.pid?.toUpperCase() === 'N/A';
      return (
        isOpenLedgerAsset(asset) &&
        normalizeLedgerKey(linkedItem?.part_no) === normalizeLedgerKey(item.part_no) &&
        isSameLedgerWarehouse(asset, item.warehouse_id) &&
        (!isNaLedger || isSameLedgerOwner(asset, item.tx.custom_owner))
      );
    });

  const getClearablePidOptions = (item: DisplayItem) =>
    Array.from(new Set(
      getClearableAssets(item)
        .map(asset => asset.pid)
        .filter(pid => pid && pid.toUpperCase() !== 'N/A')
    )).sort();

  const getClearableNaCount = (item: DisplayItem) =>
    getClearableAssets(item).filter(asset => asset.pid.toUpperCase() === 'N/A').length;

  const handleOpenRepair = (item: DisplayItem) => {
    setSelectedItem(item);
    setRepairDate(item.actual_date || '');
    setRepairAdjustNo(item.adjust_no || '');
    const itemQuantity = Number(item.quantity) || 0;
    
    const linked = getSavedPids(item);
    const ledgerAction = resolveLedgerActionForItem(item.tx.tx_type, item, assetPids, allItems);
    const clearablePidOptions = ledgerAction === 'CLEAR_LOAN_LEDGER' ? getClearablePidOptions(item) : [];
    const clearableNaCount = ledgerAction === 'CLEAR_LOAN_LEDGER' ? getClearableNaCount(item) : 0;
    
    // 💡 新增邏輯：若為「轉撥」且產品別為特定類型（配件、原材、其他產品），自動帶入 N/A
    const isNonMachineType = ['配件', '原材', '其他產品'].includes(item.category);
    const shouldAutoFillNa = ledgerAction === 'CREATE_LOAN_LEDGER' && isNonMachineType;

    const shouldUseNaForClearing =
      ledgerAction === 'CLEAR_LOAN_LEDGER' &&
      clearableNaCount >= itemQuantity &&
      (isNonMachineType || clearablePidOptions.length === 0);
    const shouldPickPidFromList = clearablePidOptions.length > 0 && !shouldUseNaForClearing;
    const shouldUseNaForCreate = ledgerAction !== 'CLEAR_LOAN_LEDGER' && shouldAutoFillNa;
    const initialInputs = new Array(itemQuantity).fill(
      shouldPickPidFromList ? '' : (shouldUseNaForCreate || shouldUseNaForClearing ? 'N/A' : '')
    );
    
    // 如果該項目先前已有部分 PID 綁定記錄，則以記錄為主
    linked.forEach((pid, idx) => { if (idx < itemQuantity) initialInputs[idx] = String(pid || ''); });
    
    setRepairPids(initialInputs);
    setIsDialogOpen(true);
  };

  const handleRepairPidChange = (idx: number, val: string) => {
    setRepairPids(prev => { const next = [...prev]; next[idx] = val; return next; });
  };

  const handleRepairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !currentUser) return;
    if (currentUser.role === 'Viewer') { toast.error('權限不足，無法更新資料。'); return; }

    const ledgerAction = resolveLedgerActionForItem(selectedItem.tx.tx_type, selectedItem, assetPids, allItems);
    const needsPid = ledgerAction !== 'NORMAL_RECORD_ONLY';

    setRepairSubmitting(true);

    // 不需要 PID 的異動別：直接以空陣列送出
    let formattedPids: string[] = [];

    if (needsPid) {
      formattedPids = repairPids.map(p => {
        const t = p.trim();
        return t.toUpperCase() === 'N/A' ? 'N/A' : t;
      });

      const nonNaPids = formattedPids.filter(p => p !== '' && p !== 'N/A');
      const dupeInForm = nonNaPids.filter((v, i) => nonNaPids.findIndex(p => p.toUpperCase() === v.toUpperCase()) !== i);
      if (dupeInForm.length > 0) {
        toast.error(`表單內 PID 不能重複：${dupeInForm.join(', ')}`);
        setRepairSubmitting(false);
        return;
      }
    }

    try {
      const res = await transactionsApi.repair(
        selectedItem.id,
        repairDate,
        repairAdjustNo.trim(),
        formattedPids
      );

      if (res.success) {
        toast.success(res.completed ? '補登資料已完整，明細已結案。' : '補登資料已暫存，尚未完整前會保留在待補看板。');
        setIsDialogOpen(false);
        fetchData();
      } else {
        toast.error(`更新失敗：${res.error}`);
      }
    } catch (err: any) {
      toast.error(`更新出錯：${err.message}`);
    } finally {
      setRepairSubmitting(false);
    }
  };

  const isViewer = currentUser?.role === 'Viewer';

  const selectedLedgerAction = selectedItem
    ? resolveLedgerActionForItem(selectedItem.tx.tx_type, selectedItem, assetPids, allItems)
    : 'NORMAL_RECORD_ONLY';
  const selectedClearablePidOptions = selectedItem && selectedLedgerAction === 'CLEAR_LOAN_LEDGER'
    ? getClearablePidOptions(selectedItem)
    : [];
  const selectedClearableNaCount = selectedItem && selectedLedgerAction === 'CLEAR_LOAN_LEDGER'
    ? getClearableNaCount(selectedItem)
    : 0;
  const selectedIsNonMachineType = selectedItem
    ? ['配件', '原材', '其他產品'].includes(selectedItem.category)
    : false;
  const shouldUseNaOnlyClearing =
    selectedItem &&
    selectedLedgerAction === 'CLEAR_LOAN_LEDGER' &&
    selectedClearableNaCount >= (Number(selectedItem.quantity) || 0) &&
    (selectedIsNonMachineType || selectedClearablePidOptions.length === 0);
  const shouldUseClearPidSelect =
    selectedLedgerAction === 'CLEAR_LOAN_LEDGER' &&
    selectedClearablePidOptions.length > 0 &&
    !shouldUseNaOnlyClearing;

  const filteredItems = items.filter(item =>
    item.tx.tx_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.part_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tx.tx_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tx.custom_owner?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    assetPids.filter(p => p.current_item_id === item.id).some(p => p.pid.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6 font-sans text-slate-900 pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-slate-700 to-slate-600 bg-clip-text text-transparent flex items-center gap-2">
            <AlertTriangle className="text-amber-600 animate-pulse" />
            待補對帳看板
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            標示所有「明細待補」的物料項目。請在單據完成後，補齊<strong className="text-amber-600 mx-1">實際異動日期、存貨調整單號</strong>與<strong className="text-amber-600 ml-1">PID</strong>。
          </p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            placeholder="搜尋單號、產品別、料號、掛帳同仁..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-white border-slate-300 text-slate-800 placeholder:text-slate-400"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-slate-200 rounded-2xl bg-slate-50">
          <CheckCircle className="text-emerald-500 mx-auto mb-3" size={44} />
          <h3 className="text-lg font-bold text-slate-700">目前無任何待對帳物料項目</h3>
          <p className="text-slate-500 text-sm mt-1">所有單據明細的 PID 都已完整補齊落帳！</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => {
            const ledgerAction = resolveLedgerActionForItem(item.tx.tx_type, item, assetPids, allItems);
            const savedPids = getSavedPids(item);
            const needsPid = ledgerAction !== 'NORMAL_RECORD_ONLY';
            const currentLinked = needsPid ? getLinkedPidCount(item) : 0;
            const missing = needsPid ? item.quantity - currentLinked : 0;

            return (
              <Card key={item.id} className="border-amber-200 bg-white shadow-sm flex flex-col hover:border-amber-400 transition-all">
                <CardHeader className="border-b border-slate-100 pb-3 flex flex-row justify-between items-start gap-2">
                  <div className="space-y-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                      ['製令','領料','轉撥','內部轉調','銷售','報廢'].includes(item.tx.tx_type)
                        ? 'bg-rose-50 text-rose-600 border-rose-200'
                        : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                    }`}>
                      {item.tx.tx_type}
                    </span>
                    <div className="font-mono font-bold text-base text-slate-800 flex items-center gap-1.5">
                      <FolderOpen size={14} className="text-slate-500" />
                      {item.tx.tx_no}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <span className="block">登錄日期</span>
                    <span className="text-slate-600 font-mono">{item.created_at.slice(0, 10)}</span>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 pt-4 space-y-3">
                  {/* 缺件警示 */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-700">
                    <AlertCircle size={15} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">物料待補明細：</span>
                      {needsPid ? (
                        <>
                          應補數量 <span className="font-mono font-bold">{item.quantity}</span>，目前已暫存 <span className="font-mono font-bold">{currentLinked}</span>，尚缺 <span className="font-mono font-bold text-rose-600">{missing}</span> 個 PID。
                        </>
                      ) : (
                        <>此筆只需補登實際異動日期與存貨調整單號，不會建立 PID 掛帳。</>
                      )}
                      {needsPid && currentLinked > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {savedPids.filter(p => p.trim() !== '').map((p, pIdx) => (
                            <span key={`${p}-${pIdx}`} className="px-1.5 py-0.5 bg-amber-100 border border-amber-200 rounded text-[10px] font-mono text-amber-800">
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 物料細節 */}
                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-3">
                    <div>
                      <span className="text-slate-500 block">產品別 / 料號</span>
                      <span className="text-slate-800 font-medium">{item.category} / <span className="font-mono">{item.part_no}</span></span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">異動庫別</span>
                      <span className="text-slate-800 font-medium">{item.warehouse_id}</span>
                    </div>
                  </div>

                  {/* 掛帳同仁 */}
                  <div className="text-xs border-t border-slate-100 pt-2.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <User size={12} className="text-slate-400" />
                      <span>掛帳同仁：</span>
                      <span className="text-slate-800 font-semibold">{item.tx.custom_owner}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <MapPin size={12} className="text-slate-400" />
                      <span>掛帳單位：</span>
                      <span className="text-slate-800 font-semibold">{item.tx.current_dept}</span>
                    </div>
                  </div>

                  {/* 原因 */}
                  {item.tx.reason && (
                    <div className="text-xs border-t border-slate-100 pt-2">
                      <p className="text-slate-600 leading-relaxed line-clamp-2 bg-slate-50 p-2 rounded">
                        {item.tx.reason}
                      </p>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="border-t border-slate-100 pt-3 pb-4">
                  {isViewer ? (
                    <Button disabled className="w-full bg-slate-100 border-slate-200 text-slate-400 text-xs">
                      唯讀模式
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleOpenRepair(item)}
                      className="w-full bg-amber-500 text-white font-bold hover:bg-amber-400 transition-all gap-1.5"
                    >
                      <ClipboardEdit size={14} />
                      補登 / 暫存資料
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* 修補物料明細對話框 */}
      <Dialog
        open={isDialogOpen}
        disablePointerDismissal={true}
        onOpenChange={(nextOpen, { reason }) => {
          // 雙重保險：攔截
          if (reason === 'outside-press' || reason === 'escape-key') {
            return;
          }
          setIsDialogOpen(nextOpen);
        }}
      >

        <DialogContent className="bg-white border-slate-200 text-slate-800 font-sans max-w-lg">
          <form onSubmit={handleRepairSubmit}>

            <DialogHeader className="border-b border-slate-200 pb-3">
              <DialogTitle className="text-lg flex items-center gap-2 text-slate-800">
                <ClipboardEdit className="text-amber-600" />
                補齊物料對帳：{selectedItem?.tx.tx_no}
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-xs space-y-0.5">
                <span className="block">產品：{selectedItem?.category} ({selectedItem?.part_no}) | 異動別：{selectedItem?.tx.tx_type}</span>
                <span className="block">掛帳人：{selectedItem?.tx.custom_owner} ({selectedItem?.tx.current_dept})</span>
                {selectedItem && selectedLedgerAction === 'CLEAR_LOAN_LEDGER' ? (
                  <span className="block text-rose-600 font-bold">此筆領料的料號與異動庫別已有掛帳，系統會依 PID 或 N/A 數量結案既有掛帳。</span>
                ) : selectedItem && selectedLedgerAction !== 'NORMAL_RECORD_ONLY' ? (
                  <span className="block text-amber-600 font-bold">日期、調整單號與 PID 可分次暫存；三項齊全後才會結案。</span>
                ) : (
                  <span className="block text-sky-600 font-bold">日期與調整單號可分次暫存；兩項齊全後才會結案。</span>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-4 my-1">
              <div className="space-y-2">
                <Label className="text-slate-700 flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-sky-600" />
                  實際異動日期
                </Label>
                <Input
                  type="date"
                  value={repairDate}
                  onChange={(e) => setRepairDate(e.target.value)}
                  className="bg-white border-slate-300 text-slate-900"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-700 flex items-center gap-1.5">
                  <FileBarChart2 size={14} className="text-emerald-600" />
                  存貨調整單號
                </Label>
                <Input
                  placeholder="請輸入 ERP 存貨調整單號，例如：ADJ-20260615-001"
                  value={repairAdjustNo}
                  onChange={(e) => setRepairAdjustNo(e.target.value)}
                  className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                />
              </div>

              {/* 需建立或除帳借貨庫掛帳時，顯示 PID / N/A 輸入區 */}
              {selectedItem && selectedLedgerAction !== 'NORMAL_RECORD_ONLY' && (
                <div className="space-y-2">
                  <Label className="text-slate-700">
                    {selectedLedgerAction === 'CLEAR_LOAN_LEDGER' ? '除帳 PID / N/A 帳值' : '產品 PID / N/A 帳值'} (共 {selectedItem?.quantity} 個)
                  </Label>
                  <div className="max-h-[180px] overflow-y-auto pr-1 space-y-2">
                    {repairPids.map((pidVal, idx) => {
                      const safePidVal = pidVal || '';
                      return (
                      <div key={idx} className="flex items-center gap-2">
                        <Label className="text-xs font-mono text-slate-500 w-7 text-right shrink-0">#{idx + 1}</Label>
                        {shouldUseClearPidSelect ? (
                          <Select
                            value={safePidVal || null}
                            onValueChange={(value) => handleRepairPidChange(idx, value || '')}
                          >
                            <SelectTrigger className={`flex-1 bg-white border-slate-300 text-slate-900 h-10 ${
                              safePidVal ? 'border-emerald-500' : ''
                            }`}>
                              <SelectValue placeholder="選擇可除帳 PID" />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200 text-slate-800">
                              {selectedClearableNaCount > 0 && (
                                <SelectItem value="N/A">N/A（無獨立 PID）</SelectItem>
                              )}
                              {selectedClearablePidOptions.map(pid => (
                                <SelectItem key={pid} value={pid}>{pid}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            placeholder="輸入 PID (或填 N/A)"
                            value={safePidVal}
                            onChange={(e) => handleRepairPidChange(idx, e.target.value)}
                            className={`bg-white text-slate-900 ${
                              safePidVal.toUpperCase() === 'N/A'
                                ? 'border-slate-300 text-slate-500 font-bold'
                                : safePidVal.trim()
                                  ? 'border-emerald-500'
                                  : 'border-slate-300'
                            }`}
                          />
                        )}
                      </div>
                    )})}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    系統以料號與異動庫別判斷動作；有獨立 PID 請輸入 PID，無獨立 PID 的帳值請填入 <code className="text-sky-600 bg-sky-50 px-1 rounded">N/A</code>。
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-slate-200 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                className="border-slate-300 text-slate-600 hover:bg-slate-50"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={repairSubmitting}
                className="bg-amber-500 text-white font-bold hover:bg-amber-400"
              >
                {repairSubmitting ? '儲存中...' : '儲存補登資料'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
