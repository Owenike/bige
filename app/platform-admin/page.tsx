"use client";

import { FormEvent, useEffect, useState } from "react";

interface TenantItem {
  id: string;
  name: string;
  status: string;
}

interface FlagItem {
  id: string;
  key: string;
  enabled: boolean;
  tenant_id: string;
}

export default function PlatformAdminPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; target_type: string }>>([]);
  const [profiles, setProfiles] = useState<Array<{ id: string; role: string; tenant_id: string | null; display_name: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [tenantName, setTenantName] = useState("");
  const [tenantStatus, setTenantStatus] = useState("active");
  const [tenantIdForFlags, setTenantIdForFlags] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);

  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState("manager");
  const [userTenantId, setUserTenantId] = useState("");
  const [userBranchId, setUserBranchId] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [createMember, setCreateMember] = useState(false);
  const [memberFullName, setMemberFullName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    const tenantsRes = await fetch("/api/platform/tenants");
    const tenantsPayload = await tenantsRes.json();
    if (!tenantsRes.ok) {
      setError(tenantsPayload?.error || "Load tenants failed");
      setLoading(false);
      return;
    }

    const list = (tenantsPayload.items || []) as TenantItem[];
    setTenants(list);
    const selectedTenantId = tenantIdForFlags || list[0]?.id || "";

    if (selectedTenantId) {
      const [flagsRes, auditRes, profilesRes] = await Promise.all([
        fetch(`/api/platform/feature-flags?tenantId=${encodeURIComponent(selectedTenantId)}`),
        fetch(`/api/platform/audit?tenantId=${encodeURIComponent(selectedTenantId)}&limit=20`),
        fetch(`/api/platform/users?tenantId=${encodeURIComponent(selectedTenantId)}`),
      ]);
      const flagsPayload = await flagsRes.json();
      const auditPayload = await auditRes.json();
      const profilesPayload = await profilesRes.json();
      if (flagsRes.ok) setFlags(flagsPayload.items || []);
      if (auditRes.ok) setAudit(auditPayload.items || []);
      if (profilesRes.ok) setProfiles(profilesPayload.items || []);
      if (!flagsRes.ok) setError(flagsPayload?.error || "Load flags failed");
      if (!auditRes.ok) setError(auditPayload?.error || "Load audit failed");
      if (!profilesRes.ok) setError(profilesPayload?.error || "Load users failed");
      setTenantIdForFlags(selectedTenantId);
      if (!userTenantId) setUserTenantId(selectedTenantId);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch("/api/platform/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tenantName, status: tenantStatus }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Create tenant failed");
      return;
    }
    setTenantName("");
    setMessage(`Tenant created: ${payload.tenant?.name || "success"}`);
    await load();
  }

  async function upsertFlag(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch("/api/platform/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: tenantIdForFlags,
        key: flagKey,
        enabled: flagEnabled,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Update flag failed");
      return;
    }
    setFlagKey("");
    setMessage(`Flag saved: ${payload.flag?.key || "success"}`);
    await load();
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const res = await fetch("/api/platform/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        password: userPassword,
        role: userRole,
        tenantId: userRole === "platform_admin" ? null : userTenantId,
        branchId: userBranchId || null,
        displayName: userDisplayName || null,
        isActive: true,
        createMember: createMember && userRole === "member",
        memberFullName: memberFullName || null,
        memberPhone: memberPhone || null,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Create user failed");
      return;
    }
    setUserEmail("");
    setUserPassword("");
    setUserDisplayName("");
    setCreateMember(false);
    setMemberFullName("");
    setMemberPhone("");
    setMessage(`User created: ${payload.profile?.id || "success"}`);
    await load();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PLATFORM ADMIN</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Tenant and User Control
            </h1>
            <p className="fdGlassText">Create tenants, provision accounts, and manage feature flags with audit visibility.</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createTenant} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create Tenant</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="tenant name" className="input" required />
              <select value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)} className="input">
                <option value="active">active</option>
                <option value="suspended">suspended</option>
                <option value="disabled">disabled</option>
              </select>
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }}>Create Tenant</button>
          </form>

          <form onSubmit={createUser} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create User</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="email" className="input" required />
              <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="password" className="input" required />
              <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="input">
                <option value="platform_admin">platform_admin</option>
                <option value="manager">manager</option>
                <option value="frontdesk">frontdesk</option>
                <option value="coach">coach</option>
                <option value="member">member</option>
              </select>
              <input
                value={userTenantId}
                onChange={(e) => setUserTenantId(e.target.value)}
                placeholder="tenantId (required unless platform_admin)"
                className="input"
                disabled={userRole === "platform_admin"}
              />
              <input value={userBranchId} onChange={(e) => setUserBranchId(e.target.value)} placeholder="branchId (optional)" className="input" />
              <input value={userDisplayName} onChange={(e) => setUserDisplayName(e.target.value)} placeholder="display name (optional)" className="input" />
              {userRole === "member" ? (
                <>
                  <label className="sub">
                    <input type="checkbox" checked={createMember} onChange={(e) => setCreateMember(e.target.checked)} /> create members row
                  </label>
                  {createMember ? (
                    <>
                      <input value={memberFullName} onChange={(e) => setMemberFullName(e.target.value)} placeholder="member full name" className="input" required />
                      <input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} placeholder="member phone (optional)" className="input" />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>Create User</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Feature Flags</h2>
            <div className="actions" style={{ marginTop: 8 }}>
              <select value={tenantIdForFlags} onChange={(e) => setTenantIdForFlags(e.target.value)} className="input">
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.status})
                  </option>
                ))}
              </select>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? "Loading..." : "Load"}
              </button>
            </div>
            <form onSubmit={upsertFlag} style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} placeholder="flag key" className="input" required />
                <label className="sub">
                  <input type="checkbox" checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} /> enabled
                </label>
              </div>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }}>Save Flag</button>
            </form>
            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              {flags.map((flag) => (
                <p key={flag.id} className="sub" style={{ marginTop: 0 }}>
                  {flag.key}: {flag.enabled ? "on" : "off"}
                </p>
              ))}
              {flags.length === 0 ? <p className="fdGlassText">No flags found.</p> : null}
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Profiles (Selected Tenant)</h2>
            <div className="fdDataGrid">
              {profiles.map((p) => (
                <p key={p.id} className="sub" style={{ marginTop: 0 }}>
                  {p.role} | {p.display_name || "-"} | {p.id}
                </p>
              ))}
              {profiles.length === 0 ? <p className="fdGlassText">No profiles found.</p> : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Audit (Selected Tenant)</h2>
          <div className="fdDataGrid">
            {audit.map((row) => (
              <p key={row.id} className="sub" style={{ marginTop: 0 }}>
                {row.action} {"->"} {row.target_type}
              </p>
            ))}
            {audit.length === 0 ? <p className="fdGlassText">No audit rows found.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
