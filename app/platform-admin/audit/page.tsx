"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type AuditItem = {
  id: string;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export default function PlatformAuditPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [limit, setLimit] = useState("100");
  const [items, setItems] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = await res.json();
    if (!res.ok) return; // managers may not have tenant list
    const list = (payload.items || []) as TenantItem[];
    setTenants(list);
    setTenantId((prev) => prev || list[0]?.id || "");
  }

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tenantId) params.set("tenantId", tenantId);
      if (action.trim()) params.set("action", action.trim());
      if (targetType.trim()) params.set("targetType", targetType.trim());
      params.set("limit", limit);
      const res = await fetch(`/api/platform/audit?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u7a3d\u6838\u5931\u6557" : "Load audit failed"));
      setItems((payload.items || []) as AuditItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u7a3d\u6838\u5931\u6557" : "Load audit failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitFilter(event: FormEvent) {
    event.preventDefault();
    await loadAudit();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0 / \u7a3d\u6838\u4e2d\u5fc3" : "PLATFORM / AUDIT CENTER"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u7a3d\u6838\u8a18\u9304\u67e5\u8a62" : "Audit Explorer"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u4f9d\u79df\u6236\u3001\u884c\u70ba\u3001\u76ee\u6a19\u985e\u578b\u7be9\u9078\u7a3d\u6838\u8cc7\u6599\u3002"
                : "Filter audit trails by tenant, action, and target type."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <form onSubmit={submitFilter} className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7be9\u9078\u689d\u4ef6" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              <option value="">{zh ? "\u5168\u90e8\u79df\u6236/\u7576\u524d\u79df\u6236" : "All / current tenant"}</option>
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input className="input" value={action} onChange={(event) => setAction(event.target.value)} placeholder={zh ? "\u884c\u70ba action" : "action"} />
            <input className="input" value={targetType} onChange={(event) => setTargetType(event.target.value)} placeholder={zh ? "\u76ee\u6a19\u985e\u578b targetType" : "targetType"} />
            <input className="input" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="limit" />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={loading}>
              {loading ? (zh ? "\u67e5\u8a62\u4e2d..." : "Loading...") : (zh ? "\u67e5\u8a62" : "Run")}
            </button>
          </div>
        </form>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u8a18\u9304\u5217\u8868" : "Logs"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {items.map((item) => (
              <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  <strong>{item.action}</strong> | {item.target_type}:{item.target_id || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  tenant: {item.tenant_id || "-"} | actor: {item.actor_id || "-"}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {new Date(item.created_at).toLocaleString()}
                </p>
                {item.reason ? <p className="sub" style={{ marginTop: 0 }}>{item.reason}</p> : null}
                {item.payload ? (
                  <pre className="sub" style={{ marginTop: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
            {!loading && items.length === 0 ? (
              <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u7b26\u5408\u689d\u4ef6\u7684\u7a3d\u6838\u8cc7\u6599\u3002" : "No audit rows found."}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
