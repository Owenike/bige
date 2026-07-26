"use client";

import {
  ArrowLeft,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
  UserRoundX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";
import styles from "./page.module.css";

type StaffRole = "manager" | "supervisor" | "branch_manager" | "frontdesk" | "coach" | "sales";

interface BranchItem {
  id: string;
  name: string;
  is_active: boolean;
}

interface StaffItem {
  id: string;
  role: StaffRole;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  email: string | null;
}

interface MePayload {
  role?: string;
  tenantId?: string | null;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
  message?: string;
}

const ALL_STAFF_ROLES: StaffRole[] = [
  "manager",
  "supervisor",
  "branch_manager",
  "frontdesk",
  "coach",
  "sales",
];
const MANAGER_ASSIGNABLE_ROLES: StaffRole[] = ["frontdesk", "coach"];

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiErrorBody;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
    return body.error.message || fallback;
  }
  return typeof body.message === "string" && body.message ? body.message : fallback;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "尚未登入";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-TW", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleLabel(role: StaffRole, zh: boolean) {
  const labels: Record<StaffRole, [string, string]> = {
    manager: ["主管", "Manager"],
    supervisor: ["營運主管", "Supervisor"],
    branch_manager: ["分店主管", "Branch manager"],
    frontdesk: ["櫃台", "Frontdesk"],
    coach: ["教練", "Coach"],
    sales: ["業務", "Sales"],
  };
  return labels[role][zh ? 0 : 1];
}

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function ManagerStaffPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [items, setItems] = useState<StaffItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const [roleFilter, setRoleFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const [selectedId, setSelectedId] = useState("");
  const [editRole, setEditRole] = useState<StaffRole>("frontdesk");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editBranchId, setEditBranchId] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("frontdesk");
  const [newBranchId, setNewBranchId] = useState("");
  const [newActive, setNewActive] = useState(true);

  const canCreate = myRole === "manager" || myRole === "platform_admin";
  const canEdit = myRole === "manager" || myRole === "platform_admin";
  const canDisable = myRole === "manager" || myRole === "platform_admin";
  const createRoleOptions = myRole === "platform_admin" ? ALL_STAFF_ROLES : MANAGER_ASSIGNABLE_ROLES;
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );
  const canManageSelected =
    !!selectedItem &&
    (myRole === "platform_admin" ||
      (myRole === "manager" && MANAGER_ASSIGNABLE_ROLES.includes(selectedItem.role)));

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((item) => item.is_active).length;
    const coach = items.filter((item) => item.role === "coach").length;
    const frontdesk = items.filter((item) => item.role === "frontdesk").length;
    return { total, active, inactive: total - active, coach, frontdesk };
  }, [items]);

  function scopedUrl(path: string, params?: URLSearchParams) {
    const next = params || new URLSearchParams();
    if (myRole === "platform_admin" && tenantId) next.set("tenantId", tenantId);
    const suffix = next.toString();
    return suffix ? `${path}?${suffix}` : path;
  }

  function bindEditor(item: StaffItem) {
    setSelectedId(item.id);
    setEditRole(item.role);
    setEditDisplayName(item.display_name || "");
    setEditBranchId(item.branch_id || "");
    setEditActive(item.is_active);
  }

  function openEditor(item: StaffItem) {
    bindEditor(item);
    setEditorOpen(true);
  }

  function patchLocal(item: StaffItem) {
    setItems((current) => current.map((row) => (row.id === item.id ? item : row)));
  }

  async function loadMeta() {
    const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
    const mePayload = (await safeJson<MePayload>(meResponse)) || {};
    const nextRole = typeof mePayload.role === "string" ? mePayload.role : null;
    const nextTenantId = typeof mePayload.tenantId === "string" ? mePayload.tenantId : null;
    if (meResponse.ok) {
      setMyRole(nextRole);
      setTenantId(nextTenantId);
    }

    const branchParams = new URLSearchParams({ activeOnly: "1" });
    if (nextRole === "platform_admin" && nextTenantId) branchParams.set("tenantId", nextTenantId);
    const branchResponse = await fetch(`/api/manager/branches?${branchParams.toString()}`, {
      cache: "no-store",
    });
    const branchPayload =
      (await safeJson<{ items?: BranchItem[] } & ApiErrorBody>(branchResponse)) || {};
    setBranches(branchResponse.ok ? branchPayload.items || [] : []);
  }

  async function loadStaff(role = myRole, scopeTenantId = tenantId) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (query.trim()) params.set("q", query.trim());
      if (activeOnly) params.set("activeOnly", "1");
      if (role === "platform_admin" && scopeTenantId) params.set("tenantId", scopeTenantId);

      const response = await fetch(`/api/manager/staff?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await safeJson<{ items?: StaffItem[] } & ApiErrorBody>(response)) || {};
      if (!response.ok) throw new Error(getErrorMessage(payload, "讀取員工資料失敗"));

      const rows = payload.items || [];
      setItems(rows);
      const current = rows.find((item) => item.id === selectedId) || rows[0] || null;
      if (current) bindEditor(current);
      else setSelectedId("");
    } catch (caught) {
      setItems([]);
      setSelectedId("");
      setError(caught instanceof Error ? caught.message : "讀取員工資料失敗");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialize = async () => {
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const mePayload = (await safeJson<MePayload>(meResponse)) || {};
      const nextRole = typeof mePayload.role === "string" ? mePayload.role : null;
      const nextTenantId = typeof mePayload.tenantId === "string" ? mePayload.tenantId : null;
      if (meResponse.ok) {
        setMyRole(nextRole);
        setTenantId(nextTenantId);
      }
      await Promise.all([loadMeta(), loadStaff(nextRole, nextTenantId)]);
    };
    void initialize();
    // Initial load intentionally runs once with the authenticated scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStaff() {
    if (!canCreate) return;
    if (!newDisplayName.trim() || !newEmail.trim() || newPassword.length < 8) {
      setError(zh ? "請完整填寫姓名、Email 與至少 8 位的初始密碼。" : "Name, email, and an 8-character password are required.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/manager/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          displayName: newDisplayName,
          role: newRole,
          branchId: newBranchId || null,
          isActive: newActive,
          tenantId: myRole === "platform_admin" ? tenantId : undefined,
          idempotencyKey: `staff:${crypto.randomUUID()}`,
        }),
      });
      const payload =
        (await safeJson<{
          item?: StaffItem;
          verification?: { deliveryStatus?: string; deliveryError?: string | null };
        } & ApiErrorBody>(response)) || {};
      if (!response.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "建立員工帳號失敗"));
      }

      setItems((current) => [payload.item as StaffItem, ...current]);
      bindEditor(payload.item);
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
      setNewRole("frontdesk");
      setNewBranchId("");
      setNewActive(true);
      setNotice(
        payload.verification?.deliveryStatus === "sent"
          ? "員工帳號已建立，Email 驗證信已寄出。首次登入時必須重新設定密碼。"
          : `員工帳號已建立，但驗證信寄送失敗：${payload.verification?.deliveryError || "請稍後重寄"}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "建立員工帳號失敗");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor() {
    if (!selectedItem || !canEdit || !canManageSelected) return;
    if (!editDisplayName.trim()) {
      setError(zh ? "員工姓名不能留空。" : "Staff name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (myRole === "platform_admin" && tenantId) params.set("tenantId", tenantId);
      const response = await fetch(scopedUrl("/api/manager/staff", params), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedItem.id,
          role: editRole,
          displayName: editDisplayName,
          branchId: editBranchId || null,
          isActive: editActive,
        }),
      });
      const payload = (await safeJson<{ item?: StaffItem } & ApiErrorBody>(response)) || {};
      if (!response.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "儲存員工資料失敗"));
      }
      patchLocal(payload.item);
      bindEditor(payload.item);
      setNotice("員工資料已更新。");
      setEditorOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "儲存員工資料失敗");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStaff(item: StaffItem) {
    const manageable =
      myRole === "platform_admin" ||
      (myRole === "manager" && MANAGER_ASSIGNABLE_ROLES.includes(item.role));
    if (!canDisable || !manageable) return;

    setQuickBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (myRole === "platform_admin" && tenantId) params.set("tenantId", tenantId);
      const response = await fetch(scopedUrl("/api/manager/staff", params), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, isActive: !item.is_active }),
      });
      const payload = (await safeJson<{ item?: StaffItem } & ApiErrorBody>(response)) || {};
      if (!response.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "更新員工狀態失敗"));
      }
      patchLocal(payload.item);
      if (selectedId === item.id) bindEditor(payload.item);
      setNotice(payload.item.is_active ? "員工帳號已啟用。" : "員工帳號已停用。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新員工狀態失敗");
    } finally {
      setQuickBusyId(null);
    }
  }

  async function sendPasswordReset(item: StaffItem) {
    const manageable =
      myRole === "platform_admin" ||
      (myRole === "manager" && MANAGER_ASSIGNABLE_ROLES.includes(item.role));
    if (!canEdit || !manageable) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/manager/staff/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          tenantId: myRole === "platform_admin" ? tenantId : undefined,
        }),
      });
      const payload =
        (await safeJson<{ maskedEmail?: string; deliveryStatus?: string } & ApiErrorBody>(response)) || {};
      if (!response.ok) throw new Error(getErrorMessage(payload, "寄送密碼重設信失敗"));
      setNotice(`密碼重設信已寄送至 ${payload.maskedEmail || item.email || "員工信箱"}。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "寄送密碼重設信失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>BIG E FITNESS · STAFF</p>
            <h1 className={styles.title}>{zh ? "員工帳號管理" : "Staff management"}</h1>
            <p className={styles.subtitle}>
              {zh
                ? "建立員工帳號、設定角色與分店、停用帳號及寄送密碼重設信"
                : "Create staff accounts, assign scope, manage access, and send password resets"}
            </p>
          </div>
          <a className={styles.iconButton} href="/manager/fitness" title={zh ? "返回主管營運後台" : "Back"}>
            <ArrowLeft size={19} />
          </a>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <section className={styles.stats} aria-label={zh ? "員工統計" : "Staff statistics"}>
          <article className={`${styles.glassCard} ${styles.stat}`}>
            <span className={styles.statLabel}>{zh ? "全部員工" : "Total"}</span>
            <strong className={styles.statValue}>{stats.total}</strong>
          </article>
          <article className={`${styles.glassCard} ${styles.stat}`}>
            <span className={styles.statLabel}>{zh ? "啟用中" : "Active"}</span>
            <strong className={styles.statValue}>{stats.active}</strong>
          </article>
          <article className={`${styles.glassCard} ${styles.stat}`}>
            <span className={styles.statLabel}>{zh ? "教練" : "Coaches"}</span>
            <strong className={styles.statValue}>{stats.coach}</strong>
          </article>
          <article className={`${styles.glassCard} ${styles.stat}`}>
            <span className={styles.statLabel}>{zh ? "櫃台" : "Frontdesk"}</span>
            <strong className={styles.statValue}>{stats.frontdesk}</strong>
          </article>
        </section>

        <section className={`${styles.glassCard} ${styles.filters}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-role-filter">
              {zh ? "角色" : "Role"}
            </label>
            <select
              id="staff-role-filter"
              className={styles.select}
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">{zh ? "全部角色" : "All roles"}</option>
              {ALL_STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role, zh)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="staff-search">
              {zh ? "搜尋員工" : "Search"}
            </label>
            <input
              id="staff-search"
              className={styles.input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadStaff();
              }}
              placeholder={zh ? "姓名或 Email" : "Name or email"}
            />
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            {zh ? "只顯示啟用帳號" : "Active only"}
          </label>
          <button className={styles.button} type="button" onClick={() => void loadStaff()} disabled={loading}>
            <RefreshCw size={17} />
            {loading ? (zh ? "讀取中" : "Loading") : zh ? "更新清單" : "Refresh"}
          </button>
        </section>

        <div className={styles.workspace}>
          <section className={`${styles.glassCard} ${styles.panel}`}>
            <h2 className={styles.panelTitle}>{zh ? "建立員工帳號" : "Create staff account"}</h2>
            <p className={styles.panelHint}>
              {zh
                ? "建立後會寄出 Email 驗證信；員工第一次登入時必須重新設定密碼。"
                : "A verification email is sent, and the employee must change their password on first sign-in."}
            </p>
            <div className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-staff-name">
                  {zh ? "真實姓名" : "Name"}
                </label>
                <input
                  id="new-staff-name"
                  className={styles.input}
                  value={newDisplayName}
                  onChange={(event) => setNewDisplayName(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-staff-role">
                  {zh ? "角色" : "Role"}
                </label>
                <select
                  id="new-staff-role"
                  className={styles.select}
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value as StaffRole)}
                  disabled={!canCreate}
                >
                  {createRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role, zh)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.full}`}>
                <label className={styles.label} htmlFor="new-staff-email">
                  Email
                </label>
                <input
                  id="new-staff-email"
                  className={styles.input}
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-staff-password">
                  {zh ? "初始密碼" : "Initial password"}
                </label>
                <input
                  id="new-staff-password"
                  className={styles.input}
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  placeholder={zh ? "至少 8 位" : "At least 8 characters"}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-staff-branch">
                  {zh ? "分店" : "Branch"}
                </label>
                <select
                  id="new-staff-branch"
                  className={styles.select}
                  value={newBranchId}
                  onChange={(event) => setNewBranchId(event.target.value)}
                  disabled={!canCreate}
                >
                  <option value="">{zh ? "不指定分店" : "No branch"}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className={`${styles.toggle} ${styles.full}`}>
                <input
                  type="checkbox"
                  checked={newActive}
                  onChange={(event) => setNewActive(event.target.checked)}
                  disabled={!canCreate}
                />
                {zh ? "建立後立即啟用" : "Activate immediately"}
              </label>
              <div className={styles.formActions}>
                <button
                  className={`${styles.button} ${styles.primary}`}
                  type="button"
                  onClick={() => void createStaff()}
                  disabled={!canCreate || saving}
                >
                  <Plus size={17} />
                  {saving ? (zh ? "建立中" : "Creating") : zh ? "建立員工" : "Create staff"}
                </button>
              </div>
            </div>
          </section>

          <section className={`${styles.glassCard} ${styles.panel}`}>
            <h2 className={styles.panelTitle}>{zh ? "編輯員工資料" : "Edit staff"}</h2>
            <p className={styles.panelHint}>
              {zh ? "從下方清單選擇員工後，可調整姓名、角色、分店與啟用狀態。" : "Select an employee below to update access."}
            </p>
            {selectedItem ? (
              <>
                <p className={styles.selectedStaff}>
                  <strong>{selectedItem.display_name || selectedItem.email || (zh ? "未命名員工" : "Unnamed staff")}</strong>
                  <span>{selectedItem.email || (zh ? "未提供 Email" : "No email")}</span>
                </p>
                <div className={styles.form}>
                  <div className={`${styles.field} ${styles.full}`}>
                    <label className={styles.label} htmlFor="edit-staff-name">
                      {zh ? "姓名" : "Name"}
                    </label>
                    <input
                      id="edit-staff-name"
                      className={styles.input}
                      value={editDisplayName}
                      onChange={(event) => setEditDisplayName(event.target.value)}
                      disabled={!canManageSelected}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="edit-staff-role">
                      {zh ? "角色" : "Role"}
                    </label>
                    <select
                      id="edit-staff-role"
                      className={styles.select}
                      value={editRole}
                      onChange={(event) => setEditRole(event.target.value as StaffRole)}
                      disabled={!canManageSelected}
                    >
                      {(myRole === "platform_admin" ? ALL_STAFF_ROLES : MANAGER_ASSIGNABLE_ROLES).map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role, zh)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="edit-staff-branch">
                      {zh ? "分店" : "Branch"}
                    </label>
                    <select
                      id="edit-staff-branch"
                      className={styles.select}
                      value={editBranchId}
                      onChange={(event) => setEditBranchId(event.target.value)}
                      disabled={!canManageSelected}
                    >
                      <option value="">{zh ? "不指定分店" : "No branch"}</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className={`${styles.toggle} ${styles.full}`}>
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(event) => setEditActive(event.target.checked)}
                      disabled={!canManageSelected}
                    />
                    {zh ? "帳號啟用" : "Account active"}
                  </label>
                  <div className={styles.formActions}>
                    <button
                      className={`${styles.button} ${styles.primary}`}
                      type="button"
                      onClick={() => void saveEditor()}
                      disabled={saving || !canManageSelected}
                    >
                      <Save size={17} />
                      {zh ? "儲存變更" : "Save changes"}
                    </button>
                  </div>
                </div>
                {!canManageSelected ? (
                  <p className={styles.panelHint}>
                    {zh ? "目前帳號沒有權限修改這個角色。" : "Your role cannot modify this account."}
                  </p>
                ) : null}
              </>
            ) : (
              <p className={styles.empty}>{zh ? "尚未選擇員工" : "No employee selected"}</p>
            )}
          </section>
        </div>

        <section className={`${styles.glassCard} ${styles.listPanel}`}>
          <div className={styles.listHeader}>
            <div>
              <h2 className={styles.panelTitle}>{zh ? "員工清單" : "Staff list"}</h2>
              <span className={styles.count}>
                {zh ? `共 ${items.length} 筆，停用 ${stats.inactive} 筆` : `${items.length} records`}
              </span>
            </div>
            <ShieldCheck size={22} aria-hidden="true" />
          </div>

          {items.length ? (
            <div className={styles.staffList}>
              {items.map((item) => {
                const manageable =
                  myRole === "platform_admin" ||
                  (myRole === "manager" && MANAGER_ASSIGNABLE_ROLES.includes(item.role));
                return (
                  <article
                    className={`${styles.staffRow} ${selectedId === item.id ? styles.staffRowSelected : ""}`}
                    key={item.id}
                  >
                    <div className={styles.staffIdentity}>
                      <span className={styles.staffName}>{item.display_name || "未填姓名"}</span>
                      <span className={styles.staffEmail}>{item.email || (zh ? "未提供 Email" : "No email")}</span>
                    </div>
                    <span className={styles.role}>{roleLabel(item.role, zh)}</span>
                    <div>
                      <span className={styles.meta}>
                        {zh ? "分店：" : "Branch: "}
                        {item.branch_id ? branchNames.get(item.branch_id) || "已指定" : "未指定"}
                      </span>
                      <span className={styles.meta}>
                        {zh ? "上次登入：" : "Last login: "}
                        {formatDate(item.last_login_at, locale)}
                      </span>
                    </div>
                    <span className={`${styles.status} ${item.is_active ? "" : styles.inactive}`}>
                      {item.is_active ? (zh ? "啟用" : "Active") : zh ? "停用" : "Inactive"}
                    </span>
                    <div className={styles.rowActions}>
                      <button className={styles.button} type="button" onClick={() => openEditor(item)}>
                        <Pencil size={16} />
                        {zh ? "編輯" : "Edit"}
                      </button>
                      <button
                        className={`${styles.iconButton} ${item.is_active ? styles.danger : ""}`}
                        type="button"
                        title={item.is_active ? (zh ? "停用帳號" : "Disable") : zh ? "啟用帳號" : "Enable"}
                        onClick={() => void toggleStaff(item)}
                        disabled={!manageable || quickBusyId === item.id}
                      >
                        {item.is_active ? <UserRoundX size={17} /> : <UserRoundCheck size={17} />}
                      </button>
                      <button
                        className={styles.iconButton}
                        type="button"
                        title={zh ? "寄送密碼重設信" : "Send password reset"}
                        onClick={() => void sendPasswordReset(item)}
                        disabled={!manageable || saving}
                      >
                        <KeyRound size={17} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>
              <UserRound size={24} aria-hidden="true" />
              <br />
              {loading ? (zh ? "正在讀取員工資料" : "Loading staff") : zh ? "沒有符合條件的員工" : "No matching staff"}
            </p>
          )}
        </section>

        {editorOpen && selectedItem ? (
          <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setEditorOpen(false)}>
            <section
              className={`${styles.glassCard} ${styles.modal}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="staff-editor-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <div>
                  <p className={styles.eyebrow}>BIG E FITNESS · STAFF</p>
                  <h2 className={styles.panelTitle} id="staff-editor-title">
                    {zh ? "編輯員工" : "Edit staff"}
                  </h2>
                </div>
                <button
                  className={styles.iconButton}
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  title={zh ? "關閉" : "Close"}
                >
                  <X size={18} />
                </button>
              </div>

              <div className={styles.modalIdentity}>
                <strong>
                  {selectedItem.display_name ||
                    selectedItem.email ||
                    (zh ? "未命名員工" : "Unnamed staff")}
                </strong>
                <span>{selectedItem.email || (zh ? "未提供 Email" : "No email")}</span>
              </div>

              <div className={styles.form}>
                <div className={`${styles.field} ${styles.full}`}>
                  <label className={styles.label} htmlFor="modal-edit-staff-name">
                    {zh ? "姓名" : "Name"}
                  </label>
                  <input
                    id="modal-edit-staff-name"
                    className={styles.input}
                    value={editDisplayName}
                    onChange={(event) => setEditDisplayName(event.target.value)}
                    disabled={!canManageSelected}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="modal-edit-staff-role">
                    {zh ? "角色" : "Role"}
                  </label>
                  <select
                    id="modal-edit-staff-role"
                    className={styles.select}
                    value={editRole}
                    onChange={(event) => setEditRole(event.target.value as StaffRole)}
                    disabled={!canManageSelected}
                  >
                    {(myRole === "platform_admin"
                      ? ALL_STAFF_ROLES
                      : MANAGER_ASSIGNABLE_ROLES
                    ).map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role, zh)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="modal-edit-staff-branch">
                    {zh ? "分店" : "Branch"}
                  </label>
                  <select
                    id="modal-edit-staff-branch"
                    className={styles.select}
                    value={editBranchId}
                    onChange={(event) => setEditBranchId(event.target.value)}
                    disabled={!canManageSelected}
                  >
                    <option value="">{zh ? "不指定分店" : "No branch"}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className={`${styles.toggle} ${styles.full}`}>
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(event) => setEditActive(event.target.checked)}
                    disabled={!canManageSelected}
                  />
                  {zh ? "帳號啟用" : "Account active"}
                </label>
                <div className={styles.formActions}>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => setEditorOpen(false)}
                  >
                    {zh ? "取消" : "Cancel"}
                  </button>
                  <button
                    className={`${styles.button} ${styles.primary}`}
                    type="button"
                    onClick={() => void saveEditor()}
                    disabled={saving || !canManageSelected}
                  >
                    <Save size={17} />
                    {saving ? (zh ? "儲存中" : "Saving") : zh ? "儲存變更" : "Save changes"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
