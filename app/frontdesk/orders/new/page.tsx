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

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setCheckoutUrl("");
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
    setOrderId(String(payload.order?.id || ""));
    setMessage(`Order created: ${payload.order?.id}`);
  }

  async function payOrder(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
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
  }

  async function initNewebpay(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setCheckoutUrl("");

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
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Frontdesk New Order</h1>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
      {message ? <p style={{ color: "green" }}>{message}</p> : null}

      <form onSubmit={createOrder}>
        <h2>Create Order</h2>
        <p><input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder="memberId (optional)" /></p>
        <p><input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount" required /></p>
        <p><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" /></p>
        <button type="submit">Create Order</button>
      </form>

      <form onSubmit={payOrder} style={{ marginTop: 24 }}>
        <h2>Take Payment</h2>
        <p><input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="orderId" required /></p>
        <p>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="cash">cash</option>
            <option value="card">card</option>
            <option value="transfer">transfer</option>
            <option value="newebpay">newebpay</option>
            <option value="manual">manual</option>
          </select>
        </p>
        <button type="submit">Record Payment</button>
      </form>

      <form onSubmit={initNewebpay} style={{ marginTop: 24 }}>
        <h2>Newebpay Checkout</h2>
        <p><input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="orderId" required /></p>
        <button type="submit">Initialize Checkout</button>
        {checkoutUrl ? (
          <p>
            Checkout URL: <a href={checkoutUrl} target="_blank" rel="noreferrer">{checkoutUrl}</a>
          </p>
        ) : null}
      </form>
    </main>
  );
}
