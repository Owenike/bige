"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type FlagItem = {
  id: string;
  tenant_id: string;
  key: string;
  enabled: boolean;
  updated_at: string;
};

export default function PlatformFeatureFlagsPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = await res.json();
    if (!res.ok) {
      // Managers may not have tenant list permission; keep empty and use own context.
      if (res.status === 403) return;
      throw new Error(payload?.error || (zh ? "\u8f09\u5165\u79df\u6236\u5931\u6557" : "Load tenants failed"));
    }
    const list = (payload.items || []) as TenantItem[];
    setTenants(list);
    setTenantId((prev) => prev || list[0]?.id || "");
  }

  async function loadFlags(nextTenantId?: string) {
    const target = nextTenantId ?? tenantId;
    const qs = target ? `?tenantId=${encodeURIComponent(target)}` : "";
    const res = await fetch(`/api/platform/feature-flags${qs}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u65d7\u6a19\u5931\u6557" : "Load flags failed"));
    setFlags((payload.items || []) as FlagItem[]);
  }

  async function load(nextTenantId?: string) {
    setLoading(true);
    setError(null);
    try {
      if (tenants.length === 0) {
        await loadTenants();
      }
      await loadFlags(nextTenantId);
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
    void loadFlags(tenantId).catch((err) => {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u65d7\u6a19\u5931\u6557" : "Load flags failed"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function upsertFlag(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/platform/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          key: flagKey.trim(),
          enabled: flagEnabled,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u5132\u5b58\u5931\u6557" : "Save failed"));
      setFlagKey("");
      setMessage(`${zh ? "\u5df2\u5132\u5b58\u65d7\u6a19" : "Flag saved"}: ${payload.flag?.key || "-"}`);
      await loadFlags();
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u5132\u5b58\u5931\u6557" : "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(item: FlagItem) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/platform/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: item.tenant_id,
          key: item.key,
          enabled: !item.enabled,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u5207\u63db\u5931\u6557" : "Toggle failed"));
      setMessage(`${item.key}: ${!item.enabled ? "on" : "off"}`);
      await loadFlags();
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u5207\u63db\u5931\u6557" : "Toggle failed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteFlag(item: FlagItem) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/platform/feature-flags?tenantId=${encodeURIComponent(item.tenant_id)}&key=${encodeURIComponent(item.key)}`, {
        method: "DELETE",
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u522a\u9664\u5931\u6557" : "Delete failed"));
      setMessage(`${zh ? "\u5df2\u522a\u9664" : "Deleted"}: ${item.key}`);
      await loadFlags();
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u522a\u9664\u5931\u6557" : "Delete failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0 / \u529f\u80fd\u65d7\u6a19" : "PLATFORM / FEATURE FLAGS"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "Feature Flag \u7ba1\u7406" : "Feature Flag Control"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u4ee5\u79df\u6236\u70ba\u55ae\u4f4d\u7ba1\u7406\u529f\u80fd\u958b\u95dc\uff0c\u652f\u63f4\u5feb\u901f\u555f\u7528/\u95dc\u9589\u8207\u522a\u9664\u3002"
                : "Manage per-tenant feature rollouts with quick enable/disable and delete actions."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u65b0\u589e / \u66f4\u65b0\u65d7\u6a19" : "Upsert Flag"}</h2>
          <form onSubmit={upsertFlag}>
            <div className="actions" style={{ marginTop: 8 }}>
              <select
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                className="input"
                disabled={saving || tenants.length === 0}
              >
                {tenants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.status})
                  </option>
                ))}
                {tenants.length === 0 ? (
                  <option value="">{zh ? "\u4f7f\u7528\u7576\u524d\u79df\u6236" : "Use current tenant context"}</option>
                ) : null}
              </select>
              <input
                className="input"
                value={flagKey}
                onChange={(event) => setFlagKey(event.target.value)}
                placeholder={zh ? "\u65d7\u6a19 Key" : "Flag key"}
                required
              />
              <label className="sub">
                <input
                  type="checkbox"
                  checked={flagEnabled}
                  onChange={(event) => setFlagEnabled(event.target.checked)}
                />
                {" "}
                {zh ? "\u555f\u7528" : "Enabled"}
              </label>
              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={saving}>
                {saving ? (zh ? "\u5132\u5b58\u4e2d..." : "Saving...") : (zh ? "\u5132\u5b58" : "Save")}
              </button>
              <button type="button" className="fdPillBtn" onClick={() => void load()} disabled={loading || saving}>
                {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : (zh ? "\u91cd\u65b0\u8f09\u5165" : "Reload")}
              </button>
            </div>
          </form>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u65d7\u6a19\u6e05\u55ae" : "Flags"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {flags.map((item) => (
              <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}><strong>{item.key}</strong></p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u72c0\u614b" : "Status"}: {item.enabled ? "ON" : "OFF"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u66f4\u65b0\u6642\u9593" : "Updated"}: {new Date(item.updated_at).toLocaleString()}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  <button type="button" className="fdPillBtn" onClick={() => void quickToggle(item)} disabled={saving}>
                    {item.enabled ? (zh ? "\u95dc\u9589" : "Turn Off") : (zh ? "\u958b\u555f" : "Turn On")}
                  </button>
                  <button type="button" className="fdPillBtn" onClick={() => void deleteFlag(item)} disabled={saving}>
                    {zh ? "\u522a\u9664" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
            {!loading && flags.length === 0 ? (
              <p className="fdGlassText">{zh ? "\u76ee\u524d\u6c92\u6709\u65d7\u6a19\u8cc7\u6599\u3002" : "No flags found."}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
