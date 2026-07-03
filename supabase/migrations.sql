-- 庫存異動與資產生命週期管理平台 - 資料庫 Schema 與 Trigger 初始化 (一對多版本)
-- 專案註解一律使用繁體中文

-- 1. 建立角色與狀態的 ENUM 類型
CREATE TYPE user_role AS ENUM ('Admin', 'Editor', 'Viewer');
CREATE TYPE tx_type_enum AS ENUM ('領料', '轉撥', '內部轉調', '退料', '報廢', '製令', '請購', '銷售', '轉撥退回');
CREATE TYPE direction_enum AS ENUM ('進庫', '出庫');
CREATE TYPE reconciliation_status_enum AS ENUM ('已結案', '明細待補');
CREATE TYPE asset_status_enum AS ENUM ('外借/掛帳中', '內部轉調', '結案/在庫');

-- 2. 建立 profiles 表格 (同仁資料/權限表)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'Viewer',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 建立 transactions 表格 (庫存異動單據主表)
-- 只保留單據屬性與掛帳同仁資訊，不含物料明細與對帳狀態
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_no TEXT UNIQUE NOT NULL,          -- 系統申請單號 (使用者輸入，不得重複)
    tx_type tx_type_enum NOT NULL,
    direction direction_enum NOT NULL,
    custom_owner TEXT NOT NULL,          -- 掛帳同仁姓名 (所有異動別均強制必填)
    current_dept TEXT NOT NULL,          -- 掛帳單位 (所有異動別均強制必填)
    source_dept TEXT,                    -- 轉出單位 (僅轉撥、內部轉調適用)
    reason TEXT NOT NULL,                -- 需求原因/備註 (所有異動別均強制必填)
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. 建立 transaction_items 表格 (單據物料明細表)
-- 實際出庫日期與存貨調整單號改為在明細表中，對帳看板以明細列為單位進行修補
CREATE TABLE transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    part_no TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    warehouse_id TEXT NOT NULL,
    actual_date DATE,                    -- 允許為空 (Nullable)，修補明細時填入
    adjust_no TEXT,                      -- 存貨調整單號，允許為空，修補明細時填入
    pending_pids TEXT[],                 -- 尚未結案前暫存的 PID / N/A
    reconciliation_status reconciliation_status_enum NOT NULL DEFAULT '明細待補',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. 建立 asset_pids 表格 (出入庫掛帳明細表 - 管「物」)
-- current_item_id: 關聯單據明細表 transaction_items
CREATE TABLE asset_pids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pid TEXT NOT NULL,
    current_item_id UUID REFERENCES transaction_items(id) ON DELETE SET NULL,
    current_status asset_status_enum NOT NULL DEFAULT '結案/在庫',
    current_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    custom_owner TEXT,
    current_dept TEXT,
    current_warehouse TEXT,
    history_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 建立 Partial Unique Index：非 'N/A' 的 PID 在系統中必須唯一，但允許重複填寫 'N/A'
CREATE UNIQUE INDEX asset_pids_pid_unique_idx ON asset_pids (pid) WHERE pid <> 'N/A';

-- 6. 建立 login_logs 表格 (登入軌跡紀錄表)
CREATE TABLE login_logs (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. 雙向勾稽防呆函式
-- 當 asset_pids 有 PID 被關聯至某單據明細時，自動計算並更新該明細的勾稽狀態
CREATE OR REPLACE FUNCTION check_item_reconciliation(item_id UUID)
RETURNS VOID AS $$
DECLARE
  v_qty INTEGER;
  v_pid_cnt INTEGER;
  v_new_status reconciliation_status_enum;
  v_actual_date DATE;
  v_adjust_no TEXT;
BEGIN
  SELECT quantity, actual_date, adjust_no INTO v_qty, v_actual_date, v_adjust_no
  FROM transaction_items WHERE id = item_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_pid_cnt FROM asset_pids WHERE current_item_id = item_id;

  -- 需同時滿足：PID 數量相符、已填入實際日期、已填入調整單號
  IF v_pid_cnt = v_qty AND v_actual_date IS NOT NULL AND v_adjust_no IS NOT NULL AND v_adjust_no <> '' THEN
    v_new_status := '已結案';
  ELSE
    v_new_status := '明細待補';
  END IF;

  UPDATE transaction_items SET reconciliation_status = v_new_status, updated_at = now() WHERE id = item_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_asset_pids_reconciliation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.current_item_id IS NOT NULL THEN
      PERFORM check_item_reconciliation(NEW.current_item_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.current_item_id IS NOT NULL AND OLD.current_item_id IS DISTINCT FROM NEW.current_item_id THEN
      PERFORM check_item_reconciliation(OLD.current_item_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.current_item_id IS NOT NULL THEN
      PERFORM check_item_reconciliation(OLD.current_item_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_item_reconciliation
AFTER INSERT OR UPDATE OR DELETE ON asset_pids
FOR EACH ROW EXECUTE FUNCTION trigger_asset_pids_reconciliation();

CREATE OR REPLACE FUNCTION trigger_items_reconciliation()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM check_item_reconciliation(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_item_reconciliation
AFTER UPDATE OF actual_date, adjust_no, quantity ON transaction_items
FOR EACH ROW EXECUTE FUNCTION trigger_items_reconciliation();

-- 8. PID 資產狀態機自動切換與履歷自動記錄 (根據 tx_type 切換 current_status)
CREATE OR REPLACE FUNCTION trigger_asset_state_machine()
RETURNS TRIGGER AS $$
DECLARE
  item_record RECORD;
  tx_record RECORD;
  v_new_status asset_status_enum;
  log_entry JSONB;
BEGIN
  IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.current_item_id IS DISTINCT FROM NEW.current_item_id))
    AND NEW.current_item_id IS NOT NULL THEN

    -- 先查明細表
    SELECT transaction_id, actual_date, adjust_no, warehouse_id, part_no INTO item_record 
    FROM transaction_items WHERE id = NEW.current_item_id;

    IF FOUND THEN
      -- 再查主表
      SELECT tx_no, tx_type, reason, custom_owner, current_dept
      INTO tx_record FROM transactions WHERE id = item_record.transaction_id;

      IF FOUND THEN
        -- 根據異動別切換資產狀態
        IF tx_record.tx_type IN ('轉撥', '領料', '製令') THEN
          v_new_status := '外借/掛帳中';
          NEW.current_status := v_new_status;
          NEW.custom_owner := COALESCE(NEW.custom_owner, tx_record.custom_owner);
          NEW.current_dept := COALESCE(NEW.current_dept, tx_record.current_dept);
        ELSIF tx_record.tx_type = '內部轉調' THEN
          v_new_status := '內部轉調';
          NEW.current_status := v_new_status;
          NEW.custom_owner := COALESCE(NEW.custom_owner, tx_record.custom_owner);
          NEW.current_dept := COALESCE(NEW.current_dept, tx_record.current_dept);
        ELSIF tx_record.tx_type IN ('退料', '報廢', '請購', '銷售', '轉撥退回') THEN
          v_new_status := '結案/在庫';
          NEW.current_status := v_new_status;
          NEW.custom_owner := NULL;
          NEW.current_dept := NULL;
        END IF;

        -- 建立歷史履歷條目
        log_entry := jsonb_build_object(
          'tx_no', tx_record.tx_no,
          'adjust_no', COALESCE(item_record.adjust_no, ''),
          'date', COALESCE(to_char(item_record.actual_date, 'YYYY-MM-DD'), ''),
          'action', tx_record.tx_type::text,
          'owner', COALESCE(NEW.custom_owner, tx_record.custom_owner, ''),
          'dept', COALESCE(NEW.current_dept, tx_record.current_dept, ''),
          'notes', COALESCE(NEW.notes, tx_record.reason, '')
        );

        IF NEW.history_logs IS NULL OR jsonb_typeof(NEW.history_logs) <> 'array' THEN
          NEW.history_logs := jsonb_build_array(log_entry);
        ELSE
          NEW.history_logs := NEW.history_logs || log_entry;
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_asset_status_and_history
BEFORE INSERT OR UPDATE OF current_item_id ON asset_pids
FOR EACH ROW EXECUTE FUNCTION trigger_asset_state_machine();

-- 9. 啟用 Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_pids ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;

-- 10. RLS 安全原則
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles 規則
CREATE POLICY "允許所有人讀取同仁資料" ON profiles FOR SELECT USING (true);
CREATE POLICY "僅限 Admin 編輯同仁資料" ON profiles FOR ALL USING (get_my_role() = 'Admin');

-- Transactions 規則
CREATE POLICY "允許所有人讀取單據" ON transactions FOR SELECT USING (true);
CREATE POLICY "允許 Admin 與 Editor 新增單據" ON transactions FOR INSERT WITH CHECK (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "允許 Admin 與 Editor 修改單據" ON transactions FOR UPDATE USING (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "僅限 Admin 刪除單據" ON transactions FOR DELETE USING (get_my_role() = 'Admin');

-- Transaction Items 規則
CREATE POLICY "允許所有人讀取明細" ON transaction_items FOR SELECT USING (true);
CREATE POLICY "允許 Admin 與 Editor 新增明細" ON transaction_items FOR INSERT WITH CHECK (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "允許 Admin 與 Editor 修改明細" ON transaction_items FOR UPDATE USING (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "僅限 Admin 刪除明細" ON transaction_items FOR DELETE USING (get_my_role() = 'Admin');

-- Asset PIDs 規則
CREATE POLICY "允許所有人讀取資產 PID" ON asset_pids FOR SELECT USING (true);
CREATE POLICY "允許 Admin 與 Editor 新增資產 PID" ON asset_pids FOR INSERT WITH CHECK (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "允許 Admin 與 Editor 修改資產 PID" ON asset_pids FOR UPDATE USING (get_my_role() IN ('Admin', 'Editor'));
CREATE POLICY "僅限 Admin 刪除資產 PID" ON asset_pids FOR DELETE USING (get_my_role() = 'Admin');

-- Login Logs 規則
CREATE POLICY "僅限 Admin 讀取登入紀錄" ON login_logs FOR SELECT USING (get_my_role() = 'Admin');
CREATE POLICY "允許系統寫入登入紀錄" ON login_logs FOR INSERT WITH CHECK (true);
