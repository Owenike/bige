"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n-provider";

type AppRole = "platform_admin" | "manager" | "frontdesk" | "coach" | "member";

type TenantItem = { id: string; name: string; status: string };
type FlagItem = { id: string; tenant_id: string; key: string; enabled: boolean };
type AuditItem = { id: string; action: string; target_type: string; target_id: string | null; created_at: string };
type ProfileItem = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  role: AppRole;
  display_name: string | null;
  is_active: boolean;
};

type ErrorPayload = { error?: string };

async function jsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export default function PlatformAdminPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  const [tenantName, setTenantName] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [editTenantName, setEditTenantName] = useState("");
  const [editTenantStatus, setEditTenantStatus] = useState("active");

  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<AppRole>("manager");
  const [userTenantId, setUserTenantId] = useState("");
  const [userBranchId, setUserBranchId] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");

  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);

  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editRole, setEditRole] = useState<AppRole>("manager");
  const [editProfileTenantId, setEditProfileTenantId] = useState("");
  const [editProfileBranchId, setEditProfileBranchId] = useState("");
  const [editProfileDisplayName, setEditProfileDisplayName] = useState("");
  const [editProfileActive, setEditProfileActive] = useState(true);

  const selectedTenant = useMemo(() => tenants.find((t) => t.id === tenantId) || null, [tenants, tenantId]);
  const selectedProfile = useMemo(() => profiles.find((p) => p.id === selectedProfileId) || null, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedTenant) return;
    setEditTenantName(selectedTenant.name);
    setEditTenantStatus(selectedTenant.status);
  }, [selectedTenant]);

  useEffect(() => {
    if (!selectedProfile) return;
    setEditRole(selectedProfile.role);
    setEditProfileTenantId(selectedProfile.tenant_id || "");
    setEditProfileBranchId(selectedProfile.branch_id || "");
    setEditProfileDisplayName(selectedProfile.display_name || "");
    setEditProfileActive(selectedProfile.is_active);
  }, [selectedProfile]);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = (await jsonSafe<{ items?: TenantItem[] } & ErrorPayload>(res)) || {};
    if (!res.ok) throw new Error(payload.error || "Load tenants failed");
    const rows = payload.items || [];
    setTenants(rows);
    const nextTenantId = tenantId || rows[0]?.id || "";
    setTenantId(nextTenantId);
    setUserTenantId((prev) => prev || nextTenantId);
    return nextTenantId;
  }

  async function loadProfiles(targetTenantId: string) {
    const params = new URLSearchParams();
    if (targetTenantId) params.set("tenantId", targetTenantId);
    params.set("activeOnly", "1");
    params.set("limit", "300");
    const res = await fetch(`/api/platform/users?${params.toString()}`);
    const payload = (await jsonSafe<{ items?: ProfileItem[] } & ErrorPayload>(res)) || {};
    if (!res.ok) throw new Error(payload.error || "Load users failed");
    const rows = payload.items || [];
    setProfiles(rows);
    setSelectedProfileId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id || ""));
  }

  async function loadFlags(targetTenantId: string) {
    if (!targetTenantId) {
      setFlags([]);
      return;
    }
    const res = await fetch(`/api/platform/feature-flags?tenantId=${encodeURIComponent(targetTenantId)}`);
    const payload = (await jsonSafe<{ items?: FlagItem[] } & ErrorPayload>(res)) || {};
    if (!res.ok) throw new Error(payload.error || "Load flags failed");
    setFlags(payload.items || []);
  }

  async function loadAudit(targetTenantId: string) {
    const qs = targetTenantId ? `?tenantId=${encodeURIComponent(targetTenantId)}&limit=30` : "?limit=30";
    const res = await fetch(`/api/platform/audit${qs}`);
    const payload = (await jsonSafe<{ items?: AuditItem[] } & ErrorPayload>(res)) || {};
    if (!res.ok) throw new Error(payload.error || "Load audit failed");
    setAudit(payload.items || []);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const targetTenantId = await loadTenants();
      await Promise.all([loadProfiles(targetTenantId), loadFlags(targetTenantId), loadAudit(targetTenantId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void Promise.all([loadProfiles(tenantId), loadFlags(tenantId), loadAudit(tenantId)]).catch((err) => {
      setError(err instanceof Error ? err.message : "Load failed");
    });
  }, [tenantId]);

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tenantName, status: tenantStatus }),
      });
      const payload = (await jsonSafe<{ tenant?: TenantItem } & ErrorPayload>(res)) || {};
      if (!res.ok) throw new Error(payload.error || "Create tenant failed");
      setTenantName("");
      setMessage(zh ? "租戶已建立" : "Tenant created");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create tenant failed");
    } finally {
      setSaving(false);
    }
  }

  async function updateTenant(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/tenants", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tenantId, name: editTenantName, status: editTenantStatus }),
      });
      const payload = (await jsonSafe<{ tenant?: TenantItem } & ErrorPayload>(res)) || {};
      if (!res.ok) throw new Error(payload.error || "Update tenant failed");
      setMessage(zh ? "租戶已更新" : "Tenant updated");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update tenant failed");
    } finally {
      setSaving(false);
    }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          role: userRole,
          tenantId: userRole === "platform_admin" ? null : userTenantId || null,
          branchId: userBranchId || null,
          displayName: userDisplayName || null,
          isActive: true,
        }),
      });
      const payload = (await jsonSafe<ErrorPayload>(res)) || {};
      if (!res.ok) throw new Error(payload.error || "Create user failed");
      setUserEmail("");
      setUserPassword("");
      setUserBranchId("");
      setUserDisplayName("");
      setMessage(zh ? "使用者已建立" : "User created");
      await loadProfiles(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create user failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfileId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfileId,
          role: editRole,
          tenantId: editRole === "platform_admin" ? null : editProfileTenantId || null,
          branchId: editProfileBranchId || null,
          displayName: editProfileDisplayName || null,
          isActive: editProfileActive,
        }),
      });
      const payload = (await jsonSafe<ErrorPayload>(res)) || {};
      if (!res.ok) throw new Error(payload.error || "Save profile failed");
      setMessage(zh ? "帳號已更新" : "Profile updated");
      await loadProfiles(tenantId);
      await loadAudit(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save profile failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveFlag(event: FormEvent) {
    event.preventDefault();
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, key: flagKey, enabled: flagEnabled }),
      });
      const payload = (await jsonSafe<ErrorPayload>(res)) || {};
      if (!res.ok) throw new Error(payload.error || "Save flag failed");
      setFlagKey("");
      setMessage(zh ? "旗標已儲存" : "Flag saved");
      await loadFlags(tenantId);
      await loadAudit(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save flag failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "平台管理" : "PLATFORM ADMIN"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>{zh ? "租戶與帳號控制台" : "Tenant and Account Console"}</h1>
          </div>
        </section>
        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="ok" style={{ marginBottom: 12 }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createTenant} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "建立租戶" : "Create Tenant"}</h2>
            <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="name" className="input" required />
            <select value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)} className="input"><option value="active">active</option><option value="suspended">suspended</option><option value="disabled">disabled</option></select>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>{zh ? "建立" : "Create"}</button>
          </form>
          <form onSubmit={updateTenant} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯租戶" : "Edit Tenant"}</h2>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="input">{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <input value={editTenantName} onChange={(e) => setEditTenantName(e.target.value)} placeholder="name" className="input" required />
            <select value={editTenantStatus} onChange={(e) => setEditTenantStatus(e.target.value)} className="input"><option value="active">active</option><option value="suspended">suspended</option><option value="disabled">disabled</option></select>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>{zh ? "儲存" : "Save"}</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={createUser} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "建立使用者" : "Create User"}</h2>
            <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="email" className="input" required />
            <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="password" className="input" required />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value as AppRole)} className="input">{["platform_admin","manager","frontdesk","coach","member"].map((r)=><option key={r} value={r}>{r}</option>)}</select>
            <input value={userTenantId} onChange={(e) => setUserTenantId(e.target.value)} placeholder="tenantId" className="input" disabled={userRole === "platform_admin"} />
            <input value={userBranchId} onChange={(e) => setUserBranchId(e.target.value)} placeholder="branchId (optional)" className="input" />
            <input value={userDisplayName} onChange={(e) => setUserDisplayName(e.target.value)} placeholder="display name (optional)" className="input" />
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={saving}>{zh ? "建立帳號" : "Create user"}</button>
          </form>
          <form onSubmit={saveProfile} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "編輯帳號" : "Edit Profile"}</h2>
            <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)} className="input">{profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.id}</option>)}</select>
            <select value={editRole} onChange={(e) => setEditRole(e.target.value as AppRole)} className="input">{["platform_admin","manager","frontdesk","coach","member"].map((r)=><option key={r} value={r}>{r}</option>)}</select>
            <input value={editProfileTenantId} onChange={(e) => setEditProfileTenantId(e.target.value)} placeholder="tenantId" className="input" disabled={editRole === "platform_admin"} />
            <input value={editProfileBranchId} onChange={(e) => setEditProfileBranchId(e.target.value)} placeholder="branchId (optional)" className="input" />
            <input value={editProfileDisplayName} onChange={(e) => setEditProfileDisplayName(e.target.value)} placeholder="display name" className="input" />
            <label className="sub"><input type="checkbox" checked={editProfileActive} onChange={(e) => setEditProfileActive(e.target.checked)} /> active</label>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving}>{zh ? "儲存帳號" : "Save profile"}</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={saveFlag} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Feature Flags</h2>
            <input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} placeholder="flag key" className="input" required />
            <label className="sub"><input type="checkbox" checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} /> enabled</label>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving || !tenantId}>Save flag</button>
            <div className="fdDataGrid" style={{ marginTop: 10 }}>{flags.map((f) => <p key={f.id} className="sub" style={{ marginTop: 0 }}>{f.key}: {f.enabled ? "ON" : "OFF"}</p>)}</div>
          </form>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "稽核記錄" : "Audit Logs"}</h2>
            <div className="fdDataGrid">{audit.map((a) => <p key={a.id} className="sub" style={{ marginTop: 0 }}>{new Date(a.created_at).toLocaleString()} | {a.action} | {a.target_type}:{a.target_id || "-"}</p>)}</div>
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="fdPillBtn" onClick={() => void loadAll()} disabled={loading}>{loading ? "Loading..." : "Reload all"}</button>
              <a className="fdPillBtn" href="/platform-admin/rbac">RBAC</a>
              <a className="fdPillBtn" href="/platform-admin/audit">Audit Explorer</a>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
