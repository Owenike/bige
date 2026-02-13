"use client";

import { FormEvent, useEffect, useState } from "react";

export default function ManagerDashboardPage() {
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

    if (!ordersRes.ok) setError(ordersPayload?.error || "Load orders failed");
    if (!auditRes.ok) setError(auditPayload?.error || "Load audit failed");
    if (!reportRes.ok) setError(reportPayload?.error || "Load report failed");

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
      setError(payload?.error || "Void failed");
      return;
    }
    setMessage(`Voided order: ${voidOrderId}`);
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
      setError(payload?.error || "Refund failed");
      return;
    }
    setMessage(`Refunded payment: ${refundPaymentId}`);
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
      setError(payload?.error || "Adjust failed");
      return;
    }
    setMessage(`Adjusted pass: ${payload.adjustment?.pass_id || passId}`);
    await load();
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">MANAGER HUB</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Manager Dashboard
            </h1>
            <p className="fdGlassText">Track operation KPIs, run corrective actions, and export reports from one control panel.</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdGlassSubPanel" style={{ padding: 14 }}>
          <h2 className="sectionTitle">Management Areas</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <a className="fdPillBtn" href="/manager/products">Products</a>
            <a className="fdPillBtn" href="/manager/branches">Branches</a>
            <a className="fdPillBtn" href="/manager/services">Services</a>
            <a className="fdPillBtn" href="/manager/coach-slots">Coach Slots</a>
            <a className="fdPillBtn" href="/manager/staff">Staff</a>
            <a className="fdPillBtn" href="/manager/members">Members</a>
          </div>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Operations Summary</h2>
          <div className="actions" style={{ marginTop: 8 }}>
            <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="input" />
            <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="input" />
            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh Report"}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            CSV:{" "}
            <a href={`/api/manager/reports/details?type=payments&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">payments</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=checkins&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">checkins</a>
            {" | "}
            <a href={`/api/manager/reports/details?type=bookings&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`} target="_blank" rel="noreferrer">bookings</a>
          </p>
          {report ? (
            <div className="fdDataGrid" style={{ marginTop: 10 }}>
              <p className="sub" style={{ marginTop: 0 }}>range: {report.range.from} to {report.range.to}</p>
              <p className="sub" style={{ marginTop: 0 }}>paid: {report.payments.totalPaid} (count: {report.payments.paidCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>refunded: {report.payments.totalRefunded} (count: {report.payments.refundedCount})</p>
              <p className="sub" style={{ marginTop: 0 }}>
                by method: cash {report.payments.byMethod.cash}, card {report.payments.byMethod.card}, transfer {report.payments.byMethod.transfer}, newebpay {report.payments.byMethod.newebpay}, manual {report.payments.byMethod.manual}
              </p>
              <p className="sub" style={{ marginTop: 0 }}>check-ins: allow {report.checkins.allow}, deny {report.checkins.deny}</p>
              <p className="sub" style={{ marginTop: 0 }}>bookings total: {report.bookings.total}</p>
              <p className="sub" style={{ marginTop: 0 }}>closed shifts: {report.handover.closedShiftCount}</p>
              <p className="sub" style={{ marginTop: 0 }}>
                shift totals: cash {report.handover.closedTotals.cash}, card {report.handover.closedTotals.card}, transfer {report.handover.closedTotals.transfer}
              </p>
            </div>
          ) : null}
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={voidOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Void Order</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={voidOrderId} onChange={(e) => setVoidOrderId(e.target.value)} placeholder="orderId" className="input" required />
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="reason" className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>Void Order</button>
          </form>

          <form onSubmit={refundPayment} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Refund Payment</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)} placeholder="paymentId" className="input" required />
              <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="reason" className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>Refund Payment</button>
          </form>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <form onSubmit={adjustPass} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Pass Adjustment</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={passId} onChange={(e) => setPassId(e.target.value)} placeholder="passId" className="input" required />
              <input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="delta (+/-)" className="input" required />
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="reason" className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }}>Adjust Pass</button>
          </form>

          <section className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Recent Orders</h2>
            <div className="fdDataGrid">
              {orders.map((item) => (
                <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                  {item.id} | {item.status} | {item.amount}
                </p>
              ))}
              {orders.length === 0 ? <p className="fdGlassText">No orders found.</p> : null}
            </div>
          </section>
        </section>

        <section className="fdGlassSubPanel" style={{ padding: 14, marginTop: 14 }}>
          <h2 className="sectionTitle">Audit Logs</h2>
          <div className="fdDataGrid">
            {audit.map((item) => (
              <p key={item.id} className="sub" style={{ marginTop: 0 }}>
                {item.action} | {item.reason || "-"}
              </p>
            ))}
            {audit.length === 0 ? <p className="fdGlassText">No audit logs found.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
