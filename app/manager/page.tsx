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
  const [voidOrderId, setVoidOrderId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [passId, setPassId] = useState("");
  const [delta, setDelta] = useState("1");
  const [adjustReason, setAdjustReason] = useState("");

  async function load() {
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
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function voidOrder(event: FormEvent) {
    event.preventDefault();
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
    await load();
  }

  async function refundPayment(event: FormEvent) {
    event.preventDefault();
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
    await load();
  }

  async function adjustPass(event: FormEvent) {
    event.preventDefault();
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
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1>Manager Dashboard</h1>
        <p>
          <a href="/manager/products">Products</a>
          {" | "}
          <a href="/manager/branches">Branches</a>
          {" | "}
          <a href="/manager/services">Services</a>
          {" | "}
          <a href="/manager/coach-slots">Coach Slots</a>
          {" | "}
          <a href="/manager/staff">Staff</a>
          {" | "}
          <a href="/manager/members">Members</a>
        </p>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

        <section>
          <h2>Operations Summary</h2>
          <p>
            <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
            {" "}
            <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
            {" "}
            <button type="button" onClick={() => void load()}>Refresh Report</button>
          </p>
          <p>
            CSV:
            {" "}
            <a
              href={`/api/manager/reports/details?type=payments&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`}
              target="_blank"
              rel="noreferrer"
            >
              payments
            </a>
            {" | "}
            <a
              href={`/api/manager/reports/details?type=checkins&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`}
              target="_blank"
              rel="noreferrer"
            >
              checkins
            </a>
            {" | "}
            <a
              href={`/api/manager/reports/details?type=bookings&format=csv&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`}
              target="_blank"
              rel="noreferrer"
            >
              bookings
            </a>
          </p>
          {report ? (
            <div>
              <p>Range: {report.range.from} to {report.range.to}</p>
              <p>Paid: {report.payments.totalPaid} (count: {report.payments.paidCount})</p>
              <p>Refunded: {report.payments.totalRefunded} (count: {report.payments.refundedCount})</p>
              <p>
                Paid by method: cash {report.payments.byMethod.cash}, card {report.payments.byMethod.card}, transfer {report.payments.byMethod.transfer}, newebpay {report.payments.byMethod.newebpay}, manual {report.payments.byMethod.manual}
              </p>
              <p>Check-ins: allow {report.checkins.allow}, deny {report.checkins.deny}</p>
              <p>Bookings total: {report.bookings.total}</p>
              <p>Closed shifts: {report.handover.closedShiftCount}</p>
              <p>
                Shift totals: cash {report.handover.closedTotals.cash}, card {report.handover.closedTotals.card}, transfer {report.handover.closedTotals.transfer}
              </p>
            </div>
          ) : null}
        </section>

        <section>
          <h2>Void Order</h2>
          <form onSubmit={voidOrder}>
            <p><input value={voidOrderId} onChange={(e) => setVoidOrderId(e.target.value)} placeholder="orderId" required /></p>
            <p><input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="reason" required /></p>
            <button type="submit">Void Order</button>
          </form>
        </section>

        <section>
          <h2>Refund Payment</h2>
          <form onSubmit={refundPayment}>
            <p><input value={refundPaymentId} onChange={(e) => setRefundPaymentId(e.target.value)} placeholder="paymentId" required /></p>
            <p><input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="reason" required /></p>
            <button type="submit">Refund Payment</button>
          </form>
        </section>

        <section>
          <h2>Pass Adjustment</h2>
          <form onSubmit={adjustPass}>
            <p><input value={passId} onChange={(e) => setPassId(e.target.value)} placeholder="passId" required /></p>
            <p><input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="delta (+/-)" required /></p>
            <p><input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="reason" required /></p>
            <button type="submit">Adjust Pass</button>
          </form>
        </section>

        <section>
          <h2>Recent Orders</h2>
          <ul>
            {orders.map((item) => (
              <li key={item.id}>
                {item.id} | {item.status} | {item.amount}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Audit Logs</h2>
          <ul>
            {audit.map((item) => (
              <li key={item.id}>
                {item.action} | {item.reason || "-"}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
