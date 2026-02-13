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
    setError(null);
    const tenantsRes = await fetch("/api/platform/tenants");
    const tenantsPayload = await tenantsRes.json();
    if (!tenantsRes.ok) {
      setError(tenantsPayload?.error || "Load tenants failed");
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
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createTenant(event: FormEvent) {
    event.preventDefault();
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
    await load();
  }

  async function upsertFlag(event: FormEvent) {
    event.preventDefault();
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
    await load();
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError(null);

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
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Platform Admin</h1>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

        <section>
          <h2>Create Tenant</h2>
          <form onSubmit={createTenant}>
            <p><input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="tenant name" required /></p>
            <p>
              <select value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)}>
                <option value="active">active</option>
                <option value="suspended">suspended</option>
                <option value="disabled">disabled</option>
              </select>
            </p>
            <button type="submit">Create Tenant</button>
          </form>
        </section>

        <section>
          <h2>Create User</h2>
          <form onSubmit={createUser}>
            <p><input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="email" required /></p>
            <p><input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="password" required /></p>
            <p>
              <select value={userRole} onChange={(e) => setUserRole(e.target.value)}>
                <option value="platform_admin">platform_admin</option>
                <option value="manager">manager</option>
                <option value="frontdesk">frontdesk</option>
                <option value="coach">coach</option>
                <option value="member">member</option>
              </select>
            </p>
            <p>
              <input
                value={userTenantId}
                onChange={(e) => setUserTenantId(e.target.value)}
                placeholder="tenantId (required unless platform_admin)"
                disabled={userRole === "platform_admin"}
              />
            </p>
            <p>
              <input value={userBranchId} onChange={(e) => setUserBranchId(e.target.value)} placeholder="branchId (optional)" />
            </p>
            <p>
              <input value={userDisplayName} onChange={(e) => setUserDisplayName(e.target.value)} placeholder="display name (optional)" />
            </p>
            {userRole === "member" ? (
              <>
                <p>
                  <label>
                    <input type="checkbox" checked={createMember} onChange={(e) => setCreateMember(e.target.checked)} /> create members row
                  </label>
                </p>
                {createMember ? (
                  <>
                    <p><input value={memberFullName} onChange={(e) => setMemberFullName(e.target.value)} placeholder="member full name" required /></p>
                    <p><input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} placeholder="member phone (optional)" /></p>
                  </>
                ) : null}
              </>
            ) : null}
            <button type="submit">Create User</button>
          </form>
        </section>

        <section>
          <h2>Profiles (Selected Tenant)</h2>
          <ul>
            {profiles.map((p) => (
              <li key={p.id}>
                {p.role} | {p.display_name || "-"} | {p.id}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Feature Flags</h2>
          <p>
            <select value={tenantIdForFlags} onChange={(e) => setTenantIdForFlags(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.status})
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>Load</button>
          </p>
          <form onSubmit={upsertFlag}>
            <p><input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} placeholder="flag key" required /></p>
            <p><label><input type="checkbox" checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} /> enabled</label></p>
            <button type="submit">Save Flag</button>
          </form>
          <ul>
            {flags.map((flag) => (
              <li key={flag.id}>
                {flag.key}: {flag.enabled ? "on" : "off"}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Audit (Selected Tenant)</h2>
          <ul>
            {audit.map((row) => (
              <li key={row.id}>
                {row.action}
                {" -> "}
                {row.target_type}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
