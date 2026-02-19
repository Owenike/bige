"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type ProfileItem = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  role: "platform_admin" | "manager" | "frontdesk" | "coach" | "member";
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

const ROLES: Array<ProfileItem["role"]> = ["platform_admin", "manager", "frontdesk", "coach", "member"];

export default function PlatformRbacPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [role, setRole] = useState<ProfileItem["role"]>("manager");
  const [targetTenantId, setTargetTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [query, setQuery] = useState("");

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u79df\u6236\u5931\u6557" : "Load tenants failed"));
    const list = (payload.items || []) as TenantItem[];
    setTenants(list);
    setTenantId((prev) => prev || list[0]?.id || "");
  }

  async function loadProfiles(nextTenantId?: string) {
    const target = nextTenantId ?? tenantId;
    const params = new URLSearchParams();
    if (target) params.set("tenantId", target);
    if (roleFilter !== "all") params.set("role", roleFilter);
    if (activeOnly) params.set("activeOnly", "1");
    if (query.trim()) params.set("q", query.trim());
    params.set("limit", "300");
    const res = await fetch(`/api/platform/users?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u5e33\u865f\u5931\u6557" : "Load users failed"));
    const list = (payload.items || []) as ProfileItem[];
    setProfiles(list);
    setSelectedProfileId((prev) => {
      if (prev && list.some((item) => item.id === prev)) return prev;
      return list[0]?.id || "";
    });
  }

  async function load(nextTenantId?: string) {
    setLoading(true);
    setError(null);
    try {
      if (tenants.length === 0) {
        await loadTenants();
      }
      await loadProfiles(nextTenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u5931\u6557" : "Load failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    void loadProfiles(tenantId).catch((err) => {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u5e33\u865f\u5931\u6557" : "Load users failed"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, roleFilter, activeOnly]);

  const selectedProfile = useMemo(
    () => profiles.find((item) => item.id === selectedProfileId) || null,
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    if (!selectedProfile) return;
    setRole(selectedProfile.role);
    setTargetTenantId(selectedProfile.tenant_id || "");
    setBranchId(selectedProfile.branch_id || "");
    setDisplayName(selectedProfile.display_name || "");
    setIsActive(selectedProfile.is_active);
  }, [selectedProfile]);

  const roleSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of profiles) {
      map.set(item.role, (map.get(item.role) || 0) + 1);
    }
    return ROLES.map((roleKey) => ({ role: roleKey, count: map.get(roleKey) || 0 }));
  }, [profiles]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfileId) {
      setError(zh ? "\u8acb\u5148\u9078\u64c7\u5e33\u865f" : "Please select a profile first");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/platform/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfileId,
          role,
          tenantId: role === "platform_admin" ? null : targetTenantId || null,
          branchId: branchId || null,
          displayName: displayName || null,
          isActive,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u66f4\u65b0\u5931\u6557" : "Update failed"));
      setMessage(`${zh ? "\u5df2\u66f4\u65b0\u5e33\u865f" : "Profile updated"}: ${payload.profile?.id || selectedProfileId}`);
      await loadProfiles(tenantId);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u66f4\u65b0\u5931\u6557" : "Update failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0 / \u6b0a\u9650\u6cbb\u7406" : "PLATFORM / RBAC"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u89d2\u8272\u8207\u5e33\u865f\u6cbb\u7406" : "Role Governance"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u7ba1\u7406\u4f7f\u7528\u8005\u89d2\u8272\u3001\u79df\u6236/\u5206\u9928\u7bc4\u570d\u8207\u555f\u7528\u72c0\u614b\u3002"
                : "Manage user role, tenant/branch scope, and active state from one place."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u79df\u6236\u7bc4\u570d" : "Tenant Scope"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.status})
                </option>
              ))}
            </select>
            <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading}>
              {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : (zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload")}
            </button>
            <a className="fdPillBtn" href="/platform-admin">
              {zh ? "\u5efa\u7acb\u65b0\u5e33\u865f" : "Create User"}
            </a>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">{zh ? "\u5168\u90e8\u89d2\u8272" : "all roles"}</option>
              {ROLES.map((roleItem) => (
                <option key={roleItem} value={roleItem}>{roleItem}</option>
              ))}
            </select>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={zh ? "\u986f\u793a\u540d\u7a31 / ID" : "display name / id"}
            />
            <label className="sub">
              <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /> {zh ? "\u50c5\u555f\u7528" : "activeOnly"}
            </label>
            <button type="button" className="fdPillBtn" onClick={() => void loadProfiles(tenantId)} disabled={loading}>
              {zh ? "\u5957\u7528\u7be9\u9078" : "Apply"}
            </button>
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5e33\u865f\u6e05\u55ae" : "Profiles"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {profiles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="fdPillBtn"
                  style={{
                    justifyContent: "space-between",
                    borderColor: selectedProfileId === item.id ? "rgba(34,184,166,.45)" : undefined,
                  }}
                  onClick={() => setSelectedProfileId(item.id)}
                >
                  <span>{item.display_name || item.id.slice(0, 8)}</span>
                  <span>{item.role}</span>
                </button>
              ))}
              {!loading && profiles.length === 0 ? <p className="fdGlassText">{zh ? "\u6c92\u6709\u5e33\u865f" : "No profiles found."}</p> : null}
            </div>
          </section>

          <form onSubmit={saveProfile} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u5e33\u865f\u8a2d\u5b9a" : "Profile Editor"}</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <input className="input" value={selectedProfileId} readOnly />
              <select className="input" value={role} onChange={(event) => setRole(event.target.value as ProfileItem["role"])} disabled={!selectedProfile}>
                {ROLES.map((roleItem) => (
                  <option key={roleItem} value={roleItem}>{roleItem}</option>
                ))}
              </select>
              <input
                className="input"
                value={targetTenantId}
                onChange={(event) => setTargetTenantId(event.target.value)}
                placeholder={zh ? "\u79df\u6236 ID" : "tenantId"}
                disabled={!selectedProfile || role === "platform_admin"}
              />
              <input
                className="input"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                placeholder={zh ? "\u5206\u9928 ID (\u9078\u586b)" : "branchId (optional)"}
                disabled={!selectedProfile}
              />
              <input
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={zh ? "\u986f\u793a\u540d\u7a31" : "display name"}
                disabled={!selectedProfile}
              />
              <label className="sub">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={!selectedProfile} />
                {" "}
                {zh ? "\u555f\u7528\u5e33\u865f" : "Active"}
              </label>
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={saving || !selectedProfile}>
              {saving ? (zh ? "\u5132\u5b58\u4e2d..." : "Saving...") : (zh ? "\u5132\u5b58\u8b8a\u66f4" : "Save Changes")}
            </button>
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u89d2\u8272\u5206\u4f48" : "Role Distribution"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            {roleSummary.map((item) => (
              <span key={item.role} className="fdChip">{item.role}: {item.count}</span>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
