// PID 生命週期查詢頁面 - 庫存異動與資產生命週期管理平台
// 強制使用繁體中文，支援按 PID、掛帳單位、產品料號三種維度查詢
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { assetPidsApi, transactionsApi } from '@/lib/supabase/client';
import { AssetPid, HistoryLog, PID_REQUIRED_TX_TYPES } from '@/lib/supabase/mockDb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { 
  Search, 
  History, 
  User, 
  MapPin, 
  FileText, 
  Calendar, 
  AlertCircle,
  TrendingUp,
  Hash,
  Info,
  Package,
  ListFilter,
  Eye,
  Download,
  Layers,
  Pencil
} from 'lucide-react';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ExcelJS from 'exceljs';

type SearchType = 'pid' | 'dept' | 'owner' | 'part_no' | 'tx_no' | 'multi';
type LedgerAuditIssue = {
  txNo: string;
  txType: string;
  partNo: string;
  category: string;
  warehouseId: string;
  owner: string;
  dept: string;
  quantity: number;
  trackedCount: number;
  openCount: number;
  missingCount: number;
  historyGap: number;
};
type LedgerOptionRow = {
  dept: string;
  owner: string;
  txNo: string;
  partNo: string;
};

const UNASSIGNED_LABEL = '未掛帳';

const isOpenLedgerAsset = (asset: AssetPid) =>
  asset.current_status !== '結案/在庫' && Boolean(asset.custom_owner || asset.current_dept);

const getAssetStatusLabel = (status: string) => {
  switch (status) {
    case '結案/在庫':
      return '已結案/未掛帳';
    case '外借/掛帳中':
      return '掛帳中';
    default:
      return status;
  }
};

function LifecyclePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const queryType = (searchParams.get('type') as SearchType) || 'pid';
  const queryVal = searchParams.get('val') || '';

  const [searchType, setSearchType] = useState<SearchType>(queryType);
  const [searchVal, setSearchVal] = useState(queryVal);
  
  // 多重條件過濾狀態 (用於 multi 模式)
  const [selectedDept, setSelectedDept] = useState<string>('ALL_DEPTS');
  const [selectedOwner, setSelectedOwner] = useState<string>('ALL_OWNERS');
  const [selectedTxNo, setSelectedTxNo] = useState<string>('ALL_TX_NOS');
  const [selectedPartNo, setSelectedPartNo] = useState<string>('ALL_PARTS');

  // 動態選單選項
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  const [ownerOptions, setOwnerOptions] = useState<string[]>([]);
  const [partNoOptions, setPartNoOptions] = useState<string[]>([]);
  const [txNoOptions, setTxNoOptions] = useState<string[]>([]);
  const [ledgerOptionRows, setLedgerOptionRows] = useState<LedgerOptionRow[]>([]);
  
  // 統計數據狀態
  const [deptStats, setDeptStats] = useState<{name: string, count: number}[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [ledgerAuditIssues, setLedgerAuditIssues] = useState<LedgerAuditIssue[]>([]);
  const [correctionResult, setCorrectionResult] = useState<{ correctedCount: number; remainingCount: number; message?: string } | null>(null);

  // 搜尋結果狀態
  const [assetInfo, setAssetInfo] = useState<AssetPid | null>(null); // 用於 PID 精確匹配
  const [assetList, setAssetList] = useState<(AssetPid & { category?: string; part_no?: string; tx_no?: string })[]>([]);       // 用於單位或料號查詢
  const [history, setHistory] = useState<HistoryLog[]>([]);
  
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [editingAsset, setEditingAsset] = useState<(AssetPid & { category?: string; part_no?: string; tx_no?: string }) | null>(null);
  const [editOwner, setEditOwner] = useState('');
  const [editDept, setEditDept] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);

  const runLedgerCorrection = async () => {
    const correction = await assetPidsApi.applySpecificLedgerCorrection();
    const result = {
      correctedCount: correction.correctedCount || 0,
      remainingCount: correction.remainingCount || 0,
      message: correction.message,
    };
    setCorrectionResult(result.correctedCount > 0 || result.remainingCount > 0 ? result : null);
    return result;
  };

  // 初始化時提取所有不重複的單位與料號，並計算各單位統計
  useEffect(() => {
    const loadData = async () => {
      await runLedgerCorrection();
      const currentPids = await assetPidsApi.getAll();
      const allAssetPids = currentPids;
      const allItems = await transactionsApi.getAll();

      // 提取所有掛帳單位與統計
      const deptMap: Record<string, number> = {};
      const deptsSet = new Set<string>();

      allAssetPids.forEach(p => {
        if (isOpenLedgerAsset(p) && p.current_dept && p.current_dept !== 'N/A') {
          deptsSet.add(p.current_dept);
          deptMap[p.current_dept] = (deptMap[p.current_dept] || 0) + 1;
        }
      });

      const depts = Array.from(deptsSet).sort();
      setDeptOptions(depts);

      const stats = depts.map(d => ({ name: d, count: deptMap[d] }))
        .sort((a, b) => b.count - a.count);

      setDeptStats(stats);
      setTotalAssets(allAssetPids.filter(isOpenLedgerAsset).length);

      const optionRows = allAssetPids
        .filter(asset => isOpenLedgerAsset(asset) && asset.current_dept && asset.current_dept !== 'N/A')
        .map(asset => {
          const linkedItem = allItems.find(item => String(item.id) === String(asset.current_item_id));
          const owner = asset.custom_owner || linkedItem?.tx.custom_owner;
          if (!linkedItem?.tx.tx_no || !linkedItem.part_no || !asset.current_dept || !owner) return null;
          return {
            dept: asset.current_dept,
            owner,
            txNo: linkedItem.tx.tx_no,
            partNo: linkedItem.part_no,
          };
        })
        .filter((row): row is LedgerOptionRow => Boolean(row));
      setLedgerOptionRows(optionRows);
      setOwnerOptions(Array.from(new Set(optionRows.map(row => row.owner))).sort());

      const qaAuditIssues = allItems
        .filter(item =>
          item.reconciliation_status === '已結案' &&
          item.warehouse_id === 'TW : QA' &&
          PID_REQUIRED_TX_TYPES.includes(item.tx.tx_type)
        )
        .map(item => {
          const hasItemHistory = (asset: AssetPid) =>
            (asset.history_logs || []).some((log: HistoryLog) => String(log.item_id) === String(item.id));
          const trackedCount = allAssetPids.filter(hasItemHistory).length;
          const openCount = allAssetPids.filter(asset =>
            hasItemHistory(asset) &&
            isOpenLedgerAsset(asset)
          ).length;
          const quantity = Math.max(0, Number(item.quantity) || 0);

          return {
            txNo: item.tx.tx_no,
            txType: item.tx.tx_type,
            partNo: item.part_no,
            category: item.category,
            warehouseId: item.warehouse_id,
            owner: item.tx.custom_owner,
            dept: item.tx.current_dept,
            quantity,
            trackedCount,
            openCount,
            missingCount: quantity - trackedCount,
            historyGap: quantity - trackedCount,
          };
        })
        .filter(issue => issue.missingCount > 0)
        .sort((a, b) => b.missingCount - a.missingCount || a.txNo.localeCompare(b.txNo));
      setLedgerAuditIssues(qaAuditIssues);

      // 提取所有目前確實有資產實體 (PID) 關聯的申請單號
      const activeTxNos = new Set<string>();
      allAssetPids.forEach(p => {
        const linkedItem = allItems.find(i => String(i.id) === String(p.current_item_id));
        if (linkedItem?.tx.tx_no) {
          activeTxNos.add(linkedItem.tx.tx_no);
        }
      });
      setTxNoOptions(Array.from(activeTxNos).sort());

      // 提取所有目前確實有資產實體 (PID) 關聯的產品料號
      const activePartNos = new Set<string>();
      allAssetPids.forEach(p => {
        const linkedItem = allItems.find(i => String(i.id) === String(p.current_item_id));
        if (linkedItem?.part_no) {
          activePartNos.add(linkedItem.part_no);
        }
      });
      
      const parts = Array.from(activePartNos).sort();
      setPartNoOptions(parts);
    };
    loadData();
  }, []);

  const multiDeptOptions = useMemo(() => {
    const rows = ledgerOptionRows.filter(row =>
      (selectedTxNo === 'ALL_TX_NOS' || row.txNo === selectedTxNo) &&
      (selectedPartNo === 'ALL_PARTS' || row.partNo === selectedPartNo) &&
      (selectedOwner === 'ALL_OWNERS' || row.owner === selectedOwner)
    );
    return Array.from(new Set(rows.map(row => row.dept))).sort();
  }, [ledgerOptionRows, selectedTxNo, selectedPartNo, selectedOwner]);

  const multiTxNoOptions = useMemo(() => {
    const rows = ledgerOptionRows.filter(row =>
      (selectedDept === 'ALL_DEPTS' || row.dept === selectedDept) &&
      (selectedPartNo === 'ALL_PARTS' || row.partNo === selectedPartNo) &&
      (selectedOwner === 'ALL_OWNERS' || row.owner === selectedOwner)
    );
    return Array.from(new Set(rows.map(row => row.txNo))).sort();
  }, [ledgerOptionRows, selectedDept, selectedPartNo, selectedOwner]);

  const multiPartNoOptions = useMemo(() => {
    const rows = ledgerOptionRows.filter(row =>
      (selectedDept === 'ALL_DEPTS' || row.dept === selectedDept) &&
      (selectedTxNo === 'ALL_TX_NOS' || row.txNo === selectedTxNo) &&
      (selectedOwner === 'ALL_OWNERS' || row.owner === selectedOwner)
    );
    return Array.from(new Set(rows.map(row => row.partNo))).sort();
  }, [ledgerOptionRows, selectedDept, selectedTxNo, selectedOwner]);

  const multiOwnerOptions = useMemo(() => {
    const rows = ledgerOptionRows.filter(row =>
      (selectedDept === 'ALL_DEPTS' || row.dept === selectedDept) &&
      (selectedTxNo === 'ALL_TX_NOS' || row.txNo === selectedTxNo) &&
      (selectedPartNo === 'ALL_PARTS' || row.partNo === selectedPartNo)
    );
    return Array.from(new Set(rows.map(row => row.owner))).sort();
  }, [ledgerOptionRows, selectedDept, selectedTxNo, selectedPartNo]);

  useEffect(() => {
    if (selectedDept !== 'ALL_DEPTS' && !multiDeptOptions.includes(selectedDept)) {
      setSelectedDept('ALL_DEPTS');
    }
  }, [multiDeptOptions, selectedDept]);

  useEffect(() => {
    if (selectedTxNo !== 'ALL_TX_NOS' && !multiTxNoOptions.includes(selectedTxNo)) {
      setSelectedTxNo('ALL_TX_NOS');
    }
  }, [multiTxNoOptions, selectedTxNo]);

  useEffect(() => {
    if (selectedPartNo !== 'ALL_PARTS' && !multiPartNoOptions.includes(selectedPartNo)) {
      setSelectedPartNo('ALL_PARTS');
    }
  }, [multiPartNoOptions, selectedPartNo]);

  useEffect(() => {
    if (selectedOwner !== 'ALL_OWNERS' && !multiOwnerOptions.includes(selectedOwner)) {
      setSelectedOwner('ALL_OWNERS');
    }
  }, [multiOwnerOptions, selectedOwner]);

  const performSearch = async (type: SearchType, val: string) => {
    if (!val.trim() && type === 'pid') return;
    setSearching(true);
    setHasSearched(true);
    setAssetInfo(null);
    setAssetList([]);
    setHistory([]);

    try {
      await runLedgerCorrection();
      const allAssetPids = await assetPidsApi.getAll();
      const allItems = await transactionsApi.getAll();
      const getLinkedItem = (asset: AssetPid) =>
        allItems.find(i => String(i.id) === String(asset.current_item_id));
      const getEffectiveOwner = (asset: AssetPid) =>
        asset.custom_owner || getLinkedItem(asset)?.tx?.custom_owner || UNASSIGNED_LABEL;

      if (type === 'pid') {
        const exactMatch = allAssetPids.find(
          p => p.pid.toUpperCase() === val.trim().toUpperCase()
        );
        if (exactMatch) {
          const linkedItem = getLinkedItem(exactMatch);
          const enhancedMatch = {
            ...exactMatch,
            current_warehouse: exactMatch.current_warehouse || exactMatch.current_dept || linkedItem?.tx?.current_dept || UNASSIGNED_LABEL,
            current_dept: exactMatch.current_dept || linkedItem?.tx?.current_dept || UNASSIGNED_LABEL,
            custom_owner: getEffectiveOwner(exactMatch)
          };
          setAssetInfo(enhancedMatch);
          setHistory([...(enhancedMatch.history_logs || [])].reverse());
          toast.success(`已載入 ${enhancedMatch.pid} 的異動履歷`);
        } else {
          toast.error('找不到該 PID 號碼的資產紀錄');
        }
      } else {
        // 複合查詢邏輯
        let filteredPids = [...allAssetPids].filter(isOpenLedgerAsset);
        let d = selectedDept;
        let o = selectedOwner;
        let t = selectedTxNo;
        let p = selectedPartNo;

        // 解析 URL 傳來的複合參數
        if (type === 'multi' && val.includes('|')) {
          const [vDept, vTx, vPart, vOwner = 'ALL_OWNERS'] = val.split('|');
          d = vDept; t = vTx; p = vPart; o = vOwner;
          setSelectedDept(d); setSelectedTxNo(t); setSelectedPartNo(p); setSelectedOwner(o);
        }

        // 1. 處理單位過濾
        const deptVal = type === 'multi' ? d : (type === 'dept' ? val : 'ALL_DEPTS');
        if (deptVal !== 'ALL_DEPTS') {
          filteredPids = filteredPids.filter(obj => obj.current_dept === deptVal);
        }

        // 2. 處理單號過濾
        const ownerVal = type === 'multi' ? o : (type === 'owner' ? val : 'ALL_OWNERS');
        if (ownerVal !== 'ALL_OWNERS') {
          filteredPids = filteredPids.filter(obj => getEffectiveOwner(obj) === ownerVal);
        }

        const txVal = type === 'multi' ? t : (type === 'tx_no' ? val : 'ALL_TX_NOS');
        if (txVal !== 'ALL_TX_NOS') {
          filteredPids = filteredPids.filter(obj => {
            const linkedItem = getLinkedItem(obj);
            return linkedItem?.tx.tx_no === txVal;
          });
        }

        // 3. 處理料號過濾
        const partVal = type === 'multi' ? p : (type === 'part_no' ? val : 'ALL_PARTS');
        if (partVal !== 'ALL_PARTS') {
          filteredPids = filteredPids.filter(obj => {
            const linkedItem = getLinkedItem(obj);
            return linkedItem?.part_no === partVal;
          });
        }

        const matches = filteredPids.map(obj => {
          const linkedItem = getLinkedItem(obj);
          return {
            ...obj,
            category: linkedItem?.category,
            part_no: linkedItem?.part_no,
            tx_no: linkedItem?.tx.tx_no,
            current_warehouse: obj.current_warehouse || obj.current_dept || linkedItem?.tx?.current_dept || UNASSIGNED_LABEL,
            current_dept: obj.current_dept || linkedItem?.tx?.current_dept || UNASSIGNED_LABEL,
            custom_owner: getEffectiveOwner(obj)
          };
        });

        setAssetList(matches);
        if (matches.length > 0) {
          toast.success(`找到 ${matches.length} 筆符合條件的資產紀錄`);
        } else {
          toast.error('找不到符合條件的資產紀錄');
        }
      }
    } catch (err: any) {
      toast.error('查詢出錯，請稍後再試');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (queryVal || (queryType === 'dept' && queryVal === 'ALL_DEPTS')) {
      setSearchType(queryType);
      setSearchVal(queryVal);
      performSearch(queryType, queryVal);
    } else {
      setHasSearched(false);
      setAssetInfo(null);
      setAssetList([]);
    }
  }, [queryType, queryVal]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchType === 'pid') {
      if (!searchVal.trim()) { toast.error('請輸入 PID 號碼'); return; }
      router.push(`/lifecycle?type=pid&val=${encodeURIComponent(searchVal.trim())}`);
    } else if (searchType === 'multi') {
      const compositeVal = `${selectedDept}|${selectedTxNo}|${selectedPartNo}|${selectedOwner}`;
      router.push(`/lifecycle?type=multi&val=${encodeURIComponent(compositeVal)}`);
    } else {
      router.push(`/lifecycle?type=${searchType}&val=${encodeURIComponent(searchVal.trim())}`);
    }
  };

  const handleTypeChange = (newType: SearchType) => {
    setSearchType(newType);
    if (newType === 'dept') setSearchVal(deptOptions[0] || 'ALL_DEPTS');
    else if (newType === 'owner') setSearchVal(ownerOptions[0] || 'ALL_OWNERS');
    else if (newType === 'part_no') setSearchVal(partNoOptions[0] || 'ALL_PARTS');
    else if (newType === 'tx_no') setSearchVal(txNoOptions[0] || 'ALL_TX_NOS');
    else if (newType === 'pid') setSearchVal('');
    else setSearchVal('MULTI_MODE');
  };

  // 💡 改為接受整個 asset 物件，PID 為 N/A 時改用申請單號查詢以避免混淆
  const jumpToAsset = async (asset: AssetPid & { category?: string; part_no?: string; tx_no?: string }) => {
    if (asset.pid === 'N/A') {
      // 優先用已知的 tx_no，若無則透過 current_item_id 反查
      let txNo = asset.tx_no;
      if (!txNo && asset.current_item_id) {
        const allItems = await transactionsApi.getAll();
        const found = allItems.find(i => String(i.id) === String(asset.current_item_id));
        txNo = found?.tx.tx_no;
      }
      if (txNo) {
        setSearchType('tx_no');
        setSearchVal(txNo);
        router.push(`/lifecycle?type=tx_no&val=${encodeURIComponent(txNo)}`);
      } else {
        toast.error('無法定位該機台所屬的申請單號');
      }
    } else {
      setSearchType('pid');
      setSearchVal(asset.pid);
      router.push(`/lifecycle?type=pid&val=${encodeURIComponent(asset.pid)}`);
    }
  };

  const openOwnerEditor = (asset: AssetPid & { category?: string; part_no?: string; tx_no?: string }) => {
    setEditingAsset(asset);
    setEditOwner(asset.custom_owner || '');
    setEditDept(asset.current_dept || '');
  };

  const handleSaveLedgerOwner = async () => {
    if (!editingAsset) return;
    if (!editOwner.trim() || !editDept.trim()) {
      toast.error('請輸入掛帳同仁與掛帳單位');
      return;
    }

    setSavingOwner(true);
    try {
      const res = await assetPidsApi.updateLedgerOwner(editingAsset.id, editOwner, editDept);
      if (!res.success) {
        toast.error(res.error || '更新掛帳歸屬失敗');
        return;
      }

      const owner = editOwner.trim();
      const dept = editDept.trim();
      setAssetList(prev => prev.map(asset =>
        asset.id === editingAsset.id
          ? { ...asset, custom_owner: owner, current_dept: dept }
          : asset
      ));
      setAssetInfo(prev => prev && prev.id === editingAsset.id
        ? { ...prev, custom_owner: owner, current_dept: dept }
        : prev
      );
      setEditingAsset(null);
      toast.success('掛帳歸屬已更新');
    } finally {
      setSavingOwner(false);
    }
  };

  const jumpToDept = (dept: string) => {
    setSearchType('dept');
    setSearchVal(dept);
    router.push(`/lifecycle?type=dept&val=${encodeURIComponent(dept)}`);
  };

  const handleExportList = async () => {
    if (assetList.length === 0) { toast.error('無資料可供匯出'); return; }
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('PID 掛帳分佈清單');
      const columns = [
        { header: 'PID 號碼', key: 'pid', width: 25 },
        { header: '資產狀態', key: 'status', width: 18 },
        { header: '掛帳單位', key: 'dept', width: 22 },
        { header: '關聯申請單號', key: 'tx_no', width: 25 },
        { header: '產品別', key: 'category', width: 18 },
        { header: '產品料號', key: 'part_no', width: 25 },
        { header: '掛帳同仁', key: 'owner', width: 18 },
        { header: '最後更新時間', key: 'updated_at', width: 25 },
      ];
      const headerRow = worksheet.addRow(columns.map(c => c.header));
      headerRow.height = 25;
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
      assetList.forEach((asset, idx) => {
        const row = worksheet.addRow([
          asset.pid, getAssetStatusLabel(asset.current_status), asset.current_dept || UNASSIGNED_LABEL, asset.tx_no || 'N/A', asset.category || 'N/A',
          asset.part_no || 'N/A', asset.custom_owner || UNASSIGNED_LABEL,
          asset.created_at.slice(0, 19).replace('T', ' ').replace(/-/g, '/')
        ]);
        row.height = 20;
        row.eachCell((cell, colNum) => {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          if (colNum === 2) {
            if (cell.value === getAssetStatusLabel('結案/在庫')) cell.font = { color: { argb: 'FF10B981' }, bold: true };
            else if (cell.value === getAssetStatusLabel('外借/掛帳中')) cell.font = { color: { argb: 'FF6366F1' }, bold: true };
            else cell.font = { color: { argb: 'FFF59E0B' }, bold: true };
          }
          cell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
        });
      });
      columns.forEach((col, i) => { worksheet.getColumn(i + 1).width = col.width; });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `NextDrive_PID掛帳分佈清單_${new Date().getTime()}.xlsx`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      toast.success('PID 掛帳分佈清單已匯出');
    } catch (err: any) { toast.error('匯出失敗：' + err.message); }
  };

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case '領料': return 'bg-blue-50 text-blue-600 border border-blue-200';
      case '轉撥': return 'bg-indigo-50 text-indigo-600 border border-indigo-200';
      case '內部轉調': return 'bg-amber-50 text-amber-600 border border-amber-200';
      case '退料': return 'bg-emerald-50 text-emerald-600 border border-emerald-200';
      case '報廢': return 'bg-rose-50 text-rose-600 border border-rose-200';
      default: return 'bg-slate-100 text-slate-600 border border-slate-200';
    }
  };

  const getStatusLabelColor = (status: string) => {
    switch (status) {
      case '外借/掛帳中': return 'text-indigo-600 bg-indigo-50 border-indigo-200';
      case '內部轉調': return 'text-amber-600 bg-amber-50 border-amber-200';
      case '結案/在庫': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      default: return 'text-slate-600 bg-slate-100 border-slate-200';
    }
  };

  return (
    <div className="space-y-6 font-sans text-slate-900 pb-12 max-w-5xl mx-auto">
      <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-slate-700 to-slate-600 bg-clip-text text-transparent flex items-center gap-2">
          <History className="text-sky-600" />
          PID 掛帳查詢看板
        </h1>
        <p className="text-slate-500 text-sm">掌握借貨庫各單位 <span className="text-amber-600 font-bold">掛帳分佈</span>，或精確追蹤 <span className="text-sky-600 font-bold">PID</span> 異動軌跡；本頁不代表實際庫房庫存。</p>
      </div>

      {!hasSearched && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in duration-700">
          <Card className="md:col-span-1 border-slate-200 bg-sky-50">
            <CardHeader className="pb-2"><CardTitle className="text-xs text-sky-700 font-bold flex items-center gap-1.5"><TrendingUp size={14} />已列管 PID</CardTitle></CardHeader>
            <CardContent><div className="text-4xl font-black text-slate-800 font-mono">{totalAssets}</div></CardContent>
          </Card>
          <Card className="md:col-span-3 border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-200 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2"><MapPin size={16} className="text-amber-600" />各單位掛帳分佈統計</CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-sky-600 hover:text-sky-500 hover:bg-slate-50" onClick={() => jumpToDept('ALL_DEPTS')}>查看全部明細</Button>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-3">
                {deptStats.map((dept, idx) => (
                  <div key={`${dept.name}-${idx}`} onClick={() => jumpToDept(dept.name)} className="group cursor-pointer bg-slate-50 hover:bg-amber-50 border border-slate-200 rounded-lg p-3 transition-all flex items-center gap-4 min-w-[140px]">
                    <div className="h-10 w-10 rounded-full bg-white group-hover:bg-amber-100 flex items-center justify-center text-amber-600 border border-slate-200 font-bold shadow-sm">{dept.count}</div>
                    <div><div className="text-xs text-slate-500">掛帳單位</div><div className="text-sm font-bold text-slate-800 group-hover:text-amber-700">{dept.name}</div></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!hasSearched && ledgerAuditIssues.length > 0 && (
        <Card className="border-rose-200 bg-rose-50 shadow-sm">
          <CardHeader className="pb-3 border-b border-rose-100">
            <CardTitle className="text-sm font-bold text-rose-700 flex items-center gap-2">
              <AlertCircle size={16} />
              QA 掛帳差異檢查
            </CardTitle>
            <CardDescription className="text-xs text-rose-600">
              以下明細的出入庫數量大於目前開放掛帳數，可能就是少的帳值來源。
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-rose-100">
                    <TableHead className="text-rose-700">申請單號</TableHead>
                    <TableHead className="text-rose-700">異動別</TableHead>
                    <TableHead className="text-rose-700">料號</TableHead>
                    <TableHead className="text-rose-700 text-right">出入庫數</TableHead>
                    <TableHead className="text-rose-700 text-right">可追到</TableHead>
                    <TableHead className="text-rose-700 text-right">開放掛帳</TableHead>
                    <TableHead className="text-rose-700 text-right">差異</TableHead>
                    <TableHead className="text-rose-700">掛帳同仁 / 單位</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerAuditIssues.slice(0, 8).map(issue => (
                    <TableRow key={`${issue.txNo}-${issue.partNo}-${issue.warehouseId}`} className="border-rose-100">
                      <TableCell className="font-mono font-semibold text-slate-800">{issue.txNo}</TableCell>
                      <TableCell className="text-slate-700">{issue.txType}</TableCell>
                      <TableCell>
                        <span className="block text-[10px] text-slate-500">{issue.category}</span>
                        <span className="font-mono text-xs text-slate-700">{issue.partNo}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{issue.quantity}</TableCell>
                      <TableCell className="text-right font-mono">{issue.trackedCount}</TableCell>
                      <TableCell className="text-right font-mono">{issue.openCount}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-rose-700">{issue.missingCount}</TableCell>
                      <TableCell>
                        <span className="block text-xs text-slate-800">{issue.owner || UNASSIGNED_LABEL}</span>
                        <span className="text-[10px] text-slate-500">{issue.dept || UNASSIGNED_LABEL}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {correctionResult && (correctionResult.correctedCount > 0 || correctionResult.remainingCount > 0) && (
        <Card className="border-amber-200 bg-amber-50 shadow-sm">
          <CardContent className="py-3 text-sm text-amber-800 flex flex-wrap items-center gap-3">
            <AlertCircle size={16} />
            <span className="font-semibold">領料掛帳除帳補正</span>
            <span>本次補扣 {correctionResult.correctedCount} 筆</span>
            <span>仍待處理 {correctionResult.remainingCount} 筆</span>
            {correctionResult.message && <span>{correctionResult.message}</span>}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2 pb-2 overflow-x-auto no-scrollbar">
            <Button variant={searchType === 'pid' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('pid')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'pid' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><Hash size={12} />PID 查詢</Button>
            <Button variant={searchType === 'dept' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('dept')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'dept' ? 'bg-amber-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><MapPin size={12} />掛帳單位查詢</Button>
            <Button variant={searchType === 'owner' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('owner')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'owner' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><User size={12} />掛帳人員查詢</Button>
            <Button variant={searchType === 'tx_no' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('tx_no')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'tx_no' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><FileText size={12} />申請單號查詢</Button>
            <Button variant={searchType === 'part_no' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('part_no')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'part_no' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><Package size={12} />產品料號查詢</Button>
            <div className="h-4 w-[1px] bg-slate-300 mx-1" />
            <Button variant={searchType === 'multi' ? 'default' : 'ghost'} size="sm" onClick={() => handleTypeChange('multi')} className={`rounded-full h-8 text-xs gap-1.5 ${searchType === 'multi' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}><Layers size={12} />複合條件過濾</Button>
          </div>

          <form onSubmit={handleSearchSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-3">
              {searchType === 'pid' ? (
                <div className="relative flex-1 min-w-[200px]">
                  <Hash className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
                  <Input placeholder="請輸入 PID 號碼" value={searchVal} onChange={(e) => setSearchVal(e.target.value)} className="pl-9 bg-white border-slate-300 text-slate-800 py-6" />
                </div>
              ) : searchType === 'multi' ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
                  <Select value={selectedDept} onValueChange={(v) => setSelectedDept(v || 'ALL_DEPTS')}>
                    <SelectTrigger className="bg-white border-slate-300 text-slate-800 h-[52px] pl-10 relative">
                      <MapPin className="absolute left-3 top-4 h-4 w-4 text-amber-500" />
                      <SelectValue placeholder="選擇單位" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-800">
                      <SelectItem value="ALL_DEPTS">[All] 全部單位</SelectItem>
                      {multiDeptOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedOwner} onValueChange={(v) => setSelectedOwner(v || 'ALL_OWNERS')}>
                    <SelectTrigger className="bg-white border-slate-300 text-slate-800 h-[52px] pl-10 relative">
                      <User className="absolute left-3 top-4 h-4 w-4 text-violet-500" />
                      <SelectValue placeholder="選擇人員" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-800">
                      <SelectItem value="ALL_OWNERS">[All] 全部人員</SelectItem>
                      {multiOwnerOptions.map(owner => <SelectItem key={owner} value={owner}>{owner}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedTxNo} onValueChange={(v) => setSelectedTxNo(v || 'ALL_TX_NOS')}>
                    <SelectTrigger className="bg-white border-slate-300 text-slate-800 h-[52px] pl-10 relative">
                      <FileText className="absolute left-3 top-4 h-4 w-4 text-indigo-500" />
                      <SelectValue placeholder="選擇單號" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-800">
                      <SelectItem value="ALL_TX_NOS">[All] 全部單號</SelectItem>
                      {multiTxNoOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={selectedPartNo} onValueChange={(v) => setSelectedPartNo(v || 'ALL_PARTS')}>
                    <SelectTrigger className="bg-white border-slate-300 text-slate-800 h-[52px] pl-10 relative">
                      <Package className="absolute left-3 top-4 h-4 w-4 text-emerald-500" />
                      <SelectValue placeholder="選擇料號" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-800">
                      <SelectItem value="ALL_PARTS">[All] 全部料號</SelectItem>
                      {multiPartNoOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="relative flex-1">
                  <Select value={searchVal} onValueChange={(v) => setSearchVal(v || '')}>
                    <SelectTrigger className="bg-white border-slate-300 text-slate-800 h-[52px] pl-10 relative">
                      {searchType === 'dept' ? <MapPin className="absolute left-3 top-4 h-4 w-4 text-amber-500" /> : searchType === 'owner' ? <User className="absolute left-3 top-4 h-4 w-4 text-violet-500" /> : searchType === 'tx_no' ? <FileText className="absolute left-3 top-4 h-4 w-4 text-indigo-500" /> : <Package className="absolute left-3 top-4 h-4 w-4 text-emerald-500" />}
                      <SelectValue placeholder="請選擇查詢條件" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200 text-slate-800">
                      {searchType === 'dept' && <SelectItem value="ALL_DEPTS" className="text-sky-600 font-bold">[All] 全部單位</SelectItem>}
                      {searchType === 'owner' && <SelectItem value="ALL_OWNERS" className="text-sky-600 font-bold">[All] 全部人員</SelectItem>}
                      {searchType === 'dept' ? deptOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>) : searchType === 'owner' ? ownerOptions.map(owner => <SelectItem key={owner} value={owner}>{owner}</SelectItem>) : searchType === 'tx_no' ? txNoOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>) : partNoOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={searching} className={`px-8 py-6 font-bold text-white ${searchType === 'multi' ? 'bg-rose-600 hover:bg-rose-500' : searchType === 'pid' ? 'bg-sky-600 hover:bg-sky-500' : searchType === 'dept' ? 'bg-amber-500 hover:bg-amber-400' : searchType === 'owner' ? 'bg-violet-600 hover:bg-violet-500' : searchType === 'tx_no' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}><Search size={18} className="mr-2" />{searching ? '搜尋中...' : '執行查詢'}</Button>
                {hasSearched && <Button type="button" variant="outline" onClick={() => { setHasSearched(false); setSearchVal(''); setSelectedDept('ALL_DEPTS'); setSelectedOwner('ALL_OWNERS'); setSelectedTxNo('ALL_TX_NOS'); setSelectedPartNo('ALL_PARTS'); router.push('/lifecycle'); }} className="px-4 py-6 border-slate-300 text-slate-500 hover:bg-slate-50">重置</Button>}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {hasSearched && !searching && (
        <>
          {assetInfo ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start animate-in fade-in slide-in-from-bottom-2">
              <Card className="border-slate-200 bg-white shadow-sm sticky top-24">
                <CardHeader className="border-b border-slate-100 pb-3"><CardTitle className="text-sm text-slate-500">目前資產現況</CardTitle></CardHeader>
                <CardContent className="pt-5 space-y-4 text-sm">
                  <div><span className="text-slate-500 text-xs block mb-1">PID 號碼</span><span className="text-lg font-mono font-bold text-slate-800">{assetInfo.pid}</span></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><span className="text-slate-500 text-xs block mb-1">狀態</span><span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusLabelColor(assetInfo.current_status)}`}>{getAssetStatusLabel(assetInfo.current_status)}</span></div>
                    <div><span className="text-slate-500 text-xs block mb-1">掛帳單位</span><span className="text-sky-600 font-mono font-bold flex items-center gap-1"><MapPin size={12} />{assetInfo.current_dept || UNASSIGNED_LABEL}</span></div>
                  </div>
                  <div><span className="text-slate-500 text-xs block mb-1">掛帳同仁</span><span className="text-slate-700 font-semibold flex items-center gap-1.5"><User size={14} />{assetInfo.custom_owner || UNASSIGNED_LABEL}</span></div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openOwnerEditor(assetInfo)}
                    className="w-full border-amber-200 text-amber-700 hover:bg-amber-50"
                    title="修改掛帳歸屬"
                  >
                    <Pencil size={14} />
                    修改掛帳歸屬
                  </Button>
                </CardContent>
              </Card>
              <div className="md:col-span-2 space-y-6">
                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="border-b border-slate-100 pb-3"><CardTitle className="text-md font-bold text-slate-800 flex items-center gap-2"><TrendingUp size={16} className="text-sky-600" />生命週期軌跡</CardTitle></CardHeader>
                  <CardContent className="pt-6 pr-4">
                    <div className="relative border-l border-slate-200 ml-3 pl-6 space-y-8">
                      {history.map((log, idx) => (
                        <div key={idx} className="relative group">
                          <span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white border border-slate-300 transition-colors"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" /></span>
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2"><span className="text-xs text-slate-500 font-mono flex items-center gap-1"><Calendar size={12} />{log.date}</span><span className={`px-2 py-0.5 text-[10px] font-bold rounded ${getActionBadgeColor(log.action)}`}>{log.action}</span></div>
                              <span className="text-xs text-slate-500 font-mono">單號：{log.tx_no}</span>
                            </div>
                            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs space-y-1">
                              <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-1.5"><User size={13} className="text-slate-500" />{log.owner || '無'}</div>
                                <div className="flex items-center gap-1.5"><MapPin size={13} className="text-slate-500" />{log.dept || '無'}</div>
                              </div>
                              {log.notes && <div className="text-slate-600 pt-1 border-t border-slate-200 mt-2 pt-2 p-1.5 rounded">{log.notes}</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : assetList.length > 0 ? (
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="border-b border-slate-200 flex flex-row items-center justify-between">
                <div><CardTitle className="text-lg text-slate-800 flex items-center gap-2"><ListFilter size={18} className="text-sky-600" />PID 掛帳分佈清單</CardTitle><CardDescription className="text-xs text-slate-500">找到 {assetList.length} 筆符合條件的紀錄</CardDescription></div>
                <Button onClick={handleExportList} variant="outline" size="sm" className="border-slate-300 text-slate-700 font-bold gap-1.5 hover:bg-slate-50"><Download size={14} />匯出清單</Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50 border-b border-slate-200">
                      <TableRow>
                        <TableHead className="text-slate-600 font-mono">PID 號碼</TableHead>
                        <TableHead className="text-slate-600">狀態</TableHead>
                        <TableHead className="text-slate-600">掛帳單位</TableHead>
                        <TableHead className="text-slate-600">單號</TableHead>
                        <TableHead className="text-slate-600">產品 / 料號</TableHead>
                        <TableHead className="text-slate-600">掛帳同仁</TableHead>
                        <TableHead className="text-center">查</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assetList.map((asset) => (
                        <TableRow key={asset.id} className="border-b border-slate-200 hover:bg-slate-50">
                          <TableCell className="font-mono font-bold text-sky-600">{asset.pid}</TableCell>
                          <TableCell><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusLabelColor(asset.current_status)}`}>{getAssetStatusLabel(asset.current_status)}</span></TableCell>
                          <TableCell className="font-mono text-xs text-amber-600">{asset.current_dept || UNASSIGNED_LABEL}</TableCell>
                          <TableCell className="font-mono text-xs text-slate-600">{asset.tx_no || 'N/A'}</TableCell>
                          <TableCell><span className="block text-[10px] text-slate-500">{asset.category}</span><span className="text-slate-600 font-mono text-xs">{asset.part_no}</span></TableCell>
                          <TableCell><span className="block text-xs font-medium text-slate-800">{asset.custom_owner || UNASSIGNED_LABEL}</span></TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openOwnerEditor(asset)}
                                className="h-7 w-7 text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                                title="修改掛帳歸屬"
                              >
                                <Pencil size={12} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => jumpToAsset(asset)}
                                className="h-7 w-7 text-slate-400 hover:text-sky-600 hover:bg-sky-50"
                                title="查看履歷"
                              >
                                <Eye size={12} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="py-12 text-center border border-slate-200 rounded-xl bg-slate-50 max-w-md mx-auto"><AlertCircle className="text-slate-400 mx-auto mb-3" size={36} /><h3 className="text-sm font-bold text-slate-500">未找到符合條件的資產紀錄</h3></div>
          )}
        </>
      )}

      <Dialog
        open={Boolean(editingAsset)}
        onOpenChange={(open) => {
          if (!open && !savingOwner) setEditingAsset(null);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-md">
          <DialogHeader className="border-b border-slate-200 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <Pencil size={18} className="text-amber-500" />
              修改掛帳歸屬
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSaveLedgerOwner();
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <span className="block text-slate-500">PID</span>
                <span className="font-mono font-semibold text-slate-800">{editingAsset?.pid || 'N/A'}</span>
              </div>
              <div>
                <span className="block text-slate-500">單號</span>
                <span className="font-mono font-semibold text-slate-800">{editingAsset?.tx_no || 'N/A'}</span>
              </div>
              <div className="col-span-2">
                <span className="block text-slate-500">產品料號</span>
                <span className="font-mono font-semibold text-slate-800">{editingAsset?.part_no || 'N/A'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledger-owner">掛帳同仁</Label>
              <Input
                id="ledger-owner"
                value={editOwner}
                onChange={(event) => setEditOwner(event.target.value)}
                className="bg-white border-slate-300"
                placeholder="請輸入掛帳同仁"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ledger-dept">掛帳單位</Label>
              <Input
                id="ledger-dept"
                value={editDept}
                onChange={(event) => setEditDept(event.target.value)}
                className="bg-white border-slate-300"
                placeholder="請輸入掛帳單位"
              />
            </div>

            <DialogFooter className="border-t border-slate-200 pt-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingAsset(null)}
                disabled={savingOwner}
                className="text-slate-600 hover:bg-slate-100"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={savingOwner}
                className="bg-amber-500 text-white font-bold hover:bg-amber-400"
              >
                {savingOwner ? '儲存中...' : '確認更新'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LifecyclePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-sky-500 border-t-transparent animate-spin" /></div>}>
      <LifecyclePageContent />
    </Suspense>
  );
}
