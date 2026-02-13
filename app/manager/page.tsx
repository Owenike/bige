"use client";

import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n-provider";

export default function ManagerDashboardPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const [orders, setOrders] = useState<Array<{ id: string; status: string; amount: number }>>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; reason: string | null }>>([]);
  const [reportFrom, setReportFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<{
    range: { from: string; to: string };
    payments: {
      totalPaid: number;
      totalRefunded: number;
      paidCount: number;
      refundedCount: number;
      byMethod: { cash: number; card: number; transfer: number; newebpay: number; manual: number };
    };
    checkins: { allow: number; deny: number };
    bookings: { total: number; byStatus: Record<string, number> };
    handover: { closedShiftCount: number; closedTotals: { cash: number; card: number; transfer: number } };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [voidOrderId, setVoidOrderId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [passId, setPassId] = useState("");
  const [delta, setDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");

  function paymentMethodLabel(method: string) {
    if (!zh) return method;
    if (method === "cash") return "\u73fe\u91d1";
    if (method === "card") return "\u5237\u5361";
    if (method === "transfer") return "\u8f49\u5e33";
    if (method === "newebpay") return "\u85cd\u65b0";
    if (method === "manual") return "\u624b\u52d5";
    return method;
  }

  function orderStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "pending") return "\u5f85\u8655\u7406";
    if (status === "paid") return "\u5df2\u4ed8\u6b3e";
    if (status === "cancelled") return "\u5df2\u53d6\u6d88";
    if (status === "voided") return "\u5df2\u4f5c\u5ee2";
    if (status === "refunded") return "\u5df2\u9000\u6b3e";
    return status;
  }

  function auditActionLabel(action: string) {
    if (!zh) return action;
    if (action === "order_voided") return "\u8a02\u55ae\u4f5c\u5ee2";
    if (action === "payment_refunded") return "\u4ed8\u6b3e\u9000\u6b3e";
    if (action === "pass_adjusted") return "\u7968\u5238\u8abf\u6574";
    if (action === "booking_updated") return "\u9810\u7d04\u66f4\u65b0";
    if (action === "member_updated") return "\u6703\u54e1\u8cc7\u6599\u66f4\u65b0";
    if (action === "branch_created") return "\u5206\u9928\u5efa\u7acb";
    return action;
  }

  async function load() {
    setLoading(true);
    setError(null);
    const [ordersRes, auditRes, reportRes] = await Promise.all([
      fetch("/api/orders"),
      fetch("/api/platform/audit?limit=30"),
      fetch(`/api/manager/reports/summary?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`),
    ]);
    const ordersPayload = await ordersRes.json();
    const auditPayload = await auditRes.json();
    const reportPayload = await reportRes.json();

    if (!ordersRes.ok) setError(ordersPayload?.error || (zh ? "\u8f09\u5165\u8a02\u55ae\u5931\u6557" : "Load orders failed"));
    if (!auditRes.ok) setError(auditPayload?.error || (zh ? "\u8f09\u5165\u7a3d\u6838\u5931\u6557" : "Load audit failed"));
    if (!reportRes.ok) setError(reportPayload?.error || (zh ? "\u8f09\u5165\u5831\u8868\u5931\u6557" : "Load report failed"));

    if (ordersRes.ok) setOrders(ordersPayload.items || []);
    if (auditRes.ok) setAudit(auditPayload.items || []);
    if (reportRes.ok) setReport(reportPayload);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function voidOrder(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/orders/${encodeURIComponent(voidOrderId)}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: voidReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u4f5c\u5ee2\u5931\u6557" : "Void failed"));
      return;
    }
    setMessage(`${zh ? "\u8a02\u55ae\u5df2\u4f5c\u5ee2" : "Voided order"}: ${voidOrderId}`);
    await load();
  }

  async function refundPayment(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/payments/${encodeURIComponent(refundPaymentId)}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: refundReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u9000\u6b3e\u5931\u6557" : "Refund failed"));
      return;
    }
    setMessage(`${zh ? "\u4ed8\u6b3e\u5df2\u9000\u6b3e" : "Refunded payment"}: ${refundPaymentId}`);
    await load();
  }

  async function adjustPass(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const res = await fetch("/api/manager/pass-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passId, delta: Number(delta), reason: adjustReason }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || (zh ? "\u8abf\u6574\u5931\u6557" : "Adjust failed"));
      return;
    }
    setMessage(`${zh ? "\u7968\u5238\u5df2\u8abf\u6574" : "Adjusted pass"}: ${payload.adjustment?.pass_id || passId}`);
    await load();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{zh ? "\u7ba1\u7406\u4e2d\u5fc3" : "MANAGER HUB"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "\u7ba1\u7406\u8005\u5100\u8868\u677f" : "Manager Dashboard"}
            </h1>
            <p className="fdGlassText">
              {zh
                ? "\u5728\u55ae\u4e00\u9762\u677f\u8ffd\u8e64\u71df\u904b KPI\u3001\u57f7\u884c\u4fee\u6b63\u64cd\u4f5c\u8207\u532f\u51fa\u5831\u8868\u3002"
                : "Track operation KPIs, run corrective actions, and export reports from one control panel."}
            </p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7ba1\u7406\u529f\u80fd" : "Management Areas"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <a className="fdPillBtn" href="/manager/products">{zh ? "\u5546\u54c1" : "Products"}</a>
            <a className="fdPillBtn" href="/manager/branches">{zh ? "\u5206\u9928" : "Branches"}</a>
            <a className="fdPillBtn" href="/manager/services">{zh ? "\u670d\u52d9" : "Services"}</a>
            <a className="fdPillBtn" href="/manager/coach-slots">{zh ? "\u6559\u7df4\u6642\u6bb5" : "Coach Slots"}</a>
            <a className="fdPillBtn" href="/manager/staff">{zh ? "\u4eba\u54e1" : "Staff"}</a>
            <a className="fdPillBtn" href="/manager/members">{zh ? "\u6703\u54e1" : "Members"}</a>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u71df\u904b\u6458\u8981" : "Operations Summary"}</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="input" />
            <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="input" />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? (zh ? "\u66f4\u65b0\u4e2d..." : "Refreshing...") : zh ? "\u66f4\u65b0\u5831\u8868" : "Refresh Report"}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            CSV:{" "}
            <a href={`/api/manager/reports/details?type=payments&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u4ed8\u6b3e" : "payments"}</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=checkins&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u5165\u5834" : "checkins"}</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=bookings&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">{zh ? "\u9810\u7d04" : "bookings"}</a>
          </p>
          {report ? (
            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5340\u9593" : "range"}: {report.range.from} {zh ? "\u81f3" : "to"} {report.range.to}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u4ed8" : "paid"}: {report.payments.totalPaid} ({zh ? "\u7b46\u6578" : "count"}: {report.payments.paidCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u9000" : "refunded"}: {report.payments.totalRefunded} ({zh ? "\u7b46\u6578" : "count"}: {report.payments.refundedCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u65b9\u5f0f\u7d71\u8a08" : "by method"}: {paymentMethodLabel("cash")} {report.payments.byMethod.cash}, {paymentMethodLabel("card")} {report.payments.byMethod.card}, {paymentMethodLabel("transfer")} {report.payments.byMethod.transfer}, {paymentMethodLabel("newebpay")} {report.payments.byMethod.newebpay}, {paymentMethodLabel("manual")} {report.payments.byMethod.manual}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5165\u5834" : "check-ins"}: {zh ? "\u901a\u904e" : "allow"} {report.checkins.allow}, {zh ? "\u62d2\u7d55" : "deny"} {report.checkins.deny}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u9810\u7d04\u7e3d\u6578" : "bookings total"}: {report.bookings.total}</p>
              <p className="sub" style={{ marginTop: 0 }}>{zh ? "\u5df2\u7d50\u73ed\u6b21" : "closed shifts"}: {report.handover.closedShiftCount}</p>
              <p className="sub" style={{ marginTop: 0 }}>
                {zh ? "\u73ed\u6b21\u7d50\u7b97" : "shift totals"}: {zh ? "\u73fe\u91d1" : "cash"} {report.handover.closedTotals.cash}, {zh ? "\u5237\u5361" : "card"} {report.handover.closedTotals.card}, {zh ? "\u8f49\u5e33" : "transfer"} {report.handover.closedTotals.transfer}
              </p>
            </div>
          ) : null}
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={voidOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u4f5c\u5ee2\u8a02\u55ae" : "Void Order"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={voidOrderId} onChange={(e) => setVoidOrderId(e.target.value)} placeholder={zh ? "\u8a02\u55ae ID" : "orderId"} className="input" required />
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u4f5c\u5ee2\u8a02\u55ae" : "Void Order"}</button>
          </form>

          <form onSubmit={refundPayment} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u4ed8\u6b3e\u9000\u6b3e" : "Refund Payment"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)} placeholder={zh ? "\u4ed8\u6b3e ID" : "paymentId"} className="input" required />
              <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u9000\u6b3e" : "Refund Payment"}</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={adjustPass} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u7968\u5238\u8abf\u6574" : "Pass Adjustment"}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={passId} onChange={(e) => setPassId(e.target.value)} placeholder={zh ? "\u7968\u5238 ID" : "passId"} className="input" required />
              <input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder={zh ? "\u8abf\u6574\u503c (+/-)" : "delta (+/-)"} className="input" required />
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={zh ? "\u539f\u56e0" : "reason"} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>{zh ? "\u8abf\u6574" : "Adjust Pass"}</button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{zh ? "\u6700\u65b0\u8a02\u55ae" : "Recent Orders"}</h2>
            <div className="fdDataGrid">
              {orders.map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  {item.id} | {orderStatusLabel(item.status)} | {item.amount}
                </p>
              ))}
              {orders.length === 0 ? <p className="fdGlassText">{zh ? "\u627e\u4e0d\u5230\u8a02\u55ae\u3002" : "No orders found."}</p> : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">{zh ? "\u7a3d\u6838\u65e5\u8a8c" : "Audit Logs"}</h2>
          <div className="fdDataGrid">
            {audit.map((item) => (
              <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                {auditActionLabel(item.action)} | {item.reason || "-"}
              </p>
            ))}
            {audit.length === 0 ? <p className="fdGlassText">{zh ? "\u7121\u7a3d\u6838\u8a18\u9304\u3002" : "No audit logs found."}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
