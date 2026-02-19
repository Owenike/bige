"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type ObservabilityPayload = {
  range: { since: string; until: string; hours: number };
  tenantId: string | null;
  warnings: string[];
  health: { ok: boolean; serverTime: string; uptimeSec: number | null };
  summary: {
    webhook: { received: number; processed: number; failed: number };
    notification: { total: number; sent: number; queued: number; failed: number };
    auditRows: number;
    pendingHighRiskRequests: number;
    openShifts: number;
  };
  recent: {
    failures: Array<{ id: string; source: string; status: string; detail: string; error: string | null; createdAt: string }>;
    audits: Array<{ id: string; action: string; target_type: string; created_at: string }>;
    webhooks: Array<{ id: string; provider: string; event_type: string; status: string; received_at: string }>;
    notifications: Array<{ id: string; channel: string; status: string; created_at: string }>;
  };
};

export default function PlatformObservabilityPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [hours, setHours] = useState("24");
  const [data, setData] = useState<ObservabilityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = await res.json();
    if (!res.ok) return;
    const list = (payload.items || []) as TenantItem[];
    setTenants(list);
    setTenantId((prev) => prev || list[0]?.id || "");
  }

  async function loadMetrics(nextTenantId?: string, nextHours?: string) {
    const useTenant = nextTenantId ?? tenantId;
    const useHours = nextHours ?? hours;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (useTenant) params.set("tenantId", useTenant);
      params.set("hours", useHours);
      const res = await fetch(`/api/platform/observability?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u76e3\u63a7\u5931\u6557" : "Load observability failed"));
      setData(payload as ObservabilityPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u76e3\u63a7\u5931\u6557" : "Load observability failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
    void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0 / \u7cfb\u7d71\u76e3\u63a7" : "PLATFORM / OBSERVABILITY"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u5e73\u53f0\u5065\u5eb7\u76e3\u63a7" : "Platform Health"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u76e3\u770b Webhook\u3001\u901a\u77e5\u3001\u7a3d\u6838\u6d3b\u52d5\u3001\u9ad8\u98a8\u96aa\u5f85\u5be9\u8207\u958b\u73ed\u72c0\u614b\u3002"
                : "Monitor webhooks, notifications, audit activity, pending risk actions, and open shifts."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {data?.warnings?.length ? (
          <div className="fdGlassSubPanel" style={{ padding: 12, marginBottom: 12 }}>
            {data.warnings.map((item) => (
              <p key={item} className="sub" style={{ marginTop: 0 }}>{item}</p>
            ))}
          </div>
        ) : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7be9\u9078" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              <option value="">{zh ? "\u5168\u90e8\u79df\u6236/\u7576\u524d\u79df\u6236" : "All / current tenant"}</option>
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input className="input" value={hours} onChange={(event) => setHours(event.target.value)} placeholder={zh ? "\u7d71\u8a08\u5c0f\u6642" : "hours"} />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadMetrics()} disabled={loading}>
              {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : (zh ? "\u66f4\u65b0" : "Refresh")}
            </button>
          </div>
        </section>

        <section className="fdInventorySummary" style={{ marginTop: 14 }}>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "Webhook \u5931\u6557" : "Webhook Failed"}</div>
            <strong className="fdInventorySummaryValue">{data?.summary.webhook.failed ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u901a\u77e5\u5931\u6557" : "Notification Failed"}</div>
            <strong className="fdInventorySummaryValue">{data?.summary.notification.failed ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u9ad8\u98a8\u96aa\u5f85\u5be9" : "Pending High-Risk"}</div>
            <strong className="fdInventorySummaryValue">{data?.summary.pendingHighRiskRequests ?? "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u958b\u73ed\u4e2d\u73ed\u6b21" : "Open Shifts"}</div>
            <strong className="fdInventorySummaryValue">{data?.summary.openShifts ?? "-"}</strong>
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u6700\u65b0\u5931\u6557\u4e8b\u4ef6" : "Recent Failures"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {(data?.recent.failures || []).map((item) => (
                <p key={`${item.source}-${item.id}`} className="sub" style={{ marginTop: 0 }}>
                  {new Date(item.createdAt).toLocaleString()} | {item.source} | {item.detail} | {item.error || "-"}
                </p>
              ))}
              {!loading && (data?.recent.failures || []).length === 0 ? (
                <p className="fdGlassText">{zh ? "\u76ee\u524d\u6c92\u6709\u5931\u6557\u8a18\u9304\u3002" : "No recent failures."}</p>
              ) : null}
            </div>
          </section>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u6700\u65b0\u7a3d\u6838\u6d3b\u52d5" : "Recent Audit Activity"}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {(data?.recent.audits || []).map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  {new Date(item.created_at).toLocaleString()} | {item.action} | {item.target_type}
                </p>
              ))}
              {!loading && (data?.recent.audits || []).length === 0 ? (
                <p className="fdGlassText">{zh ? "\u76ee\u524d\u6c92\u6709\u7a3d\u6838\u8a18\u9304\u3002" : "No audit activity found."}</p>
              ) : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u5065\u5eb7\u8cc7\u8a0a" : "Health Snapshot"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            <p className="sub" style={{ marginTop: 0 }}>OK: {String(data?.health.ok ?? false)}</p>
            <p className="sub" style={{ marginTop: 0 }}>
              {zh ? "\u4f3a\u670d\u5668\u6642\u9593" : "Server Time"}: {data?.health.serverTime ? new Date(data.health.serverTime).toLocaleString() : "-"}
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              uptime: {data?.health.uptimeSec ?? "-"} sec
            </p>
            <p className="sub" style={{ marginTop: 0 }}>
              {zh ? "\u7d71\u8a08\u671f\u9593" : "Window"}: {data?.range.since ? new Date(data.range.since).toLocaleString() : "-"} - {data?.range.until ? new Date(data.range.until).toLocaleString() : "-"}
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
