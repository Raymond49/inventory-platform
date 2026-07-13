// 本機模擬資料庫 (Mock DB) 服務
// 用於當 Supabase URL/Key 未提供時，系統能正常運作並展示所有核心業務邏輯
// 所有註解均使用繁體中文

export type TxType = '領料' | '轉撥' | '內部轉調' | '退料' | '報廢' | '製令' | '請購' | '銷售' | '轉撥退回';
export type Direction = '進庫' | '出庫';
export type AssetStatusType = '外借/掛帳中' | '內部轉調' | '結案/在庫';

// 每種異動別的預設進出庫方向
export const TX_TYPE_DIRECTION: Record<TxType, Direction> = {
  '領料': '出庫',
  '轉撥': '出庫',
  '內部轉調': '出庫',
  '退料': '進庫',
  '報廢': '出庫',
  '製令': '出庫',
  '請購': '進庫',
  '銷售': '出庫',
  '轉撥退回': '進庫',
};

// 產品別選項
export const PRODUCT_CATEGORIES = [
  'Atto',
  'Athena',
  'CUBE系列',
  'AMI FAN',
  '配件',
  'Poseidon',
  '原材',
  '其他產品',
];

export interface Profile {
  id: string;
  email: string;
  name: string;
  department: string;
  role: 'Admin' | 'Editor' | 'Viewer';
  created_at: string;
}

// 申請單主表
export interface Transaction {
  id: string;
  tx_no: string;
  tx_type: TxType;
  direction: Direction;
  custom_owner: string;         // 掛帳同仁姓名 (所有異動別均強制必填)
  current_dept: string;         // 掛帳單位 (所有異動別均強制必填)
  source_dept?: string;         // 轉出單位 (僅轉撥、內部轉調適用)
  reason: string;               // 需求原因/備註 (所有異動別均強制必填)
  created_by: string;
  updated_by: string;
  created_at: string;
}

// 申請單物料明細表 (一對多)
export interface TransactionItem {
  id: string;
  transaction_id: string;
  category: string;
  part_no: string;
  quantity: number;
  warehouse_id: string;
  actual_date: string | null;   // 修補明細時填入
  adjust_no: string | null;     // 存貨調整單號，修補明細時填入
  pending_pids?: string[] | null; // 尚未結案前暫存的 PID / N/A
  reconciliation_status: '已結案' | '明細待補';
  created_at: string;
}

export interface HistoryLog {
  tx_no: string;
  item_id?: string;             // 💡 紀錄關聯的明細 ID，以便刪除回退
  adjust_no: string;
  date: string;
  action: string;
  owner: string;
  dept: string;
  notes: string;
}

export interface AssetPid {
  id: string;
  pid: string;
  current_item_id: string | null; // 關聯明細 ID
  current_status: AssetStatusType;
  current_owner_id: string | null;
  custom_owner: string | null;
  current_dept: string | null;
  current_warehouse: string | null; // 當前在庫庫別
  history_logs: HistoryLog[];
  notes: string | null;
  created_at: string;
}

export interface LoginLog {
  id: number;
  email: string;
  logged_at: string;
}

const STORAGE_KEYS = {
  PROFILES: 'nd_inventory_profiles',
  TRANSACTIONS: 'nd_inventory_transactions',
  TRANSACTION_ITEMS: 'nd_inventory_transaction_items',
  ASSET_PIDS: 'nd_inventory_pids',
  LOGIN_LOGS: 'nd_inventory_login_logs',
  CURRENT_USER: 'nd_inventory_current_user',
};

// 預設同仁資料
const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'user-admin-id',
    email: 'admin@nextdrive.io',
    name: '林管理',
    department: '系統管理部',
    role: 'Admin',
    created_at: new Date().toISOString(),
  },
  {
    id: 'user-editor-id',
    email: 'keeper@nextdrive.io',
    name: '張庫管',
    department: '資產管理課',
    role: 'Editor',
    created_at: new Date().toISOString(),
  },
  {
    id: 'user-viewer-id',
    email: 'staff@nextdrive.io',
    name: '陳同仁',
    department: '研發一部',
    role: 'Viewer',
    created_at: new Date().toISOString(),
  },
];

// 初始化資料庫
export function initMockDb() {
  if (typeof window === 'undefined') return;
  if (!localStorage.getItem(STORAGE_KEYS.PROFILES)) {
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(DEFAULT_PROFILES));
  }
  if (!localStorage.getItem(STORAGE_KEYS.TRANSACTIONS)) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS)) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.ASSET_PIDS)) {
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify([]));
  }
  if (!localStorage.getItem(STORAGE_KEYS.LOGIN_LOGS)) {
    localStorage.setItem(STORAGE_KEYS.LOGIN_LOGS, JSON.stringify([]));
  }
  restoreMissingLedgerAssetsFromClosedRecords();
  applyMissingLedgerClearingForClosedRecords();
  applySpecificLedgerClearingCorrections();
  applyUnderClearedLoanLedgerCorrections();
}

function restoreMissingLedgerAssetsFromClosedRecords() {
  const transactions: Transaction[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
  const txItems: TransactionItem[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS) || '[]');
  const assetPids: AssetPid[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_PIDS) || '[]');
  const restoredPids = [...assetPids];
  const recoveryTargets = [
    { txNo: 'ICR2024-000882', partNo: '0802-0051004000', warehouseId: 'TW : QA' },
    { txNo: 'ICR2024-000882', partNo: '1301-0011301000', warehouseId: 'TW : QA' },
    { txNo: 'ICR2022-000371', partNo: '1301-0011301000', warehouseId: 'TW : QA' },
  ];

  const normalizeRecoveryKey = (value: string | null | undefined) =>
    (value || '').replace(/\s+/g, '').toUpperCase();

  const getNewStatus = (txType: TxType): AssetStatusType => {
    if (['轉撥', '領料', '製令', '銷售'].includes(txType)) return '外借/掛帳中';
    if (txType === '內部轉調') return '內部轉調';
    return '結案/在庫';
  };

  const shouldClearOwner = (txType: TxType) =>
    ['入庫', '退貨', '採購', '銷售', '領料退回'].includes(txType);

  const getTrackedLedgerCount = (itemId: string) =>
    restoredPids.filter(pid =>
      pid.history_logs.some(log => String(log.item_id) === String(itemId))
    ).length;

  txItems.forEach(item => {
    if (item.reconciliation_status !== '已結案') return;

    const tx = transactions.find(row => row.id === item.transaction_id);
    if (!tx || !PID_REQUIRED_TX_TYPES.includes(tx.tx_type)) return;
    const isRecoveryTarget = recoveryTargets.some(target =>
      normalizeRecoveryKey(target.txNo) === normalizeRecoveryKey(tx.tx_no) &&
      normalizeRecoveryKey(target.partNo) === normalizeRecoveryKey(item.part_no) &&
      (
        normalizeRecoveryKey(target.warehouseId) === normalizeRecoveryKey(item.warehouse_id) ||
        normalizeRecoveryKey(target.warehouseId) === normalizeRecoveryKey(tx.current_dept)
      )
    );
    if (!isRecoveryTarget) return;

    const quantity = Math.max(0, Number(item.quantity) || 0);
    const missingQuantity = quantity - getTrackedLedgerCount(item.id);
    if (missingQuantity <= 0) return;

    const owner = shouldClearOwner(tx.tx_type) ? '' : tx.custom_owner;
    const dept = shouldClearOwner(tx.tx_type) ? '' : tx.current_dept;
    const notes = `轉倉至：${item.warehouse_id} | ${tx.reason}`;
    const logEntry: HistoryLog = {
      tx_no: tx.tx_no,
      item_id: item.id,
      adjust_no: item.adjust_no || '(同倉異動)',
      date: item.actual_date || tx.created_at,
      action: tx.tx_type,
      owner,
      dept,
      notes,
    };

    Array.from({ length: missingQuantity }).forEach(() => {
      restoredPids.push({
        id: 'pid-' + Math.random().toString(36).substr(2, 9),
        pid: 'N/A',
        current_item_id: item.id,
        current_status: getNewStatus(tx.tx_type),
        current_owner_id: null,
        custom_owner: owner || null,
        current_dept: dept || null,
        current_warehouse: item.warehouse_id,
        history_logs: [logEntry],
        notes: tx.reason,
        created_at: new Date().toISOString(),
      });
    });
  });

  if (restoredPids.length !== assetPids.length) {
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(restoredPids));
  }
}

function applyMissingLedgerClearingForClosedRecords() {
  const transactions: Transaction[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
  const txItems: TransactionItem[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS) || '[]');
  const assetPids: AssetPid[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_PIDS) || '[]');
  const clearingTargets = [
    { txNo: 'ICR-26000022', warehouseId: 'TW : QA' },
  ];
  const normalizeKey = (value: string | null | undefined) =>
    (value || '').replace(/\s+/g, '').toUpperCase();
  const normalizeDocNo = (value: string | null | undefined) =>
    normalizeKey(value).replace(/[^A-Z0-9]/g, '');

  const isOpenLedger = (asset: AssetPid) =>
    asset.current_status !== '結案/在庫' && Boolean(asset.current_item_id);

  const getLinkedItem = (asset: AssetPid) =>
    txItems.find(item => String(item.id) === String(asset.current_item_id));

  const getAssetKnownPartNos = (asset: AssetPid) => {
    const partNos = new Set<string>();
    const currentItem = getLinkedItem(asset);
    if (currentItem?.part_no) partNos.add(normalizeKey(currentItem.part_no));
    (asset.history_logs || []).forEach(log => {
      const historyItem = txItems.find(item => String(item.id) === String(log.item_id));
      if (historyItem?.part_no) partNos.add(normalizeKey(historyItem.part_no));
    });
    return partNos;
  };

  const isWarehouseMatch = (left: string | null | undefined, right: string | null | undefined) => {
    const leftKey = normalizeKey(left);
    const rightKey = normalizeKey(right);
    const leftTail = leftKey.includes(':') ? leftKey.split(':').pop() || leftKey : leftKey;
    const rightTail = rightKey.includes(':') ? rightKey.split(':').pop() || rightKey : rightKey;
    return leftKey === rightKey || leftTail === rightTail;
  };

  const isSameWarehouse = (asset: AssetPid, warehouseId: string) =>
    isWarehouseMatch(asset.current_warehouse, warehouseId) ||
    isWarehouseMatch(asset.current_dept, warehouseId);

  const isSamePart = (asset: AssetPid, partNo: string) => {
    const knownPartNos = getAssetKnownPartNos(asset);
    return knownPartNos.size === 0 || knownPartNos.has(normalizeKey(partNo));
  };

  let updatedPids = [...assetPids];
  let hasChanged = false;

  txItems.forEach(item => {
    if (item.reconciliation_status !== '已結案') return;
    const tx = transactions.find(row => row.id === item.transaction_id);
    if (!tx || tx.tx_type !== '領料') return;

    const target = clearingTargets.find(row =>
      normalizeKey(row.txNo) === normalizeKey(tx.tx_no) &&
      (
        normalizeKey(row.warehouseId) === normalizeKey(item.warehouse_id) ||
        normalizeKey(row.warehouseId) === normalizeKey(tx.current_dept)
      )
    );
    if (!target) return;

    const wrongSelfLedgerIds = new Set(
      updatedPids
        .filter(asset =>
          asset.current_item_id === item.id &&
          String(asset.history_logs[0]?.item_id) === String(item.id)
        )
        .map(asset => asset.id)
    );
    if (wrongSelfLedgerIds.size > 0) {
      updatedPids = updatedPids.filter(asset => !wrongSelfLedgerIds.has(asset.id));
      hasChanged = true;
    }

    const requiredQty = Math.max(0, Number(item.quantity) || 0);
    const clearedQty = updatedPids.filter(asset =>
      asset.current_item_id === item.id &&
      asset.current_status === '結案/在庫' &&
      asset.history_logs.length > 1 &&
      String(asset.history_logs[0]?.item_id) !== String(item.id) &&
      asset.history_logs.some(log => String(log.item_id) === String(item.id))
    ).length;
    const qtyToClear = requiredQty - clearedQty;
    if (qtyToClear <= 0) return;

    const clearLogEntry: HistoryLog = {
      tx_no: tx.tx_no,
      item_id: item.id,
      adjust_no: item.adjust_no || '(同倉異動)',
      date: item.actual_date || tx.created_at,
      action: tx.tx_type,
      owner: '',
      dept: '',
      notes: `掛帳除帳：${target.warehouseId} | ${tx.reason}`,
    };

    const clearIndexes = updatedPids
      .map((asset, idx) => ({ asset, idx }))
      .filter(({ asset }) =>
        asset.current_item_id !== item.id &&
        isOpenLedger(asset) &&
        isSamePart(asset, item.part_no) &&
        isSameWarehouse(asset, target.warehouseId)
      )
      .slice(0, qtyToClear)
      .map(({ idx }) => idx);

    clearIndexes.forEach(idx => {
      const asset = updatedPids[idx];
      updatedPids[idx] = {
        ...asset,
        current_item_id: item.id,
        current_status: '結案/在庫',
        custom_owner: null,
        current_dept: null,
        current_warehouse: target.warehouseId,
        history_logs: [...asset.history_logs, clearLogEntry],
        notes: clearLogEntry.notes,
      };
      hasChanged = true;
    });
  });

  if (hasChanged) {
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedPids));
  }
}

export function applyUnderClearedLoanLedgerCorrections(): { success: boolean; correctedCount: number; remainingCount: number; message?: string } {
  const transactions: Transaction[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
  const txItems: TransactionItem[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS) || '[]');
  const assetPids: AssetPid[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_PIDS) || '[]');
  const forcedTargets = [
    { txNo: 'ICR-26000023', partNo: '1301-0011301000', warehouseId: 'TW : FAE', quantity: 3 },
  ];

  const normalizeKey = (value: string | null | undefined) =>
    (value || '').replace(/\s+/g, '').toUpperCase();
  const normalizeDocNo = (value: string | null | undefined) =>
    normalizeKey(value).replace(/[^A-Z0-9]/g, '');

  const isClosed = (asset: AssetPid) =>
    normalizeKey(asset.current_status) === normalizeKey('結案/在庫') ||
    (!asset.custom_owner && !asset.current_dept && Boolean(asset.current_item_id));

  const isOpenLedger = (asset: AssetPid) =>
    Boolean(asset.current_item_id) &&
    Boolean(asset.custom_owner || asset.current_dept) &&
    normalizeKey(asset.current_status) !== normalizeKey('結案/在庫');

  const getLinkedItem = (asset: AssetPid) =>
    txItems.find(item => String(item.id) === String(asset.current_item_id));

  const isWarehouseMatch = (left: string | null | undefined, right: string | null | undefined) => {
    const leftKey = normalizeKey(left);
    const rightKey = normalizeKey(right);
    const leftTail = leftKey.includes(':') ? leftKey.split(':').pop() || leftKey : leftKey;
    const rightTail = rightKey.includes(':') ? rightKey.split(':').pop() || rightKey : rightKey;
    return leftKey === rightKey || leftTail === rightTail;
  };

  const isSameWarehouse = (asset: AssetPid, warehouseId: string) =>
    isWarehouseMatch(asset.current_warehouse, warehouseId) ||
    isWarehouseMatch(asset.current_dept, warehouseId);

  const getAssetKnownPartNos = (asset: AssetPid) => {
    const partNos = new Set<string>();
    const currentItem = getLinkedItem(asset);
    if (currentItem?.part_no) partNos.add(normalizeKey(currentItem.part_no));
    (asset.history_logs || []).forEach(log => {
      const historyItem = txItems.find(item => String(item.id) === String(log.item_id));
      if (historyItem?.part_no) partNos.add(normalizeKey(historyItem.part_no));
    });
    return partNos;
  };

  const isSamePart = (asset: AssetPid, partNo: string) => {
    const knownPartNos = getAssetKnownPartNos(asset);
    return knownPartNos.size === 0 || knownPartNos.has(normalizeKey(partNo));
  };

  let updatedPids = [...assetPids];
  let hasChanged = false;
  let correctedCount = 0;
  let remainingCount = 0;
  let targetCount = 0;
  let lastMessage = '';

  txItems.forEach(item => {
    const tx = transactions.find(row => row.id === item.transaction_id);
    if (!tx) return;

    const forcedTarget = forcedTargets.find(target =>
      normalizeDocNo(target.txNo) === normalizeDocNo(tx.tx_no) &&
      normalizeKey(target.partNo) === normalizeKey(item.part_no)
    );
    if (!forcedTarget) return;
    targetCount += 1;

    const requiredQty = Math.max(0, Number(forcedTarget?.quantity ?? item.quantity) || 0);
    if (requiredQty <= 0) return;
    const targetWarehouse = forcedTarget?.warehouseId || item.warehouse_id;

    const clearedQty = Math.min(requiredQty, updatedPids.filter(asset =>
      String(asset.current_item_id) === String(item.id) &&
      isClosed(asset) &&
      (asset.history_logs || []).some(log => String(log.item_id) === String(item.id))
    ).length);

    updatedPids = updatedPids.map(asset => {
      const hasClearHistory =
        String(asset.current_item_id) === String(item.id) &&
        (asset.history_logs || []).some(log => String(log.item_id) === String(item.id));
      if (!hasClearHistory || normalizeKey(asset.current_status) === normalizeKey('結案/在庫')) {
        return asset;
      }
      hasChanged = true;
      return {
        ...asset,
        current_status: '結案/在庫',
        custom_owner: null,
        current_dept: null,
        current_warehouse: targetWarehouse,
      };
    });

    const forceCorrectionMarker = `ICR-26000023-1301-0011301000-FAE-FORCE-CLEAR`;
    const markedCorrectionCount = updatedPids.filter(asset =>
      (asset.history_logs || []).some(log => (log.notes || '').includes(forceCorrectionMarker))
    ).length;
    const forcedQtyToClear = forcedTarget ? Math.max(0, 2 - markedCorrectionCount) : 0;
    let forcedCorrectedCount = 0;

    if (forcedQtyToClear > 0) {
      const forceLogEntry: HistoryLog = {
        tx_no: tx.tx_no,
        item_id: item.id,
        adjust_no: item.adjust_no || '(待補調整單號)',
        date: item.actual_date || tx.created_at,
        action: tx.tx_type,
        owner: '',
        dept: '',
        notes: `掛帳除帳補正：${targetWarehouse} | ${forceCorrectionMarker} | ${tx.reason}`,
      };

      const forceExactCandidates = updatedPids
        .map((asset, idx) => ({ asset, idx }))
        .filter(({ asset }) =>
          String(asset.current_item_id) !== String(item.id) &&
          isOpenLedger(asset) &&
          asset.pid === 'N/A' &&
          isSamePart(asset, item.part_no) &&
          isSameWarehouse(asset, targetWarehouse)
        )
        .slice(0, forcedQtyToClear);

      const forceExactCandidateIds = new Set(forceExactCandidates.map(({ asset }) => asset.id));
      const forceFallbackCandidates = updatedPids
        .map((asset, idx) => ({ asset, idx }))
        .filter(({ asset }) =>
          !forceExactCandidateIds.has(asset.id) &&
          String(asset.current_item_id) !== String(item.id) &&
          isOpenLedger(asset) &&
          asset.pid === 'N/A' &&
          isSameWarehouse(asset, targetWarehouse)
        )
        .slice(0, Math.max(0, forcedQtyToClear - forceExactCandidates.length));

      [...forceExactCandidates, ...forceFallbackCandidates].forEach(({ idx }) => {
        const asset = updatedPids[idx];
        updatedPids[idx] = {
          ...asset,
          current_item_id: item.id,
          current_status: '結案/在庫',
          custom_owner: null,
          current_dept: null,
          current_warehouse: targetWarehouse,
          history_logs: [...asset.history_logs, forceLogEntry],
          notes: forceLogEntry.notes,
        };
        hasChanged = true;
        correctedCount += 1;
        forcedCorrectedCount += 1;
      });

      remainingCount += Math.max(0, forcedQtyToClear - forcedCorrectedCount);
      lastMessage = `${tx.tx_no} / ${item.part_no} 一次性補扣 ${forcedCorrectedCount}/${forcedQtyToClear} 筆`;
    }

    const qtyToClear = requiredQty - clearedQty;
    if (qtyToClear <= 0) {
      lastMessage = `${tx.tx_no} / ${item.part_no} 補正完成，已扣 ${requiredQty}/${requiredQty} 筆，無需補扣`;
      return;
    }

    const clearLogEntry: HistoryLog = {
      tx_no: tx.tx_no,
      item_id: item.id,
      adjust_no: item.adjust_no || '(待補調整單號)',
      date: item.actual_date || tx.created_at,
      action: tx.tx_type,
      owner: '',
      dept: '',
      notes: `掛帳除帳補正：${targetWarehouse} | ${tx.reason}`,
    };

    const exactCandidates = updatedPids
      .map((asset, idx) => ({ asset, idx }))
      .filter(({ asset }) =>
        String(asset.current_item_id) !== String(item.id) &&
        isOpenLedger(asset) &&
        asset.pid === 'N/A' &&
        isSamePart(asset, item.part_no) &&
        isSameWarehouse(asset, targetWarehouse)
      )
      .sort((left, right) => {
        if (left.asset.pid === 'N/A' && right.asset.pid !== 'N/A') return -1;
        if (left.asset.pid !== 'N/A' && right.asset.pid === 'N/A') return 1;
        return 0;
      })
      .slice(0, qtyToClear);

    const exactCandidateIds = new Set(exactCandidates.map(({ asset }) => asset.id));
    const fallbackCandidates = forcedTarget
      ? updatedPids
          .map((asset, idx) => ({ asset, idx }))
          .filter(({ asset }) =>
            !exactCandidateIds.has(asset.id) &&
            String(asset.current_item_id) !== String(item.id) &&
            isOpenLedger(asset) &&
            asset.pid === 'N/A' &&
            isSameWarehouse(asset, targetWarehouse)
          )
          .slice(0, Math.max(0, qtyToClear - exactCandidates.length))
      : [];

    const candidates = [...exactCandidates, ...fallbackCandidates];
    lastMessage = `${tx.tx_no} / ${item.part_no} 已扣 ${clearedQty}/${requiredQty} 筆，可補扣候選 ${candidates.length} 筆`;

    candidates.forEach(({ idx }) => {
      const asset = updatedPids[idx];
      updatedPids[idx] = {
        ...asset,
        current_item_id: item.id,
        current_status: '結案/在庫',
        custom_owner: null,
        current_dept: null,
        current_warehouse: targetWarehouse,
        history_logs: [...asset.history_logs, clearLogEntry],
        notes: clearLogEntry.notes,
      };
      hasChanged = true;
      correctedCount += 1;
    });

    remainingCount += Math.max(0, qtyToClear - candidates.length);
  });

  if (hasChanged) {
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedPids));
  }

  return {
    success: true,
    correctedCount,
    remainingCount,
    message: lastMessage || (targetCount === 0 ? '找不到 ICR-26000023 / 1301-0011301000 這筆補正明細' : undefined),
  };
}

export function applySpecificLedgerClearingCorrections(): { success: boolean; correctedCount: number; remainingCount: number } {
  const transactions: Transaction[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
  const txItems: TransactionItem[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS) || '[]');
  const assetPids: AssetPid[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_PIDS) || '[]');
  const corrections = [
    {
      clearTxNo: 'ICR-26000022',
      sourceTxNo: 'ICR2024-000882',
      partNo: '0802-0051004000',
      warehouseId: 'TW : QA',
      quantity: 5,
    },
  ];
  const normalizeKey = (value: string | null | undefined) =>
    (value || '').replace(/\s+/g, '').toUpperCase();
  const findTx = (txNo: string) =>
    transactions.find(tx => normalizeKey(tx.tx_no) === normalizeKey(txNo));
  const findItemTx = (itemId: string | null | undefined) => {
    const item = txItems.find(row => String(row.id) === String(itemId));
    const tx = item ? transactions.find(row => row.id === item.transaction_id) : null;
    return { item, tx };
  };
  const isClosed = (asset: AssetPid) => normalizeKey(asset.current_status) === normalizeKey('結案/在庫');
  const isOpen = (asset: AssetPid) => !isClosed(asset) && Boolean(asset.current_item_id);
  const isSameWarehouse = (asset: AssetPid, warehouseId: string) =>
    normalizeKey(asset.current_warehouse) === normalizeKey(warehouseId) ||
    normalizeKey(asset.current_dept) === normalizeKey(warehouseId);

  let updatedPids = [...assetPids];
  let hasChanged = false;
  let correctedCount = 0;

  corrections.forEach(correction => {
    const clearTx = findTx(correction.clearTxNo);
    if (!clearTx) return;

    const clearItem = txItems.find(item =>
      item.transaction_id === clearTx.id &&
      normalizeKey(item.part_no) === normalizeKey(correction.partNo)
    );
    if (!clearItem) return;

    const wrongSelfLedgerIds = new Set(
      updatedPids
        .filter(asset =>
          String(asset.current_item_id) === String(clearItem.id) &&
          String(asset.history_logs[0]?.item_id) === String(clearItem.id)
        )
        .map(asset => asset.id)
    );
    if (wrongSelfLedgerIds.size > 0) {
      updatedPids = updatedPids.filter(asset => !wrongSelfLedgerIds.has(asset.id));
      hasChanged = true;
    }

    const clearLogEntry: HistoryLog = {
      tx_no: clearTx.tx_no,
      item_id: clearItem.id,
      adjust_no: clearItem.adjust_no || '(同倉異動)',
      date: clearItem.actual_date || clearTx.created_at,
      action: clearTx.tx_type,
      owner: '',
      dept: '',
      notes: `掛帳除帳：${correction.warehouseId} | ${clearTx.reason}`,
    };

    const sourceIndexes = updatedPids
      .map((asset, idx) => ({ asset, idx }))
      .filter(({ asset }) => {
        const { item, tx } = findItemTx(asset.current_item_id);
        return (
          isOpen(asset) &&
          asset.pid === 'N/A' &&
          isSameWarehouse(asset, correction.warehouseId) &&
          normalizeKey(tx?.tx_no) === normalizeKey(correction.sourceTxNo) &&
          normalizeKey(item?.part_no) === normalizeKey(correction.partNo)
        );
      })
      .slice(0, correction.quantity)
      .map(({ idx }) => idx);

    sourceIndexes.forEach(idx => {
      const asset = updatedPids[idx];
      updatedPids[idx] = {
        ...asset,
        current_item_id: clearItem.id,
        current_status: '結案/在庫',
        custom_owner: null,
        current_dept: null,
        current_warehouse: correction.warehouseId,
        history_logs: [...asset.history_logs, clearLogEntry],
        notes: clearLogEntry.notes,
      };
      hasChanged = true;
      correctedCount += 1;
    });
  });

  const remainingCount = corrections.reduce((total, correction) => {
    return total + updatedPids.filter(asset => {
      const { item, tx } = findItemTx(asset.current_item_id);
      return (
        isOpen(asset) &&
        asset.pid === 'N/A' &&
        isSameWarehouse(asset, correction.warehouseId) &&
        normalizeKey(tx?.tx_no) === normalizeKey(correction.sourceTxNo) &&
        normalizeKey(item?.part_no) === normalizeKey(correction.partNo)
      );
    }).length;
  }, 0);

  if (hasChanged) {
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedPids));
  }

  return { success: true, correctedCount, remainingCount };
}

export function getProfiles(): Profile[] {
  initMockDb();
  if (typeof window === 'undefined') return DEFAULT_PROFILES;
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROFILES) || '[]');
}

export function getCurrentUser(): Profile | null {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
  if (!user) return null;
  return JSON.parse(user);
}

export function loginMockUser(email: string, name: string): { success: boolean; error?: string; user?: Profile } {
  if (typeof window === 'undefined') return { success: false };

  if (!email.endsWith('@nextdrive.io')) {
    return { success: false, error: '僅限公司網域信箱 (@nextdrive.io) 登入' };
  }

  const profiles = getProfiles();
  let user = profiles.find((p) => p.email === email);

  if (!user) {
    user = {
      id: 'user-' + Math.random().toString(36).substr(2, 9),
      email,
      name: name || email.split('@')[0],
      department: '未分配部門',
      role: 'Viewer',
      created_at: new Date().toISOString(),
    };
    profiles.push(user);
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
  }

  localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));

  const logs = JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGIN_LOGS) || '[]');
  logs.push({ id: Date.now(), email, logged_at: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEYS.LOGIN_LOGS, JSON.stringify(logs));

  return { success: true, user };
}

export function logoutMockUser() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
}

export function switchMockRole(role: 'Admin' | 'Editor' | 'Viewer') {
  if (typeof window === 'undefined') return;
  const user = getCurrentUser();
  if (user) {
    user.role = role;
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    const profiles = getProfiles();
    const idx = profiles.findIndex(p => p.id === user.id);
    if (idx !== -1) {
      profiles[idx].role = role;
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
    }
  }
}

export function getTransactions(): Transaction[] {
  initMockDb();
  if (typeof window === 'undefined') return [];
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTIONS) || '[]');
}

export function getTransactionItems(): TransactionItem[] {
  initMockDb();
  if (typeof window === 'undefined') return [];
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSACTION_ITEMS) || '[]');
}

export function getAssetPids(): AssetPid[] {
  initMockDb();
  if (typeof window === 'undefined') return [];
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_PIDS) || '[]');
}

export function getLoginLogs(): LoginLog[] {
  initMockDb();
  if (typeof window === 'undefined') return [];
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.LOGIN_LOGS) || '[]');
}

// =============================================
// 開立新一對多單據 (含主表與明細表)
// =============================================
export function createTransaction(
  txData: Omit<Transaction, 'id' | 'created_at'>,
  items: Omit<TransactionItem, 'id' | 'transaction_id' | 'actual_date' | 'adjust_no' | 'pending_pids' | 'reconciliation_status' | 'created_at'>[]
): { success: boolean; error?: string; tx_no?: string } {
  if (typeof window === 'undefined') return { success: false };

  const transactions = getTransactions();
  const txItems = getTransactionItems();
  const cleanTxNo = txData.tx_no.trim();

  // 驗證單號是否重複
  const isDupe = transactions.some(t => t.tx_no.toLowerCase() === cleanTxNo.toLowerCase());
  if (isDupe) {
    return { success: false, error: `申請單號 "${cleanTxNo}" 已存在，不得重複` };
  }

  if (items.length === 0) {
    return { success: false, error: '請至少新增一筆產品物料項目' };
  }

  // 1. 寫入主表
  const newTxId = 'tx-' + Math.random().toString(36).substr(2, 9);
  const newTx: Transaction = {
    ...txData,
    tx_no: cleanTxNo,
    source_dept: txData.source_dept || undefined,
    id: newTxId,
    created_at: new Date().toISOString(),
  };
  transactions.push(newTx);
  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));

  // 2. 寫入明細表
  items.forEach(item => {
    const newItem: TransactionItem = {
      ...item,
      id: 'item-' + Math.random().toString(36).substr(2, 9),
      transaction_id: newTxId,
      actual_date: null,
      adjust_no: null,
      pending_pids: null,
      reconciliation_status: '明細待補',
      created_at: new Date().toISOString(),
    };
    txItems.push(newItem);
  });
  localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));

  return { success: true, tx_no: cleanTxNo };
}

// 會建立掛帳 PID 或 N/A 帳值的異動別清單。
// 領料僅能在「料號 + 異動庫別」已有符合掛帳資料時除帳；沒有掛帳時只保留出入庫紀錄。
export const PID_REQUIRED_TX_TYPES: TxType[] = ['轉撥', '內部轉調', '轉撥退回'];

export type LedgerAction = 'CREATE_LOAN_LEDGER' | 'CLEAR_LOAN_LEDGER' | 'NORMAL_RECORD_ONLY';

const isOpenLedgerAsset = (asset: AssetPid) =>
  asset.current_status !== '結案/在庫' && Boolean(asset.current_item_id);

const getLinkedItem = (asset: AssetPid, txItems: TransactionItem[]) =>
  txItems.find(i => i.id === asset.current_item_id);

const normalizeLedgerKey = (value: string | null | undefined) =>
  (value || '').replace(/\s+/g, '').toUpperCase();

const isSameLedgerWarehouse = (asset: AssetPid, warehouseId: string) =>
  normalizeLedgerKey(asset.current_warehouse) === normalizeLedgerKey(warehouseId) ||
  normalizeLedgerKey(asset.current_dept) === normalizeLedgerKey(warehouseId);

const isSamePartNo = (left: string | null | undefined, right: string | null | undefined) =>
  normalizeLedgerKey(left) === normalizeLedgerKey(right);

export function hasOpenLedgerForItem(
  item: Pick<TransactionItem, 'part_no' | 'warehouse_id'>,
  assetPids: AssetPid[],
  txItems: TransactionItem[]
) {
  return assetPids.some(asset => {
    const linkedItem = getLinkedItem(asset, txItems);
    return (
      isOpenLedgerAsset(asset) &&
      isSamePartNo(linkedItem?.part_no, item.part_no) &&
      isSameLedgerWarehouse(asset, item.warehouse_id)
    );
  });
}

export function resolveLedgerActionForItem(
  txType: TxType,
  item: Pick<TransactionItem, 'part_no' | 'warehouse_id'>,
  assetPids: AssetPid[],
  txItems: TransactionItem[]
): LedgerAction {
  if (txType === '領料') {
    return hasOpenLedgerForItem(item, assetPids, txItems)
      ? 'CLEAR_LOAN_LEDGER'
      : 'NORMAL_RECORD_ONLY';
  }
  return PID_REQUIRED_TX_TYPES.includes(txType) ? 'CREATE_LOAN_LEDGER' : 'NORMAL_RECORD_ONLY';
}

// =============================================
// 修補單筆明細並結案 (以 itemId 為單位)
// 規則：轉撥/內部轉調/轉撥退回 需填 PID；其餘只需填出庫日期與調整單號即可結案
// =============================================
export function repairTransactionItem(
  itemId: string,
  actualDate: string,
  adjustNo: string,
  pids: string[]
): { success: boolean; error?: string; completed?: boolean } {
  if (typeof window === 'undefined') return { success: false };

  const txItems = getTransactionItems();
  const itemIdx = txItems.findIndex(i => i.id === itemId);
  if (itemIdx === -1) return { success: false, error: '找不到對應的物料明細項目' };

  const item = txItems[itemIdx];
  const transactions = getTransactions();
  const tx = transactions.find(t => t.id === item.transaction_id);
  if (!tx) return { success: false, error: '找不到對應的單據主表' };

  const assetPids = getAssetPids();
  const ledgerAction = resolveLedgerActionForItem(tx.tx_type, item, assetPids, txItems);
  const needsPid = ledgerAction !== 'NORMAL_RECORD_ONLY';
  const itemQuantity = Number(item.quantity) || 0;

  const savedActualDate = actualDate.trim();
  const savedAdjustNo = adjustNo.trim();

  // 更新明細基本欄位（日期與調整單號），允許先單獨暫存。
  txItems[itemIdx].actual_date = savedActualDate || null;
  txItems[itemIdx].adjust_no = savedAdjustNo || null;

  // ── 不需要 PID 的異動別：日期與調整單號都齊全才結案 ──
  if (!needsPid) {
    txItems[itemIdx].pending_pids = null;
    txItems[itemIdx].reconciliation_status = savedActualDate && savedAdjustNo ? '已結案' : '明細待補';
    localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));
    return { success: true, completed: txItems[itemIdx].reconciliation_status === '已結案' };
  }

  // ── 需要 PID 或 N/A 帳值的異動別：可先暫存，三項齊全才寫入/結案 asset_pids ──
  const cleanPids = pids.map(p => {
    const t = p.trim();
    return t.toUpperCase() === 'N/A' ? 'N/A' : t;
  });

  // 檢查表單內非 N/A 的 PID 是否重複 (大小寫不敏感)
  const filledPids = cleanPids.filter(p => p !== '');
  const nonNaPids = filledPids.filter(p => p !== 'N/A');
  const dupeInForm = nonNaPids.filter((v, i) => nonNaPids.findIndex(p => p.toUpperCase() === v.toUpperCase()) !== i);
  if (dupeInForm.length > 0) {
    return { success: false, error: `表單內 PID 重複：${dupeInForm.join(', ')}` };
  }

  const pidsComplete = cleanPids.length === itemQuantity && cleanPids.every(p => p !== '');
  const canCloseItem = Boolean(savedActualDate && savedAdjustNo && pidsComplete);
  txItems[itemIdx].pending_pids = cleanPids;
  txItems[itemIdx].reconciliation_status = canCloseItem ? '已結案' : '明細待補';

  if (!canCloseItem) {
    localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));
    return { success: true, completed: false };
  }

  const findLinkedItem = (asset: AssetPid) =>
    txItems.find(i => i.id === asset.current_item_id);

  const isOpenLedger = (asset: AssetPid) =>
    asset.current_status !== '結案/在庫' && Boolean(asset.current_item_id);

  const isSamePart = (asset: AssetPid) =>
    isSamePartNo(findLinkedItem(asset)?.part_no, item.part_no);

  const isSameOwner = (asset: AssetPid) =>
    normalizeLedgerKey(asset.custom_owner) === normalizeLedgerKey(tx.custom_owner);

  if (ledgerAction === 'CLEAR_LOAN_LEDGER') {
    const clearLogEntry: HistoryLog = {
      tx_no: tx.tx_no,
      item_id: itemId,
      adjust_no: savedAdjustNo,
      date: savedActualDate,
      action: tx.tx_type,
      owner: '',
      dept: '',
      notes: `掛帳除帳：${item.warehouse_id} | ${tx.reason}`,
    };

    const updatedPids = [...assetPids];
    const nonNaPidsToClear = cleanPids.filter(pid => pid !== 'N/A');
    const naQtyToClear = cleanPids.filter(pid => pid === 'N/A').length;

    for (const pidVal of nonNaPidsToClear) {
      const targetIdx = updatedPids.findIndex(p => p.pid.toUpperCase() === pidVal.toUpperCase());
      if (targetIdx === -1) {
        return { success: false, error: `PID "${pidVal}" 尚未在平台列管，無法除帳` };
      }

      const target = updatedPids[targetIdx];
      if (!isOpenLedger(target)) {
        return { success: false, error: `PID "${pidVal}" 目前不是掛帳中狀態，無法除帳` };
      }
      if (!isSamePart(target)) {
        return { success: false, error: `PID "${pidVal}" 的料號與本次申請料號不一致，無法除帳` };
      }
      if (!isSameLedgerWarehouse(target, item.warehouse_id)) {
        return { success: false, error: `PID "${pidVal}" 的掛帳庫別與本次異動庫別不一致，無法除帳` };
      }

      updatedPids[targetIdx] = {
        ...target,
        current_item_id: itemId,
        current_status: '結案/在庫',
        custom_owner: null,
        current_dept: null,
        current_warehouse: item.warehouse_id,
        history_logs: [...target.history_logs, clearLogEntry],
        notes: clearLogEntry.notes,
      };
    }

    if (naQtyToClear > 0) {
      const availableNaIndexes = updatedPids
        .map((asset, idx) => ({ asset, idx }))
        .filter(({ asset }) =>
          asset.pid === 'N/A' &&
          isOpenLedger(asset) &&
          isSamePart(asset) &&
          isSameLedgerWarehouse(asset, item.warehouse_id) &&
          isSameOwner(asset)
        )
        .map(({ idx }) => idx);

      if (availableNaIndexes.length < naQtyToClear) {
        return {
          success: false,
          error: `可除帳的 N/A 掛帳數量不足：需要 ${naQtyToClear}，目前符合料號、異動庫別與掛帳人員的數量為 ${availableNaIndexes.length}`,
        };
      }

      availableNaIndexes.slice(0, naQtyToClear).forEach(idx => {
        const target = updatedPids[idx];
        updatedPids[idx] = {
          ...target,
          current_item_id: itemId,
          current_status: '結案/在庫',
          custom_owner: null,
          current_dept: null,
          current_warehouse: item.warehouse_id,
          history_logs: [...target.history_logs, clearLogEntry],
          notes: clearLogEntry.notes,
        };
      });
    }

    txItems[itemIdx].reconciliation_status = '已結案';
    localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedPids));
    return { success: true, completed: true };
  }

  // 💡 修正：僅當該 PID 關聯的明細還在「明細待補」狀態時，才視為被佔用。
  const otherLinkedPids = assetPids
    .filter(p => {
      if (p.current_item_id === itemId || p.pid === 'N/A' || !p.current_item_id) return false;
      const linkedItem = txItems.find(i => i.id === p.current_item_id);
      return linkedItem?.reconciliation_status === '明細待補';
    })
    .map(p => p.pid.toUpperCase());
  
  const occupied = nonNaPids.find(p => otherLinkedPids.includes(p.toUpperCase()));
  if (occupied) {
    return { success: false, error: `PID "${occupied}" 已被其他單據明細佔用` };
  }

  // 💡 特殊邏輯：內部轉調必須是已存在的 PID
  if (tx.tx_type === '內部轉調') {
    const existingPidValues = assetPids.map(p => p.pid.toUpperCase());
    for (const pid of nonNaPids) {
      if (!existingPidValues.includes(pid.toUpperCase())) {
        return { success: false, error: `「內部轉調」失敗：PID "${pid}" 尚未在系統中列管（請先透過請購或退料入庫）` };
      }
    }
  }

  // PID 數量必須等於申請數量才結案
  if (cleanPids.length === itemQuantity) {
    txItems[itemIdx].reconciliation_status = '已結案';
  }
  localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));

  // 計算 PID 狀態機
  const getNewStatus = (txType: TxType): AssetStatusType => {
    if (['轉撥', '領料', '製令', '銷售'].includes(txType)) return '外借/掛帳中';
    if (txType === '內部轉調') return '內部轉調';
    return '結案/在庫';
  };
  const newStatus = getNewStatus(tx.tx_type);
  const shouldClearOwner = ['退料', '報廢', '請購', '銷售', '轉撥退回'].includes(tx.tx_type);

  // 💡 關鍵修復：使用單一變數維護更新後的 PID 快照，避免迴圈內讀取舊數據
  let currentUpdatedPidsSnapshot = assetPids.map(p => {
    if (p.current_item_id === itemId) {
      return { ...p, current_item_id: null };
    }
    return p;
  });

  cleanPids.forEach(pidVal => {
    const logEntry: HistoryLog = {
      tx_no: tx.tx_no,
      item_id: itemId, // 💡 紀錄關聯明細
      adjust_no: savedAdjustNo,
      date: savedActualDate,
      action: tx.tx_type,
      owner: shouldClearOwner ? '' : tx.custom_owner,
      dept: shouldClearOwner ? '' : tx.current_dept,
      notes: `轉倉至：${item.warehouse_id} | ${tx.reason}`,
    };

    if (pidVal === 'N/A') {
      // 💡 如果是轉出操作（如轉撥、內部轉調），嘗試尋找現有的 N/A 機台來進行轉出
      let existingNaIdx = -1;
      if (['轉撥', '內部轉調', '轉撥退回'].includes(tx.tx_type) && tx.source_dept) {
        existingNaIdx = currentUpdatedPidsSnapshot.findIndex(p => {
          if (p.pid !== 'N/A') return false;
          // 必須在來源單位
          if (p.current_dept !== tx.source_dept) return false;
          // 必須是同一個料號 (比對其最後一次關聯的明細)
          const pItem = txItems.find(i => i.id === p.current_item_id);
          if (pItem?.part_no !== item.part_no) return false;
          // 不能是已經被此次單據更新過的 (判斷 current_item_id)
          if (p.current_item_id === itemId) return false;
          return true;
        });
      }

      if (existingNaIdx !== -1) {
        // 找到來源庫存，更新既有的 N/A
        const prevDept = currentUpdatedPidsSnapshot[existingNaIdx].current_dept || '庫存';
        const updatedNotes = `(從 ${prevDept} 轉出) | ${item.warehouse_id ? `轉入：${item.warehouse_id} | ` : ''}${tx.reason}`;
        
        currentUpdatedPidsSnapshot[existingNaIdx] = {
          ...currentUpdatedPidsSnapshot[existingNaIdx],
          current_item_id: itemId,
          current_status: newStatus,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: [...currentUpdatedPidsSnapshot[existingNaIdx].history_logs, {
            ...logEntry,
            notes: updatedNotes
          }],
          notes: updatedNotes,
        };
      } else {
        // 找不到來源庫存或是非轉出操作，則新增 N/A
        currentUpdatedPidsSnapshot.push({
          id: 'pid-' + Math.random().toString(36).substr(2, 9),
          pid: 'N/A',
          current_item_id: itemId,
          current_status: newStatus,
          current_owner_id: null,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: [logEntry],
          notes: tx.reason,
          created_at: new Date().toISOString(),
        });
      }
    } else {
      const existingIdx = currentUpdatedPidsSnapshot.findIndex(p => p.pid.toUpperCase() === pidVal.toUpperCase());
      if (existingIdx !== -1) {
        // 💡 記錄轉出資訊
        const prevDept = currentUpdatedPidsSnapshot[existingIdx].current_dept || '庫存';
        const updatedNotes = `(從 ${prevDept} 轉出) | ${item.warehouse_id ? `轉入：${item.warehouse_id} | ` : ''}${tx.reason}`;
        
        currentUpdatedPidsSnapshot[existingIdx] = {
          ...currentUpdatedPidsSnapshot[existingIdx],
          current_item_id: itemId,
          current_status: newStatus,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: [...currentUpdatedPidsSnapshot[existingIdx].history_logs, {
            ...logEntry,
            notes: updatedNotes
          }],
          notes: updatedNotes,
        };
      } else {
        currentUpdatedPidsSnapshot.push({
          id: 'pid-' + Math.random().toString(36).substr(2, 9),
          pid: pidVal,
          current_item_id: itemId,
          current_status: newStatus,
          current_owner_id: null,
          custom_owner: shouldClearOwner ? null : tx.custom_owner,
          current_dept: shouldClearOwner ? null : tx.current_dept,
          current_warehouse: item.warehouse_id,
          history_logs: [logEntry],
          notes: tx.reason,
          created_at: new Date().toISOString(),
        });
      }
    }
  });

  localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(currentUpdatedPidsSnapshot));
  return { success: true, completed: true };
}

// =============================================
// 刪除單筆 PID 資料 (用於清理測試數據)
// =============================================
export function deleteAssetPid(pid: string): { success: boolean } {
  if (typeof window === 'undefined') return { success: false };
  const pids = getAssetPids();
  const filtered = pids.filter(p => p.pid.toUpperCase() !== pid.toUpperCase());
  localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(filtered));
  return { success: true };
}

export function updateAssetLedgerOwner(
  assetId: string,
  customOwner: string,
  currentDept: string
): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false };
  const pids = getAssetPids();
  const idx = pids.findIndex(p => p.id === assetId);
  if (idx === -1) return { success: false, error: '找不到掛帳資料' };

  const owner = customOwner.trim();
  const dept = currentDept.trim();
  if (!owner || !dept) {
    return { success: false, error: '請輸入掛帳同仁與掛帳單位' };
  }

  const original = pids[idx];
  pids[idx] = {
    ...original,
    custom_owner: owner,
    current_dept: dept,
    notes: original.notes
      ? `${original.notes} | 掛帳歸屬修正：${owner} / ${dept}`
      : `掛帳歸屬修正：${owner} / ${dept}`,
  };
  localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(pids));
  return { success: true };
}

// =============================================
// 更新單據與明細 (用於編輯修正)
// =============================================
export function updateTransaction(
  txId: string,
  itemId: string,
  txData: Partial<Transaction>,
  itemData: Partial<TransactionItem>
): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false };

  const transactions = getTransactions();
  const txItems = getTransactionItems();

  const txIdx = transactions.findIndex(t => t.id === txId);
  const itemIdx = txItems.findIndex(i => i.id === itemId);

  if (txIdx === -1 || itemIdx === -1) {
    return { success: false, error: '找不到對應的單據或明細' };
  }

  // 檢查單號是否與其他單據重複
  if (txData.tx_no && txData.tx_no !== transactions[txIdx].tx_no) {
    const isDupe = transactions.some((t, idx) => idx !== txIdx && t.tx_no.toLowerCase() === txData.tx_no?.toLowerCase());
    if (isDupe) return { success: false, error: `申請單號 "${txData.tx_no}" 已被其他單據使用` };
  }

  // 更新主表
  transactions[txIdx] = { ...transactions[txIdx], ...txData, updated_by: txData.updated_by || transactions[txIdx].updated_by };
  
  // 更新明細表
  txItems[itemIdx] = { ...txItems[itemIdx], ...itemData };

  // 如果更新了主表資訊，同步更新相關 PID 的記錄 (這部分較複雜，簡易處理為更新當前關聯明細的 PID)
  if (txData.custom_owner || txData.current_dept || txData.tx_no) {
    const assetPids = getAssetPids();
    const updatedAssetPids = assetPids.map(p => {
      if (p.current_item_id === itemId) {
        return {
          ...p,
          custom_owner: txData.custom_owner || p.custom_owner,
          current_dept: txData.current_dept || p.current_dept,
          // 注意：history_logs 通常不隨便改，但如果單號改了，可能需要同步
        };
      }
      return p;
    });
    localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedAssetPids));
  }

  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
  localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(txItems));

  return { success: true };
}

// =============================================
// 刪除單據 (連動刪除明細與解除 PID 綁定)
// =============================================
export function deleteTransaction(txId: string): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false };

  const transactions = getTransactions();
  const txItems = getTransactionItems();
  const assetPids = getAssetPids();

  const linkedItemIds = txItems.filter(i => i.transaction_id === txId).map(i => i.id);

  const extractWarehouseFromNotes = (notes: string | null | undefined, fallback: string | null) => {
    if (!notes) return fallback;
    return (
      notes.match(/轉倉至：(.*?)(?:\s|\||$)/)?.[1] ||
      notes.match(/轉入：(.*?)(?:\s|\||$)/)?.[1] ||
      fallback
    );
  };

  const getRevertStatus = (action: string): AssetStatusType => {
    if (['轉撥', '領料', '製令', '銷售'].includes(action)) return '外借/掛帳中';
    if (action === '內部轉調') return '內部轉調';
    return '結案/在庫';
  };

  const filteredPids = assetPids.filter(p => {
    const isLinkedCurrent = linkedItemIds.includes(p.current_item_id || '');
    const canRestoreFromHistory = isLinkedCurrent && p.history_logs.length > 1;

    if (canRestoreFromHistory) return true;

    const firstLogItemId = p.history_logs && p.history_logs.length > 0 ? p.history_logs[0].item_id : null;
    if (firstLogItemId && linkedItemIds.includes(firstLogItemId)) {
      return false;
    }

    if (isLinkedCurrent && p.history_logs.length <= 1) {
      return false;
    }

    return true;
  });

  const updatedPids = filteredPids.map(p => {
    if (linkedItemIds.includes(p.current_item_id || '') && p.history_logs.length > 1) {
      const prevLogs = p.history_logs.slice(0, -1);
      const lastLog = prevLogs[prevLogs.length - 1];
      
      if (!lastLog) return { ...p, current_item_id: null, current_status: '結案/在庫' as AssetStatusType };

      return {
        ...p,
        current_item_id: lastLog.item_id || null,
        current_status: getRevertStatus(lastLog.action),
        custom_owner: lastLog.owner || null,
        current_dept: lastLog.dept || null,
        current_warehouse: extractWarehouseFromNotes(lastLog.notes, p.current_warehouse),
        history_logs: prevLogs,
        notes: lastLog.notes || ''
      };
    }
    return p;
  });

  const filteredTxs = transactions.filter(t => t.id !== txId);
  const filteredItems = txItems.filter(i => i.transaction_id !== txId);

  localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(filteredTxs));
  localStorage.setItem(STORAGE_KEYS.TRANSACTION_ITEMS, JSON.stringify(filteredItems));
  localStorage.setItem(STORAGE_KEYS.ASSET_PIDS, JSON.stringify(updatedPids));

  return { success: true };
}

export function deleteTransactionItem(itemId: string): { success: boolean; error?: string } {
  if (typeof window === 'undefined') return { success: false };

  const txItems = getTransactionItems();
  const assetPids = getAssetPids();
  const target = txItems.find(item => item.id === itemId);
  if (!target) return { success: false, error: '找不到該筆物料明細' };

  const sameTxItems = txItems.filter(item => item.transaction_id === target.transaction_id);
  if (sameTxItems.length <= 1) {
    return { success: false, error: '此單據只剩一筆明細，請改用刪除整張單據。' };
  }

  const linkedAssetCount = assetPids.filter(asset => asset.current_item_id === itemId).length;
  if (linkedAssetCount > 0) {
    return { success: false, error: '此明細已有掛帳資料連結，請先確認掛帳資料後再刪除。' };
  }

  localStorage.setItem(
    STORAGE_KEYS.TRANSACTION_ITEMS,
    JSON.stringify(txItems.filter(item => item.id !== itemId))
  );

  return { success: true };
}
