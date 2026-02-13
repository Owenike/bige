"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n-provider";

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
  const { locale } = useI18n();
  const zh = locale !== "en";
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

  function tenantStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "active") return "\u555f\u7528\u4e2d";
    if (status === "suspended") return "\u5df2\u6697\u505c";
    if (status === "disabled") return "\u5df2\u505c\u7528";
    return status;
  }

  function roleLabel(role: string) {
    if (!zh) return role;
    if (role === "platform_admin") return "\u5e73\u53f0\u7ba1\u7406\u54e1";
    if (role === "manager") return "\u7ba1\u7406\u8005";
    if (role === "frontdesk") return "\u6ac3\u6aaf";
    if (role === "coach") return "\u6559\u7df4";
    if (role === "member") return "\u6703\u54e1";
    return role;
  }

  function auditActionLabel(action: string) {
    if (!zh) return action;
    if (action === "tenant_created") return "\u79df\u6236\u5efa\u7acb";
    if (action === "feature_flag_updated") return "\u65d7\u6a19\u66f4\u65b0";
    if (action === "user_created") return "\u4f7f\u7528\u8005\u5efa\u7acb";
    return action;
  }

  function auditTargetLabel(target: string) {
    if (!zh) return target;
    if (target === "tenant") return "\u79df\u6236";
    if (target === "feature_flag") return "\u65d7\u6a19";
    if (target === "profile") return "\u5e33\u865f";
    return target;
  }

  async function load() {
    setLoading(true);
    setError(null);
    const tenantsRes = await fetch("/api/platform/tenants");
    const tenantsPayload = await tenantsRes.json();
    if (!tenantsRes.ok) {
      setError(tenantsPayload?.error || (zh ? "\u8f09\u5165\u79df\u6236\u5931\u6557" : "Load tenants failed"));
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
      if (!flagsRes.ok) setError(flagsPayload?.error || (zh ? "\u8f09\u5165\u529f\u80fd\u65d7\u6a19\u5931\u6557" : "Load flags failed"));
      if (!auditRes.ok) setError(auditPayload?.error || (zh ? "\u8f09\u5165\u7a3d\u6838\u5931\u6557" : "Load audit failed"));
      if (!profilesRes.ok) setError(profilesPayload?.error || (zh ? "\u8f09\u5165\u4f7f\u7528\u8005\u5931\u6557" : "Load users failed"));
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
      setError(payload?.error || (zh ? "\u5efa\u7acb\u79df\u6236\u5931\u6557" : "Create tenant failed"));
      return;
    }
    setTenantName("");
    setMessage(`${zh ? "\u79df\u6236\u5df2\u5efa\u7acb" : "Tenant created"}: ${payload.tenant?.name || "success"}`);
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
      setError(payload?.error || (zh ? "\u66f4\u65b0\u65d7\u6a19\u5931\u6557" : "Update flag failed"));
      return;
    }
    setFlagKey("");
    setMessage(`${zh ? "\u65d7\u6a19\u5df2\u5132\u5b58" : "Flag saved"}: ${payload.flag?.key || "success"}`);
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
      setError(payload?.error || (zh ? "\u5efa\u7acb\u4f7f\u7528\u8005\u5931\u6557" : "Create user failed"));
      return;
    }
    setUserEmail("");
    setUserPassword("");
    setUserDisplayName("");
    setCreateMember(false);
    setMemberFullName("");
    setMemberPhone("");
    setMessage(`${zh ? "\u4f7f\u7528\u8005\u5df2\u5efa\u7acb" : "User created"}: ${payload.profile?.id || "success"}`);
    await load();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0\u7ba1\u7406" : "PLATFORM ADMIN"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u79df\u6236\u8207\u4f7f\u7528\u8005\u63a7\u5236" : "Tenant and User Control"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5efa\u7acb\u79df\u6236\u3001\u958b\u7acb\u5e33\u865f\u3001\u7ba1\u7406\u529f\u80fd\u65d7\u6a19\uff0c\u4e26\u641c\u8996\u7a3d\u6838\u8a18\u9304\u3002"
                : "Create tenants, provision accounts, and manage feature flags with audit visibility."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createTenant} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5efa\u7acb\u79df\u6236" : "Create Tenant"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder={zh ? "\u79df\u6236\u540d\u7a31" : "tenant name"} className="input" required />
              <select value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)} className="input">
                <option value="active">{tenantStatusLabel("active")}</option>
                <option value="suspended">{tenantStatusLabel("suspended")}</option>
                <option value="disabled">{tenantStatusLabel("disabled")}</option>
              </select>
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }}>{zh ? "\u5efa\u7acb\u79df\u6236" : "Create Tenant"}</button>
          </form>

          <form onSubmit={createUser} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5efa\u7acb\u4f7f\u7528\u8005" : "Create User"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder={zh ? "\u4fe1\u7bb1" : "email"} className="input" required />
              <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder={zh ? "\u5bc6\u78bc" : "password"} className="input" required />
              <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="input">
                <option value="platform_admin">{roleLabel("platform_admin")}</option>
                <option value="manager">{roleLabel("manager")}</option>
                <option value="frontdesk">{roleLabel("frontdesk")}</option>
                <option value="coach">{roleLabel("coach")}</option>
                <option value="member">{roleLabel("member")}</option>
              </select>
              <input
                value={userTenantId}
                onChange={(e) => setUserTenantId(e.target.value)}
                placeholder={zh ? "\u79df\u6236\u7de8\u865f\uff08\u5e73\u53f0\u7ba1\u7406\u54e1\u53ef\u4e0d\u586b\uff09" : "tenantId (required unless platform_admin)"}
                className="input"
                disabled={userRole === "platform_admin"}
              />
              <input value={userBranchId} onChange={(e) => setUserBranchId(e.target.value)} placeholder={zh ? "\u5206\u9928\u7de8\u865f\uff08\u9078\u586b\uff09" : "branchId (optional)"} className="input" />
              <input value={userDisplayName} onChange={(e) => setUserDisplayName(e.target.value)} placeholder={zh ? "\u986f\u793a\u540d\u7a31\uff08\u9078\u586b\uff09" : "display name (optional)"} className="input" />
              {userRole === "member" ? (
                <>
                  <label className="sub">
                    <input type="checkbox" checked={createMember} onChange={(e) => setCreateMember(e.target.checked)} /> {zh ? "\u540c\u6b65\u5efa\u7acb\u6703\u54e1\u8cc7\u6599\u5217" : "create members row"}
                  </label>
                  {createMember ? (
                    <>
                      <input value={memberFullName} onChange={(e) => setMemberFullName(e.target.value)} placeholder={zh ? "\u6703\u54e1\u5168\u540d" : "member full name"} className="input" required />
                      <input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} placeholder={zh ? "\u6703\u54e1\u96fb\u8a71\uff08\u9078\u586b\uff09" : "member phone (optional)"} className="input" />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u5efa\u7acb\u4f7f\u7528\u8005" : "Create User"}</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u529f\u80fd\u65d7\u6a19" : "Feature Flags"}</h2>
            <div className="actions" style={{ marginTop: 8 }}>
              <select value={tenantIdForFlags} onChange={(e) => setTenantIdForFlags(e.target.value)} className="input">
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({tenantStatusLabel(t.status)})
                  </option>
                ))}
              </select>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
                {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : zh ? "\u8f09\u5165" : "Load"}
              </button>
            </div>
            <form onSubmit={upsertFlag} style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} placeholder={zh ? "\u65d7\u6a19\u9375\u503c" : "flag key"} className="input" required />
                <label className="sub">
                  <input type="checkbox" checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} /> {zh ? "\u555f\u7528" : "enabled"}
                </label>
              </div>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }}>{zh ? "\u5132\u5b58\u65d7\u6a19" : "Save Flag"}</button>
            </form>
            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              {flags.map((flag) => (
                <p key={flag.id} className="sub" style={{ marginTop: 0 }}>
                  {flag.key}: {flag.enabled ? (zh ? "\u958b" : "on") : zh ? "\u95dc" : "off"}
                </p>
              ))}
              {flags.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u65d7\u6a19\u3002" : "No flags found."}</p> : null}
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u79df\u6236\u5e33\u865f\u6e05\u55ae" : "Profiles (Selected Tenant)"}</h2>
            <div className="fdDataGrid">
              {profiles.map((p) => (
                <p key={p.id} className="sub" style={{ marginTop: 0 }}>
                  {roleLabel(p.role)} | {p.display_name || "-"} | {p.id}
                </p>
              ))}
              {profiles.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u5e33\u865f\u8cc7\u6599\u3002" : "No profiles found."}</p> : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7a3d\u6838\u8a18\u9304\uff08\u79df\u6236\uff09" : "Audit (Selected Tenant)"}</h2>
          <div className="fdDataGrid">
            {audit.map((row) => (
                <p key={row.id} className="sub" style={{ marginTop: 0 }}>
                {auditActionLabel(row.action)} {"->"} {auditTargetLabel(row.target_type)}
                </p>
              ))}
            {audit.length === 0 ? <p className="fdGlassText">{zh ? "\u7121\u7a3d\u6838\u8cc7\u6599\u3002" : "No audit rows found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
