// Supabase 與 Mock DB 整合型客戶端
// 支援當未設定環境變數時，自動降級使用 LocalStorage 進行離線操作與演示
// 所有註解均使用繁體中文

import { createClient } from '@supabase/supabase-js';
import * as mockDb from './mockDb';
import { resolveLedgerActionForItem } from './mockDb';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isRealSupabase = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isRealSupabase
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

const extractWarehouseFromNotes = (notes: string | null | undefined, fallback: string | null) => {
  if (!notes) return fallback;
  return (
    notes.match(/轉倉至：(.*?)(?:\s|\||$)/)?.[1] ||
    notes.match(/轉入：(.*?)(?:\s|\||$)/)?.[1] ||
    fallback
  );
};

const getRevertStatus = (action: string): mockDb.AssetStatusType => {
  if (['轉撥', '領料', '製令', '銷售'].includes(action)) return '外借/掛帳中';
  if (action === '內部轉調') return '內部轉調';
  return '結案/在庫';
};

const chunkRows = <T,>(rows: T[], size = 500) => {
  const chunks: T[][] = [];
  for (let idx = 0; idx < rows.length; idx += size) {
    chunks.push(rows.slice(idx, idx + size));
  }
  return chunks;
};

export const authApi = {
  async login(email: string, name: string): Promise<{ success: boolean; error?: string; data?: any; user?: any }> {
    if (!isRealSupabase) {
      return mockDb.loginMockUser(email, name);
    }

    const { data, error } = await supabase!.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        queryParams: { hd: 'nextdrive.io' }
      }
    });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  },

  async getCurrentUser() {
    if (!isRealSupabase) {
      return mockDb.getCurrentUser();
    }

    const { data: { user } } = await supabase!.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase!
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    return profile || null;
  },

  async logout() {
    if (!isRealSupabase) {
      return mockDb.logoutMockUser();
    }
    await supabase!.auth.signOut();
  },

  async getProfiles() {
    if (!isRealSupabase) {
      return mockDb.getProfiles();
    }
    const { data } = await supabase!.from('profiles').select('*');
    return data || [];
  },

  switchRole(role: 'Admin' | 'Editor' | 'Viewer') {
    if (!isRealSupabase) {
      mockDb.switchMockRole(role);
    }
  }
};

export const transactionsApi = {
  // 取得所有單據明細 (包含其主表單號資訊)
  async getAll(): Promise<(mockDb.TransactionItem & { tx: mockDb.Transaction })[]> {
    if (!isRealSupabase) {
      const txs = mockDb.getTransactions();
      const items = mockDb.getTransactionItems();
      
      return items.map(item => {
        const tx = txs.find(t => t.id === item.transaction_id)!;
        return { ...item, tx };
      }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    const { data } = await supabase!
      .from('transaction_items')
      .select('*, tx:transactions(*)')
      .order('created_at', { ascending: false });
    
    return data || [];
  },

  // 開立新一對多單據
  async create(
    txData: Omit<mockDb.Transaction, 'id' | 'created_at'>,
    items: Omit<mockDb.TransactionItem, 'id' | 'transaction_id' | 'actual_date' | 'adjust_no' | 'pending_pids' | 'reconciliation_status' | 'created_at'>[]
  ): Promise<{ success: boolean; error?: string; tx_no?: string }> {
    if (!isRealSupabase) {
      return mockDb.createTransaction(txData, items);
    }

    // 寫入實體 Supabase
    const { data: tx, error: txError } = await supabase!
      .from('transactions')
      .insert([txData])
      .select()
      .single();

    if (txError) return { success: false, error: txError.message };

    const itemsPayload = items.map(item => ({
      ...item,
      transaction_id: tx.id,
      actual_date: null,
      adjust_no: null,
      pending_pids: null,
      reconciliation_status: '明細待補'
    }));

    const { error: itemsError } = await supabase!
      .from('transaction_items')
      .insert(itemsPayload);

    if (itemsError) return { success: false, error: itemsError.message };

    return { success: true, tx_no: tx.tx_no };
  },

  async update(txId: string, itemId: string, txData: any, itemData: any) {
    if (!isRealSupabase) {
      return mockDb.updateTransaction(txId, itemId, txData, itemData);
    }
    // 真實 Supabase 邏輯 (簡化實作)
    const { error: txErr } = await supabase!.from('transactions').update(txData).eq('id', txId);
    const { error: itemErr } = await supabase!.from('transaction_items').update(itemData).eq('id', itemId);
    return { success: !txErr && !itemErr };
  },

  async delete(txId: string) {
    if (!isRealSupabase) {
      return mockDb.deleteTransaction(txId);
    }

    const { data: linkedItems, error: itemFetchError } = await supabase!
      .from('transaction_items')
      .select('id')
      .eq('transaction_id', txId);
    if (itemFetchError) return { success: false, error: itemFetchError.message };

    const linkedItemIds = (linkedItems || []).map((item: any) => item.id);

    if (linkedItemIds.length > 0) {
      const { data: assetRows, error: assetFetchError } = await supabase!
        .from('asset_pids')
        .select('*');
      if (assetFetchError) return { success: false, error: assetFetchError.message };

      for (const asset of assetRows || []) {
        const historyLogs = Array.isArray(asset.history_logs) ? asset.history_logs : [];
        const isLinkedCurrent = linkedItemIds.includes(asset.current_item_id || '');
        const firstLogItemId = historyLogs.length > 0 ? historyLogs[0].item_id : null;

        if (isLinkedCurrent && historyLogs.length > 1) {
          const prevLogs = historyLogs.slice(0, -1);
          const lastLog = prevLogs[prevLogs.length - 1];
          const { error: updateError } = await supabase!
            .from('asset_pids')
            .update({
              current_item_id: lastLog?.item_id || null,
              current_status: lastLog ? getRevertStatus(lastLog.action) : '結案/在庫',
              custom_owner: lastLog?.owner || null,
              current_dept: lastLog?.dept || null,
              current_warehouse: extractWarehouseFromNotes(lastLog?.notes, asset.current_warehouse),
              history_logs: prevLogs,
              notes: lastLog?.notes || ''
            })
            .eq('id', asset.id);
          if (updateError) return { success: false, error: updateError.message };
          continue;
        }

        if ((firstLogItemId && linkedItemIds.includes(firstLogItemId)) || isLinkedCurrent) {
          const { error: deleteAssetError } = await supabase!
            .from('asset_pids')
            .delete()
            .eq('id', asset.id);
          if (deleteAssetError) return { success: false, error: deleteAssetError.message };
        }
      }
    }

    const { error } = await supabase!.from('transactions').delete().eq('id', txId);
    return { success: !error, error: error?.message };
  },

  async deleteItem(itemId: string) {
    if (!isRealSupabase) {
      return mockDb.deleteTransactionItem(itemId);
    }

    const { data: item, error: itemFetchError } = await supabase!
      .from('transaction_items')
      .select('id, transaction_id')
      .eq('id', itemId)
      .single();
    if (itemFetchError || !item) return { success: false, error: '找不到該筆物料明細' };

    const { count: itemCount, error: countError } = await supabase!
      .from('transaction_items')
      .select('id', { count: 'exact', head: true })
      .eq('transaction_id', item.transaction_id);
    if (countError) return { success: false, error: countError.message };
    if ((itemCount || 0) <= 1) {
      return { success: false, error: '此單據只剩一筆明細，請改用刪除整張單據。' };
    }

    const { count: linkedAssetCount, error: assetCountError } = await supabase!
      .from('asset_pids')
      .select('id', { count: 'exact', head: true })
      .eq('current_item_id', itemId);
    if (assetCountError) return { success: false, error: assetCountError.message };
    if ((linkedAssetCount || 0) > 0) {
      return { success: false, error: '此明細已有掛帳資料連結，請先確認掛帳資料後再刪除。' };
    }

    const { error } = await supabase!.from('transaction_items').delete().eq('id', itemId);
    return { success: !error, error: error?.message };
  },

  // 針對單一明細項目修補並結案
  async repair(
    itemId: string,
    actualDate: string,
    adjustNo: string,
    pids: string[]
  ): Promise<{ success: boolean; error?: string; completed?: boolean }> {
    if (!isRealSupabase) {
      return mockDb.repairTransactionItem(itemId, actualDate, adjustNo, pids);
    }

    // 真實 Supabase
    // 1. 查詢明細項目與主表資訊
    const { data: item, error: itemErr } = await supabase!
      .from('transaction_items')
      .select('*, tx:transactions(*)')
      .eq('id', itemId)
      .single();
    if (itemErr || !item) return { success: false, error: '找不到該筆單據物料明細' };

    const tx = item.tx;

    const { data: assetRows } = await supabase!.from('asset_pids').select('*');
    const { data: itemRows } = await supabase!.from('transaction_items').select('*');
    const assets = (assetRows || []) as mockDb.AssetPid[];
    const items = (itemRows || []) as mockDb.TransactionItem[];
    const ledgerAction = resolveLedgerActionForItem(tx.tx_type, item, assets, items);
    const needsPid = ledgerAction !== 'NORMAL_RECORD_ONLY';
    const itemQuantity = Number(item.quantity) || 0;
    const savedActualDate = actualDate.trim();
    const savedAdjustNo = adjustNo.trim();

    const cleanPids = pids.map(p => {
      const t = p.trim();
      return t.toUpperCase() === 'N/A' ? 'N/A' : t;
    });
    const filledPids = cleanPids.filter(p => p !== '');
    const nonNaPids = filledPids.filter(p => p !== 'N/A');
    const dupeInForm = nonNaPids.filter((v, i) => nonNaPids.findIndex(p => p.toUpperCase() === v.toUpperCase()) !== i);
    if (dupeInForm.length > 0) {
      return { success: false, error: `表單內 PID 重複：${dupeInForm.join(', ')}` };
    }

    const pidsComplete = !needsPid || (cleanPids.length === itemQuantity && cleanPids.every(p => p !== ''));
    const canCloseItem = Boolean(savedActualDate && savedAdjustNo && pidsComplete);

    // 2. 更新明細表實際日期、調整單號與暫存 PID
    const { error: itemUpdateErr } = await supabase!
      .from('transaction_items')
      .update({
        actual_date: savedActualDate || null,
        adjust_no: savedAdjustNo || null,
        pending_pids: needsPid ? cleanPids : null,
        reconciliation_status: canCloseItem && !needsPid ? '已結案' : '明細待補',
      })
      .eq('id', itemId);

    if (itemUpdateErr) return { success: false, error: itemUpdateErr.message };

    // ── 未完整前只暫存，不處理 asset_pids ──
    if (!canCloseItem) {
      return { success: true, completed: false };
    }

    // ── 不需要 PID 的異動別：完整後直接結束，不處理 asset_pids ──
    if (!needsPid) {
      return { success: true, completed: true };
    }

    if (ledgerAction === 'CLEAR_LOAN_LEDGER') {
      const normalizeLedgerKey = (value: string | null | undefined) =>
        (value || '').replace(/\s+/g, '').toUpperCase();

      const findLinkedItem = (asset: mockDb.AssetPid) =>
        items.find(row => row.id === asset.current_item_id);
      const isOpenLedger = (asset: mockDb.AssetPid) =>
        asset.current_status !== '結案/在庫' && Boolean(asset.current_item_id);
      const isSamePart = (asset: mockDb.AssetPid) =>
        normalizeLedgerKey(findLinkedItem(asset)?.part_no) === normalizeLedgerKey(item.part_no);
      const isSameLedgerDept = (asset: mockDb.AssetPid) =>
        normalizeLedgerKey(asset.current_dept) === normalizeLedgerKey(item.warehouse_id);
      const isSameLedgerOwner = (asset: mockDb.AssetPid) =>
        normalizeLedgerKey(asset.custom_owner) === normalizeLedgerKey(tx.custom_owner);

      const clearLogEntry: mockDb.HistoryLog = {
        tx_no: tx.tx_no,
        item_id: itemId,
        adjust_no: savedAdjustNo,
        date: savedActualDate,
        action: tx.tx_type,
        owner: '',
        dept: '',
        notes: `掛帳除帳：${item.warehouse_id} | ${tx.reason}`,
      };

      const pidClearPayloads: mockDb.AssetPid[] = [];

      for (const pidVal of nonNaPids) {
        const target = assets.find(asset => asset.pid.toUpperCase() === pidVal.toUpperCase());
        if (!target) return { success: false, error: `PID "${pidVal}" 尚未在平台列管，無法除帳` };
        if (!isOpenLedger(target)) return { success: false, error: `PID "${pidVal}" 目前不是掛帳中狀態，無法除帳` };
        if (!isSamePart(target)) return { success: false, error: `PID "${pidVal}" 的料號與本次申請料號不一致，無法除帳` };
        if (!isSameLedgerDept(target)) return { success: false, error: `PID "${pidVal}" 的掛帳單位與本次異動庫別不一致，無法除帳` };

        const logs = Array.isArray(target.history_logs) ? [...target.history_logs, clearLogEntry] : [clearLogEntry];
        pidClearPayloads.push({
          ...target,
          current_item_id: itemId,
          current_status: '結案/在庫',
          custom_owner: null,
          current_dept: null,
          current_warehouse: item.warehouse_id,
          history_logs: logs,
          notes: clearLogEntry.notes,
        });
      }

      for (const chunk of chunkRows(pidClearPayloads)) {
        const { error } = await supabase!.from('asset_pids').upsert(chunk, { onConflict: 'id' });
        if (error) return { success: false, error: error.message };
      }

      const naQtyToClear = cleanPids.filter(p => p === 'N/A').length;
      if (naQtyToClear > 0) {
        const availableNaAssets = assets.filter(asset =>
          asset.pid === 'N/A' &&
          isOpenLedger(asset) &&
          isSamePart(asset) &&
          isSameLedgerDept(asset) &&
          isSameLedgerOwner(asset)
        );

        if (availableNaAssets.length < naQtyToClear) {
          return {
            success: false,
            error: `可除帳的 N/A 掛帳數量不足：需要 ${naQtyToClear}，目前符合料號、異動庫別與掛帳人員的數量為 ${availableNaAssets.length}`,
          };
        }

        const naClearPayloads = availableNaAssets.slice(0, naQtyToClear).map(target => {
          const logs = Array.isArray(target.history_logs) ? [...target.history_logs, clearLogEntry] : [clearLogEntry];
          return {
            ...target,
            current_item_id: itemId,
            current_status: '結案/在庫',
            custom_owner: null,
            current_dept: null,
            current_warehouse: item.warehouse_id,
            history_logs: logs,
            notes: clearLogEntry.notes,
          };
        });

        for (const chunk of chunkRows(naClearPayloads)) {
          const { error } = await supabase!.from('asset_pids').upsert(chunk, { onConflict: 'id' });
          if (error) return { success: false, error: error.message };
        }
      }

      const { error: closeItemError } = await supabase!
        .from('transaction_items')
        .update({ reconciliation_status: '已結案' })
        .eq('id', itemId);
      if (closeItemError) return { success: false, error: closeItemError.message };

      return { success: true, completed: true };
    }

    // 3. 先清除原本關聯此明細的 PID
    const { error: unlinkError } = await supabase!
      .from('asset_pids')
      .update({ current_item_id: null })
      .eq('current_item_id', itemId);
    if (unlinkError) return { success: false, error: unlinkError.message };

    // 4. 計算狀態機與履歷
    const shouldClearOwner = ['退料', '報廢', '請購', '銷售', '轉撥退回'].includes(tx.tx_type);
    let newStatus = '結案/在庫';
    if (['轉撥', '領料', '製令'].includes(tx.tx_type)) newStatus = '外借/掛帳中';
    else if (tx.tx_type === '內部轉調') newStatus = '內部轉調';

    const logEntry = {
      tx_no: tx.tx_no,
      item_id: itemId,
      adjust_no: savedAdjustNo,
      date: savedActualDate,
      action: tx.tx_type,
      owner: shouldClearOwner ? '' : tx.custom_owner,
      dept: shouldClearOwner ? '' : tx.current_dept,
      notes: `轉倉至：${item.warehouse_id} | ${tx.reason}`,
    };

    // 5. 寫入 PID。大量 N/A 以批次新增，避免大批量補登時逐筆等待資料庫回應。
    const naCreateRows = cleanPids
      .filter(pidVal => pidVal === 'N/A')
      .map(() => ({
          pid: 'N/A',
          current_item_id: itemId,
          current_status: newStatus,
          current_owner_id: null,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: [logEntry],
          notes: tx.reason,
      }));

    for (const chunk of chunkRows(naCreateRows)) {
      const { error: insertNaError } = await supabase!.from('asset_pids').insert(chunk);
      if (insertNaError) return { success: false, error: insertNaError.message };
    }

    for (const pidVal of cleanPids.filter(pidVal => pidVal !== 'N/A')) {
      const { data: existing, error: existingError } = await supabase!
          .from('asset_pids')
          .select('id, history_logs')
          .eq('pid', pidVal)
          .maybeSingle();
        if (existingError) return { success: false, error: existingError.message };

        let logs = [logEntry];
        if (existing && Array.isArray(existing.history_logs)) {
          logs = [...existing.history_logs, logEntry];
        }

        const payload = {
          pid: pidVal,
          current_item_id: itemId,
          current_status: newStatus,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: logs,
          notes: tx.reason,
        };

        const { error: writePidError } = existing
          ? await supabase!.from('asset_pids').update(payload).eq('id', existing.id)
          : await supabase!.from('asset_pids').insert(payload);
        if (writePidError) return { success: false, error: writePidError.message };
    }

    const { error: finalCloseError } = await supabase!
      .from('transaction_items')
      .update({ reconciliation_status: '已結案' })
      .eq('id', itemId);
    if (finalCloseError) return { success: false, error: finalCloseError.message };

    return { success: true, completed: true };
  }
};

export const assetPidsApi = {
  async applySpecificLedgerCorrection() {
    if (!isRealSupabase) {
      mockDb.applySpecificLedgerClearingCorrections();
      const underCleared = mockDb.applyUnderClearedLoanLedgerCorrections();
      return {
        success: underCleared.success,
        correctedCount: underCleared.correctedCount,
        remainingCount: underCleared.remainingCount,
        message: underCleared.message,
      };
    }
    return { success: false, correctedCount: 0, remainingCount: 0, error: '正式資料庫尚未啟用此校正' };
  },

  async getAll() {
    if (!isRealSupabase) {
      return mockDb.getAssetPids();
    }
    const { data } = await supabase!.from('asset_pids').select('*');
    return data || [];
  },

  async search(query: string) {
    if (!isRealSupabase) {
      const pids = mockDb.getAssetPids();
      return pids.filter(p => p.pid.toLowerCase().includes(query.toLowerCase()));
    }
    const { data } = await supabase!
      .from('asset_pids')
      .select('*')
      .ilike('pid', `%${query}%`);
    return data || [];
  },

  async getTimeline(pid: string) {
    if (!isRealSupabase) {
      const records = mockDb.getAssetPids();
      const match = records.find(p => p.pid.toUpperCase() === pid.toUpperCase());
      return match ? match.history_logs : [];
    }
    const { data, error } = await supabase!
      .from('asset_pids')
      .select('history_logs')
      .eq('pid', pid)
      .single();
    if (error || !data) return [];
    return data.history_logs || [];
  },

  async delete(pid: string) {
    if (!isRealSupabase) {
      return mockDb.deleteAssetPid(pid);
    }
    const { error } = await supabase!
      .from('asset_pids')
      .delete()
      .eq('pid', pid);
    return { success: !error };
  },

  async updateLedgerOwner(assetId: string, customOwner: string, currentDept: string) {
    if (!isRealSupabase) {
      return mockDb.updateAssetLedgerOwner(assetId, customOwner, currentDept);
    }
    const owner = customOwner.trim();
    const dept = currentDept.trim();
    if (!owner || !dept) {
      return { success: false, error: '請輸入掛帳同仁與掛帳單位' };
    }
    const { error } = await supabase!
      .from('asset_pids')
      .update({
        custom_owner: owner,
        current_dept: dept,
      })
      .eq('id', assetId);
    return { success: !error, error: error?.message };
  }
};

export const loginLogsApi = {
  async getAll() {
    if (!isRealSupabase) {
      return [...mockDb.getLoginLogs()].sort(
        (a, b) => b.logged_at.localeCompare(a.logged_at)
      );
    }
    const { data } = await supabase!.from('login_logs').select('*');
    return data || [];
  }
};
