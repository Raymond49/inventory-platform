// 儀表板首頁 - 庫存異動與資產生命週期管理平台
// 強制使用繁體中文，支援動態統計、歷史總表與即時搜尋
// 所有註解均使用繁體中文

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authApi, transactionsApi, assetPidsApi } from '@/lib/supabase/client';
import { Profile, Transaction, TransactionItem, AssetPid, TxType, TX_TYPE_DIRECTION } from '@/lib/supabase/mockDb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  LayoutDashboard, 
  FileText, 
  AlertTriangle, 
  Boxes, 
  PlusCircle, 
  Search,
  CheckCircle,
  Eye,
  Download,
  Calendar as CalendarIcon,
  Edit,
  Trash2,
  ArrowUpDown,
  ClipboardList
} from 'lucide-react';
import { toast } from 'sonner';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ExcelJS from 'exceljs';

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

type DisplayItem = TransactionItem & { tx: Transaction };

export default function DashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [assetPids, setAssetPids] = useState<AssetPid[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTxType, setSelectedTxType] = useState<string>('all');

  // 編輯相關狀態
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DisplayItem | null>(null);
  const [editTxNo, setEditTxNo] = useState('');
  const [editTxType, setEditTxType] = useState<TxType>('領料');
  const [editOwner, setEditOwner] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPartNo, setEditPartNo] = useState('');
  const [editActualDate, setEditActualDate] = useState('');
  const [updating, setUpdating] = useState(false);

  // 刪除相關狀態
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 報表匯出相關狀態
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [exportEndDate, setExportEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const fetchData = async () => {
    try {
      const user = await authApi.getCurrentUser();
      setCurrentUser(user);

      const allItems = await transactionsApi.getAll();
      const pidList = await assetPidsApi.getAll();

      setItems(allItems);
      setAssetPids(pidList);
    } catch (err: any) {
      toast.error('資料讀取失敗，請確認資料庫設定');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 計算統計數字 (以明細列為單位計算)
  const totalItems = items.length;
  const pendingItems = items.filter(i => i.reconciliation_status === '明細待補').length;
  
  // 統計非 N/A 的機器 PID 總量
  const uniquePids = Array.from(new Set(assetPids.filter(p => p.pid !== 'N/A').map(p => p.pid))).length;

  const getItemPidInfo = (item: DisplayItem) => {
    const linkedPids = assetPids
      .filter(p => p.current_item_id === item.id)
      .map(p => p.pid)
      .filter(pid => pid && pid.trim() !== '');
    const savedPids = (item.pending_pids || [])
      .map(pid => String(pid || '').trim())
      .filter(pid => pid !== '');

    if (linkedPids.length > 0) {
      return { pids: linkedPids, source: 'ledger' as const };
    }
    if (savedPids.length > 0) {
      return { pids: savedPids, source: 'pending' as const };
    }
    return { pids: [], source: 'none' as const };
  };

  // 過濾搜尋結果 (結合關鍵字搜尋與下拉異動別篩選)
  const filteredItems = items.filter(item => {
    const itemPidInfo = getItemPidInfo(item);
    const matchesKeyword = 
      item.tx.tx_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.part_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tx.tx_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.adjust_no || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.warehouse_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tx.custom_owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      itemPidInfo.pids.some(pid => pid.toLowerCase().includes(searchQuery.toLowerCase()));
      
    const matchesTxType = selectedTxType === 'all' || item.tx.tx_type === selectedTxType;
    
    return matchesKeyword && matchesTxType;
  });

  const getStatusBadge = (status: '已結案' | '明細待補') => {
    if (status === '已結案') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle size={12} />
          已結案
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse">
        <AlertTriangle size={12} />
        明細待補
      </span>
    );
  };

  const getTxTypeBadge = (type: string) => {
    switch (type) {
      case '領料': return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case '轉撥': return 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20';
      case '內部轉調': return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
      case '製令': return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case '銷售': return 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
      case '退料': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case '請購': return 'bg-teal-500/10 text-teal-400 border border-teal-500/20';
      case '轉撥退回': return 'bg-lime-500/10 text-lime-400 border border-lime-500/20';
      case '報廢': return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
      default: return 'bg-slate-500/10 text-slate-400';
    }
  };

  const isEditor = currentUser?.role === 'Admin' || currentUser?.role === 'Editor';

  const handleEditClick = (item: DisplayItem) => {
    setEditingItem(item);
    setEditTxNo(item.tx.tx_no);
    setEditTxType(item.tx.tx_type);
    setEditOwner(item.tx.custom_owner);
    setEditDept(item.tx.current_dept);
    setEditPartNo(item.part_no);
    setEditActualDate(item.actual_date || '');
    setIsEditDialogOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setUpdating(true);
    try {
      const res = await transactionsApi.update(
        editingItem.tx.id,
        editingItem.id,
        { 
          tx_no: editTxNo, 
          tx_type: editTxType, 
          direction: TX_TYPE_DIRECTION[editTxType],
          custom_owner: editOwner, 
          current_dept: editDept 
        },
        { 
          part_no: editPartNo,
          actual_date: editActualDate 
        }
      );
      if (res.success) {
        toast.success('單據資料已更新');
        setIsEditDialogOpen(false);
        fetchData();
      } else {
        toast.error('更新失敗：' + res.error);
      }
    } catch (err: any) {
      toast.error('更新出錯');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      const res = await transactionsApi.delete(deletingId);
      if (res.success) {
        toast.success('單據已成功刪除');
        setIsDeleteDialogOpen(false);
        fetchData();
      } else {
        toast.error('刪除失敗：' + res.error);
      }
    } catch (err: any) {
      toast.error('刪除出錯');
    }
  };

  const handleExportData = async () => {
    if (!exportStartDate || !exportEndDate) {
      toast.error('請選擇完整的日期區間');
      return;
    }

    const start = startOfDay(new Date(exportStartDate));
    const end = endOfDay(new Date(exportEndDate));

    if (start > end) {
      toast.error('開始日期不可大於結束日期');
      return;
    }

    // 篩選指定日期區間內的資料
    const exportItems = items.filter(item => {
      const itemDate = new Date(item.created_at);
      return isWithinInterval(itemDate, { start, end });
    });

    if (exportItems.length === 0) {
      toast.error('所選區間內無任何資料');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('出入庫紀錄報表');

      // 1. 設定欄位定義與展開欄寬 (不再加入前五列資訊)
      const columns = [
        { header: '申請單號', key: 'tx_no', width: 25 },
        { header: '異動別', key: 'tx_type', width: 15 },
        { header: '方向', key: 'direction', width: 10 },
        { header: '實際異動日期', key: 'actual_date', width: 15 },
        { header: '存貨調整單號', key: 'adjust_no', width: 25 },
        { header: '產品類別', key: 'category', width: 18 },
        { header: '產品料號', key: 'part_no', width: 25 },
        { header: '數量', key: 'quantity', width: 10 },
        { header: 'PID 號碼清單', key: 'pids', width: 50 },
        { header: '掛帳同仁', key: 'custom_owner', width: 15 },
        { header: '掛帳單位', key: 'current_dept', width: 22 },
        { header: '對帳狀態', key: 'status', width: 15 },
        { header: '系統登錄時間', key: 'created_at', width: 25 },
      ];

      // 加入標題列
      const headerRow = worksheet.addRow(columns.map(c => c.header));
      headerRow.height = 25; // 加高標頭列
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
      headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // 2. 填入資料
      exportItems.forEach((item, idx) => {
        const itemPidInfo = getItemPidInfo(item);
        const itemPids = itemPidInfo.pids.join(', ');
        const row = worksheet.addRow([
          item.tx.tx_no,
          item.tx.tx_type,
          item.tx.direction,
          item.actual_date || '-',
          item.adjust_no || '-',
          item.category,
          item.part_no,
          item.quantity,
          itemPids || 'N/A',
          item.tx.custom_owner,
          item.tx.current_dept,
          item.reconciliation_status,
          format(new Date(item.created_at), 'yyyy/MM/dd HH:mm:ss')
        ]);

        row.height = 20; // 加高資料列

        // 設定資料列樣式
        row.eachCell((cell, colNumber) => {
          cell.alignment = { vertical: 'middle' };
          // 數量靠右，其餘居中
          if (colNumber === 8) {
            cell.alignment.horizontal = 'right';
          } else {
            cell.alignment.horizontal = 'center';
          }
          
          // 交替行顏色
          if (idx % 2 === 1) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }

          // 對帳狀態標記
          if (colNumber === 12) {
            if (cell.value === '明細待補') {
              cell.font = { color: { argb: 'FFEF4444' }, bold: true };
            } else {
              cell.font = { color: { argb: 'FF10B981' } };
            }
          }
          
          // 設定框線
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });
      });

      // 手動套用欄寬 (exceljs 的 columns width 有時需手動觸發)
      columns.forEach((col, i) => {
        worksheet.getColumn(i + 1).width = col.width;
      });

      // 3. 下載檔案
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      link.setAttribute('href', url);
      link.setAttribute('download', `NextDrive_出入庫紀錄報表_${timestamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setIsExportDialogOpen(false);
      toast.success(`成功匯出 ${exportItems.length} 筆資料 (Excel 格式)`);
    } catch (err: any) {
      console.error('Export Error:', err);
      toast.error('匯出 Excel 失敗：' + err.message);
    }
  };

  return (
    <div className="space-y-6 font-sans text-slate-900 pb-12">
      
      {/* 頂部歡迎區 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-slate-900 via-slate-700 to-slate-600 bg-clip-text text-transparent flex items-center gap-2">
            <LayoutDashboard className="text-sky-600" />
            異動與資產儀表板
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            本平台為出入庫紀錄與借貨庫 PID 掛帳追蹤之單一事實來源 (SSOT)，不取代實際庫存主檔，目前檢視權限：
            <span className="text-sky-600 font-semibold underline ml-1">
              {currentUser?.role === 'Admin' ? '系統管理員' : currentUser?.role === 'Editor' ? '庫管人員' : '一般同仁'}
            </span>
          </p>
        </div>

        {/* 快捷按鈕區 */}
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => setIsExportDialogOpen(true)}
            variant="outline"
            className="border-slate-300 hover:bg-slate-50 text-slate-700 font-bold flex items-center gap-1.5 py-5"
          >
            <Download size={16} />
            產出報表
          </Button>

          {isEditor && (
            <Link href="/entry">
              <Button className="bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-bold hover:from-sky-600 hover:to-emerald-600 transition-all flex items-center gap-1.5 py-5">
                <PlusCircle size={16} />
                資料登錄表單
              </Button>
            </Link>
          )}
        </div>
      </div>

      <Dialog 
        open={isExportDialogOpen} 
        disablePointerDismissal={true}
        onOpenChange={(nextOpen, { reason }) => {
          if (reason === 'outside-press' || reason === 'escape-key') {
            return;
          }
          setIsExportDialogOpen(nextOpen);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-800 font-sans max-w-sm">
          <DialogHeader className="border-b border-slate-200 pb-3">

            <DialogTitle className="text-lg flex items-center gap-2 text-slate-800">
              <Download className="text-sky-600" />
              產出資料報表
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              請選擇欲匯出的資料登錄時間區間。系統將生成 Excel 檔案。
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-700 flex items-center gap-1.5 text-xs">
                <CalendarIcon size={12} className="text-sky-600" />
                開始日期
              </Label>
              <Input
                type="date"
                value={exportStartDate}
                onChange={(e) => setExportStartDate(e.target.value)}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-700 flex items-center gap-1.5 text-xs">
                <CalendarIcon size={12} className="text-sky-600" />
                結束日期
              </Label>
              <Input
                type="date"
                value={exportEndDate}
                onChange={(e) => setExportEndDate(e.target.value)}
                className="bg-white border-slate-300 text-slate-900"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 pt-3">
            <Button
              variant="outline"
              onClick={() => setIsExportDialogOpen(false)}
              className="border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              取消
            </Button>
            <Button
              onClick={handleExportData}
              className="bg-sky-600 text-white font-bold hover:bg-sky-500"
            >
              確認匯出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 統計指標卡片 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-100 border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">總登錄物料行數</CardTitle>
              <FileText className="text-sky-600" size={18} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold font-mono tracking-tight text-slate-800">{totalItems} <span className="text-xs text-slate-500 font-normal">行</span></div>
              <p className="text-[11px] text-slate-500 mt-1">包含所有已登錄及待補明細行</p>
            </CardContent>
          </Card>

          <Card className={`border-slate-200 bg-white shadow-sm transition-all ${pendingItems > 0 ? 'ring-1 ring-amber-500' : ''}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-500">待補物料項目數</CardTitle>
              <ClipboardList className="text-slate-500" size={18} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold font-mono tracking-tight ${pendingItems > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                {pendingItems} <span className="text-xs text-slate-500 font-normal">筆</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">待實體單據簽核完成後修補</p>
            </CardContent>
          </Card>


        </div>
      )}

      {/* 歷史總表表格 */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4">
          <div>
            <CardTitle className="text-lg text-slate-800">出入庫與掛帳紀錄總表</CardTitle>
            <CardDescription className="text-xs text-slate-500">呈現所有單據明細與掛帳追蹤狀態</CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
            {/* 異動別下拉選單 */}
            <div className="w-full sm:w-44">
              <select
                value={selectedTxType}
                onChange={(e) => setSelectedTxType(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-white border border-slate-300 text-slate-800 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="all">所有表單異動別</option>
                <option value="領料">領料</option>
                <option value="轉撥">轉撥</option>
                <option value="內部轉調">內部轉調</option>
                <option value="製令">製令</option>
                <option value="銷售">銷售</option>
                <option value="退料">退料</option>
                <option value="請購">請購</option>
                <option value="轉撥退回">轉撥退回</option>
                <option value="報廢">報廢</option>
              </select>
            </div>
            {/* 關鍵字搜尋 */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                placeholder="搜尋單號、調整單、料號、同仁..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 h-10"
              />
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0 px-0">
          {loading ? (
            <div className="py-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              無符合條件的異動明細紀錄
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="text-slate-600 font-semibold font-mono whitespace-nowrap">申請單號</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">表單異動別</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">實際異動日期</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">存貨調整單號</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">產品別 / 料號</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-right whitespace-nowrap">數量</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">PID 號碼</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">掛帳同仁</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">掛帳單位</TableHead>
                    <TableHead className="text-slate-600 font-semibold whitespace-nowrap">勾稽狀態</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-center sticky right-0 z-10 bg-slate-50 w-[110px] min-w-[110px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id} className="group border-b border-slate-200 hover:bg-slate-50">
                      <TableCell className="font-mono font-semibold text-slate-800 whitespace-nowrap">{item.tx.tx_no}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${getTxTypeBadge(item.tx.tx_type)}`}>
                          {item.tx.tx_type}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-slate-600 whitespace-nowrap">
                        {item.actual_date || <span className="text-slate-400 italic text-xs">待補</span>}
                      </TableCell>
                      <TableCell className="font-mono text-slate-600 whitespace-nowrap">
                        {item.adjust_no || <span className="text-slate-400 italic text-xs">待補</span>}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        <span className="block text-xs text-slate-500">{item.category}</span>
                        <span className="font-mono">{item.part_no}</span>
                      </TableCell>
                      <TableCell className="font-mono font-bold text-slate-800 text-right">{item.quantity}</TableCell>
                      <TableCell className="max-w-[120px]">
                        {(() => {
                          const itemPidInfo = getItemPidInfo(item);
                          if (itemPidInfo.pids.length === 0) return <span className="text-slate-400 italic text-xs">無</span>;
                          return (
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {itemPidInfo.pids.map((p, pIdx) => (
                                <span
                                  key={`${p}-${pIdx}`}
                                  title={itemPidInfo.source === 'pending' ? '補登明細已暫存，尚未寫入掛帳清單' : '已寫入掛帳清單'}
                                  className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                                    itemPidInfo.source === 'pending'
                                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                                      : 'bg-slate-100 border-slate-200 text-slate-600'
                                  }`}
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-slate-700 whitespace-nowrap">{item.tx.custom_owner}</TableCell>
                      <TableCell className="text-slate-700 whitespace-nowrap">
                        { (item.tx.tx_type === '轉撥' || item.tx.tx_type === '內部轉調') ? (
                          <div className="flex flex-col">
                            {item.tx.source_dept && <span className="text-[10px] text-slate-500 line-through decoration-amber-500/50">{item.tx.source_dept} →</span>}
                            <span className="font-semibold text-amber-600">{item.tx.current_dept}</span>
                          </div>
                        ) : (
                          item.tx.current_dept
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(item.reconciliation_status)}</TableCell>
                      <TableCell className="sticky right-0 z-10 bg-white group-hover:bg-slate-50 w-[110px]">
                        <div className="flex items-center justify-center gap-1">
                          <Link href={`/lifecycle?type=tx_no&val=${encodeURIComponent(item.tx.tx_no)}`}>
                            <Button variant="ghost" size="icon" title="查看申請單詳細資料" className="h-8 w-8 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-md">
                              <Eye size={14} />
                            </Button>
                          </Link>
                          {isEditor && (
                            <>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                title="編輯修正"
                                onClick={() => handleEditClick(item)}
                                className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-md"
                              >
                                <Edit size={14} />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                title="刪除單據"
                                onClick={() => {
                                  setDeletingId(item.tx.id);
                                  setIsDeleteDialogOpen(true);
                                }}
                                className="h-8 w-8 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md"
                              >
                                <Trash2 size={14} />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 編輯對話框 */}
      <Dialog 
        open={isEditDialogOpen} 
        disablePointerDismissal={true}
        onOpenChange={(open, { reason }) => {
          if (reason === 'outside-press' || reason === 'escape-key') return;
          setIsEditDialogOpen(open);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-md">
          <DialogHeader className="border-b border-slate-200 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <Edit size={18} className="text-amber-500" />
              編輯單據資料
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              您可以修正單號、掛帳人或單位。此修改會同步反映至 PID 生命履歷。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">系統申請單號</Label>
                <Input value={editTxNo} onChange={(e) => setEditTxNo(e.target.value)} className="bg-white border-slate-300" required />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">表單異動別</Label>
                <Select value={editTxType} onValueChange={(v) => setEditTxType(v as TxType)}>
                  <SelectTrigger className="bg-white border-slate-300 text-slate-800 text-xs h-9">
                    <SelectValue placeholder="請選擇異動別" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 text-slate-800">
                    {TX_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-500">實際異動日期</Label>
              <Input 
                type="date" 
                value={editActualDate} 
                onChange={(e) => setEditActualDate(e.target.value)} 
                className="bg-white border-slate-300 text-slate-800" 
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-500 flex items-center gap-1.5">
                <ArrowUpDown size={12} className="text-slate-400" />
                進出庫方向 (自動對應)
              </Label>
              <div className={`h-9 px-3 py-2 rounded-md border text-xs flex items-center font-semibold ${
                TX_TYPE_DIRECTION[editTxType] === '進庫'
                  ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-400'
                  : 'bg-rose-950/30 border-rose-900/50 text-rose-400'
              }`}>
                {TX_TYPE_DIRECTION[editTxType] === '進庫' ? '進庫 (＋)' : '出庫 (－)'}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">掛帳同仁</Label>
                <Input value={editOwner} onChange={(e) => setEditOwner(e.target.value)} className="bg-white border-slate-300" required />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">掛帳單位</Label>
                <Input value={editDept} onChange={(e) => setEditDept(e.target.value)} className="bg-white border-slate-300" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-500">產品料號</Label>
              <Input value={editPartNo} onChange={(e) => setEditPartNo(e.target.value)} className="bg-white border-slate-300" required />
            </div>
            <DialogFooter className="border-t border-slate-200 pt-4 mt-2">
              <Button type="button" variant="ghost" onClick={() => setIsEditDialogOpen(false)} className="text-slate-600 hover:bg-slate-100">取消</Button>
              <Button type="submit" disabled={updating} className="bg-amber-500 text-white font-bold hover:bg-amber-400">
                {updating ? '更新中...' : '確認更新'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 刪除確認對話框 */}
      <Dialog 
        open={isDeleteDialogOpen} 
        onOpenChange={(open, { reason }) => {
          if (reason === 'outside-press' || reason === 'escape-key') return;
          setIsDeleteDialogOpen(open);
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <AlertTriangle size={18} />
              確認刪除單據？
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              刪除單據將會同步移除所有相關的物料明細，且原本綁定的 PID 將會回復到上一筆掛帳狀態或未掛帳狀態。此操作無法復原。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4 border-t border-slate-200 pt-3">
            <Button variant="ghost" onClick={() => setIsDeleteDialogOpen(false)} className="text-slate-600 hover:bg-slate-100">取消返回</Button>
            <Button onClick={handleDeleteConfirm} className="bg-rose-500 text-white font-bold hover:bg-rose-600">
              確定永久刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
