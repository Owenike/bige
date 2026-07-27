"use client";

import {
  ArrowLeft,
  Copy,
  KeyRound,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UserRoundX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRole } from "../../../lib/auth-context";
import {
  DEPARTMENT_POSITIONS,
  STAFF_DEPARTMENTS,
  STAFF_POSITIONS,
  canCreatePosition,
  canManagePosition,
  departmentLabel,
  positionLabel,
  type StaffDepartment,
  type StaffPosition,
} from "../../../lib/staff-organization";
import styles from "./page.module.css";

type StaffItem = {
  id: string;
  role: string;
  department: StaffDepartment | null;
  position: StaffPosition | null;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  english_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  staff_deleted_at: string | null;
  staff_deleted_by: string | null;
  staff_delete_reason: string | null;
  email: string | null;
  staff_activation_status: "pending_identity" | "identity_confirmed" | "denied" | "locked" | "completed";
};

type BranchItem = {
  id: string;
  name: string;
  is_active: boolean;
};

type MePayload = {
  userId?: string;
  role?: string;
  department?: StaffDepartment | null;
  position?: StaffPosition | null;
  tenantId?: string | null;
  branchId?: string | null;
};

type Reauth = {
  account: string;
  password: string;
  reason: string;
};

type ApiErrorBody = {
  error?: { message?: string } | string;
  message?: string;
  item?: StaffItem;
  activation?: {
    code?: string | null;
    expiresAt?: string;
    shownOnce?: boolean;
  };
  employeeNumber?: string | null;
  displayName?: string | null;
};

type ActivationReveal = {
  employeeNumber: string;
  displayName: string;
  code: string;
  expiresAt: string;
};

const EMPTY_REAUTH: Reauth = { account: "", password: "", reason: "" };

function readError(payload: ApiErrorBody | null, fallback: string) {
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.error && typeof payload.error === "object" && payload.error.message) {
    return payload.error.message;
  }
  return payload?.message || fallback;
}

function formatDate(value: string | null) {
  if (!value) return "尚未登入";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function activationLabel(status: StaffItem["staff_activation_status"]) {
  if (status === "pending_identity") return "待本人啟用";
  if (status === "identity_confirmed") return "本人已確認，待完成設定";
  if (status === "denied") return "本人否認，待主管處理";
  if (status === "locked") return "啟用碼已鎖定";
  return "啟用完成";
}

export default function ManagerStaffPage() {
  const [me, setMe] = useState<MePayload>({});
  const [items, setItems] = useState<StaffItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationReveal, setActivationReveal] = useState<ActivationReveal | null>(null);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"all" | StaffDepartment>("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const [newName, setNewName] = useState("");
  const [newEnglishName, setNewEnglishName] = useState("");
  const [newDepartment, setNewDepartment] = useState<StaffDepartment>("general_affairs");
  const [newPosition, setNewPosition] = useState<StaffPosition>("frontdesk");
  const [newBranchId, setNewBranchId] = useState("");

  const [editing, setEditing] = useState<StaffItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editEnglishName, setEditEnglishName] = useState("");
  const [editDepartment, setEditDepartment] = useState<StaffDepartment>("general_affairs");
  const [editPosition, setEditPosition] = useState<StaffPosition>("frontdesk");
  const [editBranchId, setEditBranchId] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<StaffItem | null>(null);

  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthTitle, setReauthTitle] = useState("");
  const [reauth, setReauth] = useState<Reauth>(EMPTY_REAUTH);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<((credentials: Reauth) => Promise<void>) | null>(
    null,
  );

  const actor = useMemo(
    () => ({
      role: (me.role || "customer") as AppRole,
      department: me.department || null,
      position: me.position || null,
      branchId: me.branchId || null,
    }),
    [me],
  );

  const assignablePositions = useMemo(
    () =>
      STAFF_POSITIONS.filter(
        (position) => me.role === "platform_admin" || canCreatePosition(actor, position),
      ),
    [actor, me.role],
  );
  const canCreate = assignablePositions.length > 0;
  const createPositions = DEPARTMENT_POSITIONS[newDepartment].filter((position) =>
    assignablePositions.includes(position),
  );
  const editPositions = DEPARTMENT_POSITIONS[editDepartment].filter(
    (position) => me.role === "platform_admin" || assignablePositions.includes(position),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const mePayload = (await meResponse.json().catch(() => null)) as MePayload | null;
      if (!meResponse.ok || !mePayload) throw new Error("無法確認登入身分");
      setMe(mePayload);

      const tenantParams = new URLSearchParams();
      if (mePayload.role === "platform_admin" && mePayload.tenantId) {
        tenantParams.set("tenantId", mePayload.tenantId);
      }
      const staffParams = new URLSearchParams(tenantParams);
      if (query.trim()) staffParams.set("q", query.trim());
      if (showDeleted) {
        staffParams.set("deletedOnly", "1");
      } else if (activeOnly) {
        staffParams.set("activeOnly", "1");
      }

      const branchParams = new URLSearchParams(tenantParams);
      branchParams.set("activeOnly", "1");
      const [staffResponse, branchResponse] = await Promise.all([
        fetch(`/api/manager/staff?${staffParams.toString()}`, { cache: "no-store" }),
        fetch(`/api/manager/branches?${branchParams.toString()}`, { cache: "no-store" }),
      ]);
      const staffPayload = (await staffResponse.json().catch(() => null)) as
        | ({ items?: StaffItem[] } & ApiErrorBody)
        | null;
      const branchPayload = (await branchResponse.json().catch(() => null)) as
        | ({ items?: BranchItem[] } & ApiErrorBody)
        | null;
      if (!staffResponse.ok) throw new Error(readError(staffPayload, "讀取員工清單失敗"));
      setItems(staffPayload?.items || []);
      setBranches(branchResponse.ok ? branchPayload?.items || [] : []);
    } catch (caught) {
      setItems([]);
      setError(caught instanceof Error ? caught.message : "讀取員工資料失敗");
    } finally {
      setLoading(false);
    }
  }, [activeOnly, query, showDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!me.department || me.role === "platform_admin") return;
    setNewDepartment(me.department);
    const first = assignablePositions.find((position) =>
      DEPARTMENT_POSITIONS[me.department!].includes(position),
    );
    if (first) setNewPosition(first);
  }, [assignablePositions, me.department, me.role]);

  useEffect(() => {
    if (!createPositions.includes(newPosition) && createPositions[0]) {
      setNewPosition(createPositions[0]);
    }
  }, [createPositions, newPosition]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) => departmentFilter === "all" || item.department === departmentFilter,
      ),
    [departmentFilter, items],
  );
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) => item.is_active).length,
      generalAffairs: items.filter((item) => item.department === "general_affairs").length,
      coaching: items.filter((item) => item.department === "coaching").length,
    }),
    [items],
  );

  function scopedPath(path: string) {
    if (me.role !== "platform_admin" || !me.tenantId) return path;
    return `${path}?tenantId=${encodeURIComponent(me.tenantId)}`;
  }

  function requestSensitive(title: string, action: (credentials: Reauth) => Promise<void>) {
    setReauthTitle(title);
    setReauth(EMPTY_REAUTH);
    setReauthError(null);
    setPendingAction(() => action);
    setReauthOpen(true);
  }

  async function confirmSensitive() {
    if (!pendingAction || !reauth.account || !reauth.password || !reauth.reason.trim()) {
      setReauthError("請輸入員工編號、密碼與操作原因");
      return;
    }
    setSaving(true);
    setError(null);
    setReauthError(null);
    try {
      await pendingAction(reauth);
      setReauthOpen(false);
      setPendingAction(null);
    } catch (caught) {
      setReauthError(caught instanceof Error ? caught.message : "操作失敗");
    } finally {
      setSaving(false);
    }
  }

  function createStaff() {
    if (!canCreate || !newName.trim() || !newEnglishName.trim()) {
      setError("請填寫真實姓名與英文姓名");
      return;
    }
    requestSensitive("確認建立員工帳號", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newName,
          englishName: newEnglishName,
          department: newDepartment,
          position: newPosition,
          branchId: newBranchId || null,
          tenantId: me.role === "platform_admin" ? me.tenantId : undefined,
          idempotencyKey: `staff:${crypto.randomUUID()}`,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "建立員工失敗"));
      setNewName("");
      setNewEnglishName("");
      setNewBranchId("");
      const employeeNumber = payload?.item?.employee_number || "";
      const activationCode = payload?.activation?.code || "";
      if (employeeNumber && activationCode && payload?.activation?.expiresAt) {
        setActivationReveal({
          employeeNumber,
          displayName: payload.item?.display_name || newName,
          code: activationCode,
          expiresAt: payload.activation.expiresAt,
        });
      } else {
        setNotice(
          employeeNumber
            ? `員工帳號已建立，員工編號為 ${employeeNumber}。若未顯示啟用碼，請重新產生。`
            : "員工帳號已建立",
        );
      }
      await load();
    });
  }

  function regenerateActivationCode(item: StaffItem) {
    requestSensitive("確認重新產生一次性啟用碼", async (credentials) => {
      const response = await fetch("/api/manager/staff/activation-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          tenantId: me.role === "platform_admin" ? me.tenantId : undefined,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "重新產生啟用碼失敗"));
      const activationCode = payload?.activation?.code || "";
      const expiresAt = payload?.activation?.expiresAt || "";
      if (!activationCode || !expiresAt) {
        throw new Error("系統未回傳新的啟用碼，請再試一次");
      }
      setActivationReveal({
        employeeNumber: payload?.employeeNumber || item.employee_number || "",
        displayName: payload?.displayName || item.display_name || "",
        code: activationCode,
        expiresAt,
      });
      await load();
    });
  }

  function openEditor(item: StaffItem) {
    const department = item.department || "general_affairs";
    const position = item.position || DEPARTMENT_POSITIONS[department][0];
    setEditing(item);
    setEditName(item.display_name || "");
    setEditEnglishName(item.english_name || "");
    setEditDepartment(department);
    setEditPosition(position);
    setEditBranchId(item.branch_id || "");
    setEditActive(item.is_active);
  }

  function saveEditor() {
    if (!editing || !editName.trim() || !editEnglishName.trim()) {
      setError("請填寫真實姓名與英文姓名");
      return;
    }
    requestSensitive("確認儲存員工資料", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          displayName: editName,
          englishName: editEnglishName,
          department: editDepartment,
          position: editPosition,
          branchId: editBranchId || null,
          isActive: editActive,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "儲存員工資料失敗"));
      setEditing(null);
      setNotice("員工資料已更新");
      await load();
    });
  }

  function toggleStaff(item: StaffItem) {
    requestSensitive(item.is_active ? "確認停用員工帳號" : "確認啟用員工帳號", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, isActive: !item.is_active, reauth: credentials }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "更新帳號狀態失敗"));
      setNotice(item.is_active ? "員工帳號已停用" : "員工帳號已啟用");
      await load();
    });
  }

  function resetPassword(item: StaffItem) {
    requestSensitive("確認寄送密碼重設信", async (credentials) => {
      const response = await fetch("/api/manager/staff/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          tenantId: me.role === "platform_admin" ? me.tenantId : undefined,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "寄送密碼重設信失敗"));
      setNotice("密碼重設信已寄出");
    });
  }

  function deleteStaff(item: StaffItem) {
    setDeleteConfirm(null);
    requestSensitive("確認刪除員工", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "刪除員工失敗"));
      if (editing?.id === item.id) setEditing(null);
      setNotice(`已將員工「${item.display_name || item.email || "未命名員工"}」移至已刪除清單`);
      await load();
    });
  }

  function restoreStaff(item: StaffItem) {
    requestSensitive("確認復原員工", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          restore: true,
          reauth: credentials,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      if (!response.ok) throw new Error(readError(payload, "復原員工失敗"));
      setNotice(`已復原員工「${item.display_name || item.email || "未命名員工"}」`);
      await load();
    });
  }

  async function switchUser() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login/staff";
  }

  function manageable(item: StaffItem) {
    return (
      me.role === "platform_admin" ||
      canManagePosition(actor, item.department, item.position)
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E FITNESS · STAFF</p>
            <h1 className={styles.title}>員工與權限</h1>
            <p className={styles.subtitle}>依庶務部與教練部管理職務、分店範圍與帳號狀態。</p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.button} type="button" onClick={() => void switchUser()}>
              <LogIn size={17} />
              切換使用者
            </button>
            <a className={styles.iconButton} href="/manager/fitness" title="返回營運後台">
              <ArrowLeft size={19} />
            </a>
          </div>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <section className={styles.stats}>
          {[
            ["員工總數", stats.total],
            ["啟用帳號", stats.active],
            ["庶務部", stats.generalAffairs],
            ["教練部", stats.coaching],
          ].map(([label, value]) => (
            <article className={`${styles.glassCard} ${styles.stat}`} key={label}>
              <span className={styles.statLabel}>{label}</span>
              <strong className={styles.statValue}>{value}</strong>
            </article>
          ))}
        </section>

        <section className={`${styles.glassCard} ${styles.filters}`}>
          <div className={styles.field}>
            <label className={styles.label}>部門</label>
            <select
              className={styles.select}
              value={departmentFilter}
              onChange={(event) =>
                setDepartmentFilter(event.target.value as "all" | StaffDepartment)
              }
            >
              <option value="all">全部部門</option>
              {STAFF_DEPARTMENTS.map((department) => (
                <option value={department} key={department}>
                  {departmentLabel(department)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>搜尋員工</label>
            <input
              className={styles.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void load()}
              placeholder="真實姓名、英文姓名、員工編號或 Email"
            />
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={activeOnly}
              disabled={showDeleted}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            只顯示啟用帳號
          </label>
          {me.role === "platform_admin" ? (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) => {
                  setShowDeleted(event.target.checked);
                  if (event.target.checked) setActiveOnly(false);
                }}
              />
              查看已刪除員工
            </label>
          ) : null}
          <button className={styles.button} type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} />
            {loading ? "讀取中" : "更新清單"}
          </button>
        </section>

        {canCreate && !showDeleted ? (
          <section className={`${styles.glassCard} ${styles.panel}`}>
            <h2 className={styles.panelTitle}>建立員工帳號</h2>
            <p className={styles.panelHint}>
              系統會自動產生員工編號與一次性啟用碼。啟用碼只顯示一次、24 小時內有效；員工確認本人後，必須自行驗證 Email 並設定正式密碼。
            </p>
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.label}>真實姓名</span>
                <input className={styles.input} value={newName} onChange={(event) => setNewName(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>英文姓名</span>
                <input
                  className={styles.input}
                  value={newEnglishName}
                  onChange={(event) => setNewEnglishName(event.target.value)}
                  autoCapitalize="words"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>部門</span>
                <select
                  className={styles.select}
                  value={newDepartment}
                  onChange={(event) => setNewDepartment(event.target.value as StaffDepartment)}
                  disabled={me.role !== "platform_admin"}
                >
                  {STAFF_DEPARTMENTS.map((department) => (
                    <option value={department} key={department}>{departmentLabel(department)}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>職務</span>
                <select className={styles.select} value={newPosition} onChange={(event) => setNewPosition(event.target.value as StaffPosition)}>
                  {createPositions.map((position) => (
                    <option value={position} key={position}>{positionLabel(position)}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>分店</span>
                <select className={styles.select} value={newBranchId} onChange={(event) => setNewBranchId(event.target.value)}>
                  <option value="">不指定分店</option>
                  {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <div className={styles.formActions}>
                <button className={`${styles.button} ${styles.primary}`} type="button" onClick={createStaff}>
                  <Plus size={17} />
                  建立員工
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className={`${styles.glassCard} ${styles.listPanel}`}>
          <div className={styles.listHeader}>
            <div>
              <h2 className={styles.panelTitle}>{showDeleted ? "已刪除員工" : "員工清單"}</h2>
              <span className={styles.count}>共 {visibleItems.length} 筆</span>
            </div>
            <ShieldCheck size={22} />
          </div>
          <div className={styles.staffList}>
            {visibleItems.map((item) => (
              <article className={styles.staffRow} key={item.id}>
                <div className={styles.staffIdentity}>
                  <span className={styles.staffName}>{item.display_name || "未命名員工"}</span>
                  <span className={styles.staffEmail}>{item.english_name || "尚未填寫英文姓名"}</span>
                  <span className={styles.staffEmail}>員工編號：{item.employee_number || "尚未建立"}</span>
                  <span className={styles.staffEmail}>{item.email || "尚未由員工設定 Email"}</span>
                  <span className={styles.staffEmail}>首次啟用：{activationLabel(item.staff_activation_status)}</span>
                </div>
                <span className={styles.role}>
                  {departmentLabel(item.department)} · {positionLabel(item.position)}
                </span>
                <div>
                  <span className={styles.meta}>分店：{item.branch_id ? branchNames.get(item.branch_id) || "未知分店" : "未指定"}</span>
                  {item.staff_deleted_at ? (
                    <>
                      <span className={styles.meta}>刪除時間：{formatDate(item.staff_deleted_at)}</span>
                      <span className={styles.meta}>刪除原因：{item.staff_delete_reason || "未填寫"}</span>
                    </>
                  ) : (
                    <span className={styles.meta}>上次登入：{formatDate(item.last_login_at)}</span>
                  )}
                </div>
                <span className={`${styles.status} ${item.is_active && !item.staff_deleted_at ? "" : styles.inactive}`}>
                  {item.staff_deleted_at ? "已刪除" : item.is_active ? "啟用" : "停用"}
                </span>
                <div className={styles.rowActions}>
                  {item.staff_deleted_at ? (
                    <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => restoreStaff(item)}>
                      <RotateCcw size={16} />
                      復原
                    </button>
                  ) : (
                    <>
                      <button className={styles.button} type="button" onClick={() => openEditor(item)} disabled={!manageable(item)}>
                        <Pencil size={16} />
                        編輯
                      </button>
                      <button className={`${styles.iconButton} ${item.is_active ? styles.danger : ""}`} type="button" onClick={() => toggleStaff(item)} disabled={!manageable(item)} title={item.is_active ? "停用帳號" : "啟用帳號"}>
                        {item.is_active ? <UserRoundX size={17} /> : <UserRoundCheck size={17} />}
                      </button>
                      <button
                        className={styles.iconButton}
                        type="button"
                        onClick={() =>
                          item.staff_activation_status === "completed"
                            ? resetPassword(item)
                            : regenerateActivationCode(item)
                        }
                        disabled={!manageable(item)}
                        title={
                          item.staff_activation_status === "completed"
                            ? "寄送密碼重設信"
                            : "重新產生一次性啟用碼"
                        }
                      >
                        <KeyRound size={17} />
                      </button>
                      {me.role === "platform_admin" && me.userId !== item.id ? (
                        <button
                          className={`${styles.iconButton} ${styles.danger}`}
                          type="button"
                          onClick={() => setDeleteConfirm(item)}
                          title="刪除員工"
                          aria-label={`刪除 ${item.display_name || item.email || "員工"}`}
                        >
                          <Trash2 size={17} />
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
            {!loading && visibleItems.length === 0 ? <p className={styles.empty}>目前沒有符合條件的員工</p> : null}
          </div>
        </section>

        {activationReveal ? (
          <div className={styles.modalBackdrop}>
            <section
              className={`${styles.glassCard} ${styles.modal}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="activation-code-title"
            >
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>只顯示這一次</p>
                  <h2 className={styles.panelTitle} id="activation-code-title">員工一次性啟用資料</h2>
                </div>
                <button className={styles.iconButton} type="button" onClick={() => setActivationReveal(null)} title="關閉">
                  <X size={18} />
                </button>
              </div>
              <div className={styles.modalIdentity}>
                <strong>{activationReveal.displayName || "新進員工"}</strong>
                <span>員工編號：{activationReveal.employeeNumber}</span>
              </div>
              <div className={styles.activationCode}>
                <span>一次性啟用碼</span>
                <strong>{activationReveal.code}</strong>
                <button
                  className={styles.iconButton}
                  type="button"
                  title="複製啟用資料"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      `員工編號：${activationReveal.employeeNumber}\n一次性啟用碼：${activationReveal.code}`,
                    );
                    setNotice("員工編號與一次性啟用碼已複製");
                  }}
                >
                  <Copy size={18} />
                </button>
              </div>
              <p className={styles.panelHint}>
                有效期限：{formatDate(activationReveal.expiresAt)}。關閉後無法再次查看原碼；需要時只能重新產生，新碼產生後舊碼立即失效。
              </p>
              <div className={styles.formActions}>
                <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => setActivationReveal(null)}>
                  我已妥善交付
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {deleteConfirm ? (
          <div className={styles.modalBackdrop} onMouseDown={() => setDeleteConfirm(null)}>
            <section
              className={`${styles.glassCard} ${styles.modal}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-staff-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>刪除員工</p>
                  <h2 className={styles.panelTitle} id="delete-staff-title">確認刪除這個員工帳號？</h2>
                </div>
                <button className={styles.iconButton} type="button" onClick={() => setDeleteConfirm(null)} title="關閉">
                  <X size={18} />
                </button>
              </div>
              <div className={styles.modalIdentity}>
                <strong>{deleteConfirm.display_name || "未命名員工"}</strong>
                <span>{deleteConfirm.english_name || "尚未填寫英文姓名"}</span>
              </div>
              <p className={styles.notice}>
                刪除後會立即停用帳號並移到「已刪除員工」，所有排課、學員及歷史紀錄都會保留，之後可以復原。
              </p>
              <div className={styles.formActions}>
                <button className={styles.button} type="button" onClick={() => setDeleteConfirm(null)}>取消</button>
                <button className={`${styles.button} ${styles.danger}`} type="button" onClick={() => deleteStaff(deleteConfirm)}>
                  <Trash2 size={17} />
                  驗證並移至已刪除
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {editing ? (
          <div className={styles.modalBackdrop} onMouseDown={() => setEditing(null)}>
            <section className={`${styles.glassCard} ${styles.modal}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>BIG E FITNESS · STAFF</p>
                  <h2 className={styles.panelTitle}>編輯員工資料</h2>
                </div>
                <button className={styles.iconButton} type="button" onClick={() => setEditing(null)} title="關閉"><X size={18} /></button>
              </div>
              <div className={styles.modalIdentity}>
                <strong>{editing.display_name || editing.email || "未命名員工"}</strong>
                <span>{editing.employee_number} · {editing.email || "尚未由員工設定 Email"}</span>
              </div>
              <div className={styles.form}>
                <label className={styles.field}>
                  <span className={styles.label}>真實姓名</span>
                  <input className={styles.input} value={editName} onChange={(event) => setEditName(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>英文姓名</span>
                  <input
                    className={styles.input}
                    value={editEnglishName}
                    onChange={(event) => setEditEnglishName(event.target.value)}
                    autoCapitalize="words"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>部門</span>
                  <select className={styles.select} value={editDepartment} onChange={(event) => {
                    const next = event.target.value as StaffDepartment;
                    setEditDepartment(next);
                    const first = DEPARTMENT_POSITIONS[next].find((position) => me.role === "platform_admin" || assignablePositions.includes(position));
                    if (first) setEditPosition(first);
                  }} disabled={me.role !== "platform_admin"}>
                    {STAFF_DEPARTMENTS.map((department) => <option value={department} key={department}>{departmentLabel(department)}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>職務</span>
                  <select className={styles.select} value={editPosition} onChange={(event) => setEditPosition(event.target.value as StaffPosition)}>
                    {editPositions.map((position) => <option value={position} key={position}>{positionLabel(position)}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>分店</span>
                  <select className={styles.select} value={editBranchId} onChange={(event) => setEditBranchId(event.target.value)}>
                    <option value="">不指定分店</option>
                    {branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} />
                  帳號啟用
                </label>
                <div className={styles.formActions}>
                  <button className={styles.button} type="button" onClick={() => setEditing(null)}>取消</button>
                  <button className={`${styles.button} ${styles.primary}`} type="button" onClick={saveEditor}>
                    <Save size={17} />
                    儲存變更
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {reauthOpen ? (
          <div className={styles.modalBackdrop} onMouseDown={() => !saving && setReauthOpen(false)}>
            <section className={`${styles.glassCard} ${styles.modal}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>敏感操作身分確認</p>
                  <h2 className={styles.panelTitle}>{reauthTitle}</h2>
                </div>
                <button className={styles.iconButton} type="button" onClick={() => setReauthOpen(false)} disabled={saving} title="關閉"><X size={18} /></button>
              </div>
              <p className={styles.panelHint}>請由實際執行此操作的人輸入自己的員工編號與密碼。</p>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmSensitive();
                }}
              >
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>員工編號</span>
                  <input className={styles.input} type="text" autoComplete="username" autoCapitalize="characters" required autoFocus value={reauth.account} onChange={(event) => setReauth({ ...reauth, account: event.target.value.toUpperCase() })} placeholder="E000001" />
                </label>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>密碼</span>
                  <input className={styles.input} type="password" autoComplete="current-password" required value={reauth.password} onChange={(event) => setReauth({ ...reauth, password: event.target.value })} />
                </label>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>操作原因</span>
                  <input className={styles.input} required value={reauth.reason} onChange={(event) => setReauth({ ...reauth, reason: event.target.value })} placeholder="例如：新進員工建檔" />
                </label>
                {reauthError ? (
                  <p className={`${styles.error} ${styles.full}`} role="alert" aria-live="assertive">
                    {reauthError}
                  </p>
                ) : null}
                <div className={styles.formActions}>
                  <button className={styles.button} type="button" onClick={() => setReauthOpen(false)} disabled={saving}>取消</button>
                  <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={saving}>
                    <ShieldCheck size={17} />
                    {saving ? "驗證中" : "驗證並執行"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
