"use client";

import { FormEvent, useState } from "react";

export default function FrontdeskNewOrderPage() {
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [checkoutUrl, setCheckoutUrl] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [initializing, setInitializing] = useState(false);

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setMessage(null);
    setCheckoutUrl("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: memberId || null,
          amount: Number(amount),
          channel: "frontdesk",
          note: note || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Create order failed");
        return;
      }
      const newOrderId = String(payload.order?.id || "");
      setOrderId(newOrderId);
      setMessage(`Order created: ${newOrderId}`);
    } finally {
      setCreating(false);
    }
  }

  async function payOrder(event: FormEvent) {
    event.preventDefault();
    setPaying(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          amount: Number(amount),
          method: paymentMethod,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Payment failed");
        return;
      }
      setMessage(`Payment recorded: ${payload.payment?.id}`);
    } finally {
      setPaying(false);
    }
  }

  async function initNewebpay(event: FormEvent) {
    event.preventDefault();
    setInitializing(true);
    setError(null);
    setMessage(null);
    setCheckoutUrl("");
    try {
      const res = await fetch("/api/payments/newebpay/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || "Newebpay init failed");
        return;
      }
      setCheckoutUrl(String(payload.checkoutUrl || ""));
      setMessage("Newebpay checkout initialized");
    } finally {
      setInitializing(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">PAYMENT DESK</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              Frontdesk New Order
            </h1>
            <p className="fdGlassText">Create desk orders, capture payment, and initialize Newebpay checkout from one flow.</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Create Order</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="memberId (optional)" className="input" />
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="amount"
                className="input"
                required
              />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={creating}>
              {creating ? "Creating..." : "Create Order"}
            </button>
          </form>

          <form onSubmit={payOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Take Payment</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="orderId" className="input" required />
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input">
                <option value="cash">cash</option>
                <option value="card">card</option>
                <option value="transfer">transfer</option>
                <option value="newebpay">newebpay</option>
                <option value="manual">manual</option>
              </select>
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={paying}>
              {paying ? "Recording..." : "Record Payment"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <form onSubmit={initNewebpay} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">Newebpay Checkout</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="orderId" className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={initializing}>
              {initializing ? "Initializing..." : "Initialize Checkout"}
            </button>
            {checkoutUrl ? (
              <p className="sub" style={{ marginTop: 10 }}>
                Checkout URL:{" "}
                <a href={checkoutUrl} target="_blank" rel="noreferrer">
                  {checkoutUrl}
                </a>
              </p>
            ) : null}
          </form>
        </section>
      </section>
    </main>
  );
}
