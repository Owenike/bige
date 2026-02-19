"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type StaffRole = "manager" | "frontdesk" | "coach" | "member";

interface StaffItem {
  id: string;
  role: StaffRole;
  tenant_id: string | null;
  branch_id: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ApiErrorPayload {
  error?: string;
}

interface StaffListPayload extends ApiErrorPayload {
  items?: StaffItem[];
}

interface StaffPatchPayload extends ApiErrorPayload {
  item?: StaffItem;
}

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);

  const [role, setRole] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [selectedId, setSelectedId] = useState<string>("");
  const [editRole, setEditRole] = useState<StaffRole>("frontdesk");
  const [editDisplayName, setEditDisplayName] = useState<string>("");
  const [editBranchId, setEditBranchId] = useState<string>("");
  const [editActive, setEditActive] = useState(true);

  function roleLabel(roleValue: string) {
    if (!zh) return roleValue;
    if (roleValue === "manager") return "管理者";
    if (roleValue === "frontdesk") return "櫃檯";
    if (roleValue === "coach") return "教練";
    if (roleValue === "member") return "會員";
    if (roleValue === "platform_admin") return "平台管理員";
    return roleValue;
  }

  function bindEditor(item: StaffItem) {
    setSelectedId(item.id);
    setEditRole(item.role);
    setEditDisplayName(item.display_name || "");
    setEditBranchId(item.branch_id || "");
    setEditActive(item.is_active);
  }

  function patchLocal(item: StaffItem) {
    setItems((prev) => prev.map((v) => (v.id === item.id ? item : v)));
  }

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams();
      if (role !== "all") params.set("role", role);
      if (q.trim()) params.set("q", q.trim());
      if (activeOnly) params.set("activeOnly", "1");

      const res = await fetch(`/api/manager/staff?${params.toString()}`);
      const payload = (await parseJsonSafe<StaffListPayload>(res)) || {};
      if (!res.ok) {
        setError(payload.error || (zh ? "載入人員失敗" : "Load staff failed"));
        setItems([]);
        setLoading(false);
        return;
      }

      const rows = payload.items || [];
      setItems(rows);
      if (rows.length > 0) {
        const current = rows.find((v) => v.id === selectedId) || rows[0];
        bindEditor(current);
      } else {
        setSelectedId("");
      }
    } catch {
      setError(zh ? "載入人員失敗" : "Load staff failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveEditor() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/manager/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedId,
          role: editRole,
          displayName: editDisplayName,
          branchId: editBranchId || null,
          isActive: editActive,
        }),
      });
      const payload = (await parseJsonSafe<StaffPatchPayload>(res)) || {};
      if (!res.ok || !payload.item) {
        setError(payload.error || (zh ? "儲存失敗" : "Save failed"));
        setSaving(false);
        return;
      }
      patchLocal(payload.item);
      bindEditor(payload.item);
      setNotice(zh ? "已更新人員資料" : "Staff profile updated.");
    } catch {
      setError(zh ? "儲存失敗" : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: StaffItem) {
    setQuickBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/manager/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          isActive: !item.is_active,
        }),
      });
      const payload = (await parseJsonSafe<StaffPatchPayload>(res)) || {};
      if (!res.ok || !payload.item) {
        setError(payload.error || (zh ? "更新狀態失敗" : "Update state failed"));
        setQuickBusyId(null);
        return;
      }
      patchLocal(payload.item);
      if (payload.item.id === selectedId) bindEditor(payload.item);
      setNotice(payload.item.is_active ? (zh ? "人員已啟用" : "Staff activated.") : zh ? "人員已停用" : "Staff deactivated.");
    } catch {
      setError(zh ? "更新狀態失敗" : "Update state failed");
    } finally {
      setQuickBusyId(null);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((v) => v.is_active).length;
    const inactive = total - active;
    const managers = items.filter((v) => v.role === "manager").length;
    const frontdesk = items.filter((v) => v.role === "frontdesk").length;
    const coach = items.filter((v) => v.role === "coach").length;
    return { total, active, inactive, managers, frontdesk, coach };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "團隊名單" : "TEAM DIRECTORY"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "人員管理" : "Staff"}
            </h1>
            <p className="fdGlassText">
              {zh ? "依角色與分館篩選人員，並可直接調整狀態與資料。" : "Filter staff by role and branch, then update status and profile details directly."}
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">{zh ? "回儀表板" : "Back to dashboard"}</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {notice ? <div className="ok" style={{ marginBottom: 12 }}>{notice}</div> : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "總人數" : "Total"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "啟用中" : "Active"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.active}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "停用中" : "Inactive"}</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.inactive}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">{zh ? "角色分布" : "Role mix"}</h3>
            <p className="sub" style={{ marginTop: 8 }}>{zh ? "管理者" : "Manager"}: {stats.managers}</p>
            <p className="sub">{zh ? "櫃檯" : "Frontdesk"}: {stats.frontdesk}</p>
            <p className="sub">{zh ? "教練" : "Coach"}: {stats.coach}</p>
          </article>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "篩選條件" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 10 }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
              <option value="all">{zh ? "全部" : "all"}</option>
              <option value="manager">{zh ? "管理者" : "manager"}</option>
              <option value="frontdesk">{zh ? "櫃檯" : "frontdesk"}</option>
              <option value="coach">{zh ? "教練" : "coach"}</option>
              <option value="member">{zh ? "會員" : "member"}</option>
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={zh ? "名稱或 ID 搜尋" : "display name / id search"}
              className="input"
            />
            <label className="sub">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />{" "}
              {zh ? "僅顯示啟用" : "activeOnly"}
            </label>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? (zh ? "載入中..." : "Loading...") : zh ? "載入" : "Load"}
            </button>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "編輯人員" : "Edit staff"}</h2>
          {!selectedId ? (
            <p className="fdGlassText" style={{ marginTop: 10 }}>
              {zh ? "請先從下方清單選擇人員。" : "Select one staff record from the list below first."}
            </p>
          ) : (
            <div className="actions" style={{ marginTop: 10 }}>
              <input value={selectedId} readOnly className="input" />
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as StaffRole)} className="input">
                <option value="manager">{zh ? "管理者" : "manager"}</option>
                <option value="frontdesk">{zh ? "櫃檯" : "frontdesk"}</option>
                <option value="coach">{zh ? "教練" : "coach"}</option>
                <option value="member">{zh ? "會員" : "member"}</option>
              </select>
              <input
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder={zh ? "顯示名稱" : "display name"}
                className="input"
              />
              <input
                value={editBranchId}
                onChange={(e) => setEditBranchId(e.target.value)}
                placeholder={zh ? "分館 ID（留空代表不限）" : "branch id (empty = none)"}
                className="input"
              />
              <label className="sub">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />{" "}
                {zh ? "啟用帳號" : "active"}
              </label>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void saveEditor()} disabled={saving}>
                {saving ? (zh ? "儲存中..." : "Saving...") : zh ? "儲存修改" : "Save"}
              </button>
            </div>
          )}
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "人員清單" : "Staff list"}</h2>
          <div className="fdActionGrid">
            {items.map((p) => (
              <article key={p.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{p.display_name || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>{zh ? "角色" : "role"}: {roleLabel(p.role)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "狀態" : "active"}: {p.is_active ? (zh ? "啟用" : "1") : zh ? "停用" : "0"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "分館" : "branch"}: {p.branch_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "建立時間" : "created"}: {fmtDate(p.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "更新時間" : "updated"}: {fmtDate(p.updated_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>{zh ? "ID" : "id"}: {p.id}</p>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button type="button" className="fdPillBtn" onClick={() => bindEditor(p)}>
                    {zh ? "載入編輯" : "Edit"}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn"
                    onClick={() => void quickToggle(p)}
                    disabled={quickBusyId === p.id}
                  >
                    {quickBusyId === p.id ? (zh ? "處理中..." : "Working...") : p.is_active ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
                  </button>
                </div>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">{zh ? "找不到人員資料。" : "No staff records found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
