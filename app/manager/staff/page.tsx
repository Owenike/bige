"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

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
}

interface ApiErrorBody {
  error?: { code?: string; message?: string } | string;
  message?: string;
}

const STAFF_CREATE_OPTIONS: StaffRole[] = ["frontdesk", "coach", "sales", "supervisor"];
const STAFF_EDIT_OPTIONS: StaffRole[] = ["manager", "supervisor", "branch_manager", "frontdesk", "coach", "sales"];

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as ApiErrorBody;
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof body.error.message === "string" && body.error.message) {
    return body.error.message;
  }
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

function fmtDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function roleLabel(role: StaffRole, _zh: boolean) {
  return role;
}

async function safeJson<T>(res: Response): Promise<T | null> {
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
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [myRole, setMyRole] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickBusyId, setQuickBusyId] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [selectedId, setSelectedId] = useState<string>("");
  const [editRole, setEditRole] = useState<StaffRole>("frontdesk");
  const [editDisplayName, setEditDisplayName] = useState<string>("");
  const [editBranchId, setEditBranchId] = useState<string>("");
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

  function patchLocal(item: StaffItem) {
    setItems((prev) => prev.map((v) => (v.id === item.id ? item : v)));
  }

  function bindEditor(item: StaffItem) {
    setSelectedId(item.id);
    setEditRole(item.role);
    setEditDisplayName(item.display_name || "");
    setEditBranchId(item.branch_id || "");
    setEditActive(item.is_active);
  }

  async function loadMeta() {
    const [meRes, branchesRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/manager/branches?activeOnly=1"),
    ]);

    const mePayload = (await safeJson<MePayload>(meRes)) || {};
    if (meRes.ok) setMyRole(typeof mePayload.role === "string" ? mePayload.role : null);

    const branchPayload = (await safeJson<{ items?: BranchItem[] } & ApiErrorBody>(branchesRes)) || {};
    if (branchesRes.ok) {
      setBranches((branchPayload.items || []) as BranchItem[]);
    } else {
      setBranches([]);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setResetLink(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (q.trim()) params.set("q", q.trim());
      if (activeOnly) params.set("activeOnly", "1");

      const res = await fetch(`/api/manager/staff?${params.toString()}`);
      const payload = (await safeJson<{ items?: StaffItem[] } & ApiErrorBody>(res)) || {};
      if (!res.ok) throw new Error(getErrorMessage(payload, "Load staff failed"));

      const rows = (payload.items || []) as StaffItem[];
      setItems(rows);
      if (rows.length > 0) {
        const current = rows.find((v) => v.id === selectedId) || rows[0];
        bindEditor(current);
      } else {
        setSelectedId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load staff failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadMeta(), load()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createStaff() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setResetLink(null);
    try {
      const res = await fetch("/api/manager/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          displayName: newDisplayName || null,
          role: newRole,
          branchId: newBranchId || null,
          isActive: newActive,
        }),
      });
      const payload = (await safeJson<{ item?: StaffItem } & ApiErrorBody>(res)) || {};
      if (!res.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "Create staff failed"));
      }
      setItems((prev) => [payload.item as StaffItem, ...prev]);
      setNotice("Staff account created.");
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
      setNewRole("frontdesk");
      setNewBranchId("");
      setNewActive(true);
      bindEditor(payload.item as StaffItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create staff failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor() {
    if (!selectedId || !canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setResetLink(null);
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
      const payload = (await safeJson<{ item?: StaffItem } & ApiErrorBody>(res)) || {};
      if (!res.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "Save failed"));
      }
      patchLocal(payload.item as StaffItem);
      bindEditor(payload.item as StaffItem);
      setNotice("Staff profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: StaffItem) {
    if (!canDisable) return;
    setQuickBusyId(item.id);
    setError(null);
    setNotice(null);
    setResetLink(null);
    try {
      const res = await fetch("/api/manager/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          isActive: !item.is_active,
        }),
      });
      const payload = (await safeJson<{ item?: StaffItem } & ApiErrorBody>(res)) || {};
      if (!res.ok || !payload.item) {
        throw new Error(getErrorMessage(payload, "Update state failed"));
      }
      patchLocal(payload.item as StaffItem);
      if ((payload.item as StaffItem).id === selectedId) bindEditor(payload.item as StaffItem);
      setNotice((payload.item as StaffItem).is_active ? "Staff activated." : "Staff deactivated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update state failed");
    } finally {
      setQuickBusyId(null);
    }
  }

  async function generateResetLink(item: StaffItem) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setResetLink(null);
    try {
      const res = await fetch("/api/manager/staff/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const payload = (await safeJson<{ maskedEmail?: string; resetLink?: string } & ApiErrorBody>(res)) || {};
      if (!res.ok) {
        throw new Error(getErrorMessage(payload, "Generate reset link failed"));
      }
      setNotice(`Reset link ready for ${payload.maskedEmail || item.email || item.id}`);
      setResetLink(payload.resetLink || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate reset link failed");
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((v) => v.is_active).length;
    const inactive = total - active;
    const supervisors = items.filter((v) => v.role === "supervisor" || v.role === "branch_manager").length;
    const frontdesk = items.filter((v) => v.role === "frontdesk").length;
    const coach = items.filter((v) => v.role === "coach").length;
    const sales = items.filter((v) => v.role === "sales").length;
    return { total, active, inactive, supervisors, frontdesk, coach, sales };
  }, [items]);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "MANAGER / STAFF" : "MANAGER / STAFF"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Staff Governance
            </h1>
            <p className="fdGlassText">
              Create staff accounts, assign roles and branch scope, activate/deactivate, and generate reset links.
            </p>
          </div>
        </section>

        <p className="sub" style={{ marginBottom: 12 }}>
          <a href="/manager">Back to dashboard</a>
        </p>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {notice ? <div className="ok" style={{ marginBottom: 12 }}>{notice}</div> : null}
        {resetLink ? (
          <div className="fdGlassSubPanel" style={{ padding: 12, marginBottom: 12 }}>
            <p className="sub" style={{ marginTop: 0 }}>Reset link:</p>
            <a href={resetLink} target="_blank" rel="noreferrer" className="sub" style={{ wordBreak: "break-all" }}>
              {resetLink}
            </a>
          </div>
        ) : null}

        <section className="fdActionGrid" style={{ marginBottom: 14 }}>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">Total</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.total}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">Active</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.active}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">Inactive</h3>
            <p className="h2" style={{ marginTop: 8 }}>{stats.inactive}</p>
          </article>
          <article className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
            <h3 className="fdActionTitle">Role mix</h3>
            <p className="sub" style={{ marginTop: 8 }}>Supervisor: {stats.supervisors}</p>
            <p className="sub">Frontdesk: {stats.frontdesk}</p>
            <p className="sub">Coach: {stats.coach}</p>
            <p className="sub">Sales: {stats.sales}</p>
          </article>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">Filters</h2>
          <div className="actions" style={{ marginTop: 10 }}>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="input">
              <option value="all">all</option>
              {STAFF_EDIT_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="display name / id / email"
              className="input"
            />
            <label className="sub">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> activeOnly
            </label>
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create staff account</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email" />
              <input className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="password (min 8)" />
              <input className="input" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="display name" />
              <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)} disabled={!canCreate}>
                {(canCreate ? STAFF_CREATE_OPTIONS : STAFF_EDIT_OPTIONS).map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <select className="input" value={newBranchId} onChange={(e) => setNewBranchId(e.target.value)} disabled={!canCreate}>
                <option value="">branch (optional)</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <label className="sub">
                <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} disabled={!canCreate} /> active
              </label>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void createStaff()} disabled={!canCreate || saving}>
                {saving ? "Saving..." : "Create Staff"}
              </button>
              {!canCreate ? <p className="fdGlassText">Current role does not have `staff.create` permission.</p> : null}
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Role boundary</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              <p className="sub" style={{ marginTop: 0 }}>manager: can create frontdesk/coach/sales/supervisor.</p>
              <p className="sub" style={{ marginTop: 0 }}>supervisor/branch_manager: cannot create or disable staff.</p>
              <p className="sub" style={{ marginTop: 0 }}>frontdesk/coach/sales: cannot manage staff accounts.</p>
              <p className="sub" style={{ marginTop: 0 }}>platform_admin: unrestricted by tenant, can support all tenants.</p>
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Edit staff</h2>
          {!selectedId ? (
            <p className="fdGlassText" style={{ marginTop: 10 }}>
              Select one staff record from the list below first.
            </p>
          ) : (
            <div className="actions" style={{ marginTop: 10 }}>
              <input value={selectedId} readOnly className="input" />
              <select value={editRole} onChange={(e) => setEditRole(e.target.value as StaffRole)} className="input" disabled={!canEdit}>
                {STAFF_EDIT_OPTIONS.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="display name" className="input" />
              <select className="input" value={editBranchId} onChange={(e) => setEditBranchId(e.target.value)}>
                <option value="">branch (optional)</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <label className="sub">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} /> active
              </label>
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void saveEditor()} disabled={saving || !canEdit}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          )}
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">Staff list</h2>
          <div className="fdActionGrid">
            {items.map((item) => (
              <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 12 }}>
                <h3 className="fdActionTitle" style={{ fontSize: 18 }}>{item.display_name || item.email || "-"}</h3>
                <p className="sub" style={{ marginTop: 8 }}>role: {roleLabel(item.role, zh)}</p>
                <p className="sub" style={{ marginTop: 2 }}>active: {item.is_active ? "1" : "0"}</p>
                <p className="sub" style={{ marginTop: 2 }}>branch: {item.branch_id || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>email: {item.email || "-"}</p>
                <p className="sub" style={{ marginTop: 2 }}>last login: {fmtDate(item.last_login_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>created: {fmtDate(item.created_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>updated: {fmtDate(item.updated_at)}</p>
                <p className="sub" style={{ marginTop: 2 }}>id: {item.id}</p>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button type="button" className="fdPillBtn" onClick={() => bindEditor(item)}>
                    Edit
                  </button>
                  <button type="button" className="fdPillBtn" onClick={() => void quickToggle(item)} disabled={!canDisable || quickBusyId === item.id}>
                    {quickBusyId === item.id ? "Working..." : item.is_active ? "Disable" : "Enable"}
                  </button>
                  <button type="button" className="fdPillBtn" onClick={() => void generateResetLink(item)} disabled={!canEdit || saving}>
                    Reset Link
                  </button>
                </div>
              </article>
            ))}
            {items.length === 0 ? <p className="fdGlassText">No staff records found.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
