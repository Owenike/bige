"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../i18n-provider";

type TenantItem = {
  id: string;
  name: string;
  status: string;
};

type BillingItem = {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  paidAmount: number;
  refundedAmount: number;
  netAmount: number;
  paidPayments: number;
  refundedPayments: number;
  ordersPaid: number;
  ordersPending: number;
  activeSubscriptions: number;
  expiringIn14Days: number;
  collectionRate: number;
};

type BillingPayload = {
  range: { since: string; until: string; days: number };
  items: BillingItem[];
  totals: {
    paidAmount: number;
    refundedAmount: number;
    netAmount: number;
    paidPayments: number;
    refundedPayments: number;
    activeSubscriptions: number;
    expiringIn14Days: number;
  };
  expiring: Array<{
    tenantId: string;
    tenantName: string;
    memberId: string;
    memberName: string;
    validTo: string | null;
  }>;
};

export default function PlatformBillingPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [days, setDays] = useState("30");
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadTenants() {
    const res = await fetch("/api/platform/tenants");
    const payload = await res.json();
    if (!res.ok) return; // manager may not have this endpoint
    const list = (payload.items || []) as TenantItem[];
    setTenants(list);
    setTenantId((prev) => prev || list[0]?.id || "");
  }

  async function loadBilling(nextTenantId?: string, nextDays?: string) {
    const useTenant = nextTenantId ?? tenantId;
    const useDays = nextDays ?? days;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (useTenant) params.set("tenantId", useTenant);
      params.set("days", useDays);
      const res = await fetch(`/api/platform/billing?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u8a08\u8cbb\u5931\u6557" : "Load billing failed"));
      setData(payload as BillingPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "\u8f09\u5165\u8a08\u8cbb\u5931\u6557" : "Load billing failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
    void loadBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u5e73\u53f0 / \u8a02\u95b1\u8207\u8a08\u8cbb" : "PLATFORM / BILLING"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u8a08\u8cbb\u8207\u8a02\u95b1\u6982\u89bd" : "Billing Overview"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u7d71\u8a08\u79df\u6236\u6536\u6b3e/\u9000\u6b3e\u3001\u8a02\u55ae\u72c0\u614b\u3001\u4e3b\u52d5\u8a02\u95b1\u8207\u5373\u5c07\u5230\u671f\u6703\u54e1\u3002"
                : "Track paid/refunded amounts, order status, active subscriptions, and expiring subscriptions."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7be9\u9078" : "Filters"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              <option value="">{zh ? "\u5168\u90e8\u79df\u6236/\u7576\u524d\u79df\u6236" : "All / current tenant"}</option>
              {tenants.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <input className="input" value={days} onChange={(event) => setDays(event.target.value)} placeholder={zh ? "\u7d71\u8a08\u5929\u6578" : "days"} />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadBilling()} disabled={loading}>
              {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : (zh ? "\u66f4\u65b0" : "Refresh")}
            </button>
          </div>
        </section>

        <section className="fdInventorySummary" style={{ marginTop: 14 }}>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u7e3d\u6536\u6b3e" : "Paid Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.paidAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u7e3d\u9000\u6b3e" : "Refunded Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.refundedAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u6de8\u6536\u6b3e" : "Net Total"}</div>
            <strong className="fdInventorySummaryValue">{data ? `NT$${data.totals.netAmount}` : "-"}</strong>
          </div>
          <div className="fdGlassSubPanel fdInventorySummaryItem">
            <div className="kvLabel">{zh ? "\u4e3b\u52d5\u8a02\u95b1" : "Active Subs"}</div>
            <strong className="fdInventorySummaryValue">{data ? data.totals.activeSubscriptions : "-"}</strong>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u79df\u6236\u7d71\u8a08" : "Per Tenant"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {(data?.items || []).map((item) => (
              <div key={item.tenantId} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  <strong>{item.tenantName}</strong> ({item.tenantStatus})
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u6536\u6b3e/\u9000\u6b3e/\u6de8\u984d" : "paid/refunded/net"}: NT${item.paidAmount} / NT${item.refundedAmount} / NT${item.netAmount}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u5df2\u4ed8\u8a02\u55ae/\u5f85\u6536\u8a02\u55ae" : "paid/pending orders"}: {item.ordersPaid} / {item.ordersPending}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u4e3b\u52d5\u8a02\u95b1/\u5169\u9031\u5167\u5230\u671f" : "active/expiring(14d)"}: {item.activeSubscriptions} / {item.expiringIn14Days}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {zh ? "\u6536\u6b3e\u5b8c\u6210\u7387" : "collection rate"}: {(item.collectionRate * 100).toFixed(1)}%
                </p>
              </div>
            ))}
            {!loading && (data?.items || []).length === 0 ? (
              <p className="fdGlassText">{zh ? "\u76ee\u524d\u6c92\u6709\u53ef\u986f\u793a\u7684\u8a08\u8cbb\u8cc7\u6599\u3002" : "No billing data found."}</p>
            ) : null}
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u5373\u5c07\u5230\u671f\u8a02\u95b1 (14 \u5929)" : "Expiring Subscriptions (14d)"}</h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {(data?.expiring || []).map((row, idx) => (
              <p key={`${row.memberId}-${idx}`} className="sub" style={{ marginTop: 0 }}>
                {row.tenantName} | {row.memberName} ({row.memberId}) | {row.validTo ? new Date(row.validTo).toLocaleString() : "-"}
              </p>
            ))}
            {!loading && (data?.expiring || []).length === 0 ? (
              <p className="fdGlassText">{zh ? "\u672a\u627e\u5230 14 \u5929\u5167\u5230\u671f\u8a02\u95b1\u3002" : "No subscriptions expiring within 14 days."}</p>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
