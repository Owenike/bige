"use client";

import {
  ArrowLeft,
  KeyRound,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  email: string | null;
};

type BranchItem = {
  id: string;
  name: string;
  is_active: boolean;
};

type MePayload = {
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

export default function ManagerStaffPage() {
  const [me, setMe] = useState<MePayload>({});
  const [items, setItems] = useState<StaffItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<"all" | StaffDepartment>("all");
  const [activeOnly, setActiveOnly] = useState(false);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDepartment, setNewDepartment] = useState<StaffDepartment>("general_affairs");
  const [newPosition, setNewPosition] = useState<StaffPosition>("frontdesk");
  const [newBranchId, setNewBranchId] = useState("");

  const [editing, setEditing] = useState<StaffItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDepartment, setEditDepartment] = useState<StaffDepartment>("general_affairs");
  const [editPosition, setEditPosition] = useState<StaffPosition>("frontdesk");
  const [editBranchId, setEditBranchId] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthTitle, setReauthTitle] = useState("");
  const [reauth, setReauth] = useState<Reauth>(EMPTY_REAUTH);
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
      if (activeOnly) staffParams.set("activeOnly", "1");

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
  }, [activeOnly, query]);

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
    setPendingAction(() => action);
    setReauthOpen(true);
  }

  async function confirmSensitive() {
    if (!pendingAction || !reauth.account || !reauth.password || !reauth.reason.trim()) {
      setError("請輸入員工 Email、密碼與操作原因");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await pendingAction(reauth);
      setReauthOpen(false);
      setPendingAction(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失敗");
    } finally {
      setSaving(false);
    }
  }

  function createStaff() {
    if (!canCreate || !newName.trim() || !newEmail.trim() || newPassword.length < 8) {
      setError("請填寫姓名、Email 與至少 8 位的初始密碼");
      return;
    }
    requestSensitive("確認建立員工帳號", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          displayName: newName,
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
      setNewEmail("");
      setNewPassword("");
      setNewBranchId("");
      setNotice("員工帳號已建立，驗證信已送出");
      await load();
    });
  }

  function openEditor(item: StaffItem) {
    const department = item.department || "general_affairs";
    const position = item.position || DEPARTMENT_POSITIONS[department][0];
    setEditing(item);
    setEditName(item.display_name || "");
    setEditDepartment(department);
    setEditPosition(position);
    setEditBranchId(item.branch_id || "");
    setEditActive(item.is_active);
  }

  function saveEditor() {
    if (!editing || !editName.trim()) return;
    requestSensitive("確認儲存員工資料", async (credentials) => {
      const response = await fetch(scopedPath("/api/manager/staff"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing.id,
          displayName: editName,
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

  async function switchUser() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login?tab=staff";
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
              placeholder="姓名或 Email"
            />
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            只顯示啟用帳號
          </label>
          <button className={styles.button} type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={17} />
            {loading ? "讀取中" : "更新清單"}
          </button>
        </section>

        {canCreate ? (
          <section className={`${styles.glassCard} ${styles.panel}`}>
            <h2 className={styles.panelTitle}>建立員工帳號</h2>
            <p className={styles.panelHint}>員工第一次登入須完成 Email 驗證並重新設定密碼。</p>
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.label}>真實姓名</span>
                <input className={styles.input} value={newName} onChange={(event) => setNewName(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Email</span>
                <input className={styles.input} type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>初始密碼</span>
                <input className={styles.input} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" />
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
              <h2 className={styles.panelTitle}>員工清單</h2>
              <span className={styles.count}>共 {visibleItems.length} 筆</span>
            </div>
            <ShieldCheck size={22} />
          </div>
          <div className={styles.staffList}>
            {visibleItems.map((item) => (
              <article className={styles.staffRow} key={item.id}>
                <div className={styles.staffIdentity}>
                  <span className={styles.staffName}>{item.display_name || "未命名員工"}</span>
                  <span className={styles.staffEmail}>{item.email || "未設定 Email"}</span>
                </div>
                <span className={styles.role}>
                  {departmentLabel(item.department)} · {positionLabel(item.position)}
                </span>
                <div>
                  <span className={styles.meta}>分店：{item.branch_id ? branchNames.get(item.branch_id) || "未知分店" : "未指定"}</span>
                  <span className={styles.meta}>上次登入：{formatDate(item.last_login_at)}</span>
                </div>
                <span className={`${styles.status} ${item.is_active ? "" : styles.inactive}`}>
                  {item.is_active ? "啟用" : "停用"}
                </span>
                <div className={styles.rowActions}>
                  <button className={styles.button} type="button" onClick={() => openEditor(item)} disabled={!manageable(item)}>
                    <Pencil size={16} />
                    編輯
                  </button>
                  <button className={`${styles.iconButton} ${item.is_active ? styles.danger : ""}`} type="button" onClick={() => toggleStaff(item)} disabled={!manageable(item)} title={item.is_active ? "停用帳號" : "啟用帳號"}>
                    {item.is_active ? <UserRoundX size={17} /> : <UserRoundCheck size={17} />}
                  </button>
                  <button className={styles.iconButton} type="button" onClick={() => resetPassword(item)} disabled={!manageable(item)} title="寄送密碼重設信">
                    <KeyRound size={17} />
                  </button>
                </div>
              </article>
            ))}
            {!loading && visibleItems.length === 0 ? <p className={styles.empty}>目前沒有符合條件的員工</p> : null}
          </div>
        </section>

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
                <span>{editing.email}</span>
              </div>
              <div className={styles.form}>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>姓名</span>
                  <input className={styles.input} value={editName} onChange={(event) => setEditName(event.target.value)} />
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
              <p className={styles.panelHint}>請由實際執行此操作的人輸入自己的員工帳號與密碼。</p>
              <div className={styles.form}>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>員工 Email</span>
                  <input className={styles.input} type="email" autoComplete="username" value={reauth.account} onChange={(event) => setReauth({ ...reauth, account: event.target.value })} />
                </label>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>密碼</span>
                  <input className={styles.input} type="password" autoComplete="current-password" value={reauth.password} onChange={(event) => setReauth({ ...reauth, password: event.target.value })} />
                </label>
                <label className={`${styles.field} ${styles.full}`}>
                  <span className={styles.label}>操作原因</span>
                  <input className={styles.input} value={reauth.reason} onChange={(event) => setReauth({ ...reauth, reason: event.target.value })} placeholder="例如：新進員工建檔" />
                </label>
                <div className={styles.formActions}>
                  <button className={styles.button} type="button" onClick={() => setReauthOpen(false)} disabled={saving}>取消</button>
                  <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => void confirmSensitive()} disabled={saving}>
                    <ShieldCheck size={17} />
                    {saving ? "驗證中" : "驗證並執行"}
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
