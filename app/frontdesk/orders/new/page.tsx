"use client";

import { FormEvent, useMemo, useState } from "react";
import { useI18n } from "../../../i18n-provider";

export default function FrontdeskNewOrderPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "櫃檯收款",
            title: "櫃檯新增訂單",
            sub: "在同一流程建立櫃檯訂單、記錄付款並初始化藍新金流結帳。",
            createOrder: "建立訂單",
            memberIdOptional: "memberId（選填）",
            amount: "金額",
            note: "備註",
            creating: "建立中...",
            takePayment: "記錄付款",
            orderId: "orderId",
            recording: "記錄中...",
            recordPayment: "記錄付款",
            checkout: "藍新金流結帳",
            initializing: "初始化中...",
            initCheckout: "初始化結帳",
            checkoutUrl: "結帳連結",
            createFail: "建立訂單失敗",
            paymentFail: "付款失敗",
            newebpayInitFail: "藍新初始化失敗",
            orderCreated: "訂單已建立",
            paymentRecorded: "付款已記錄",
            checkoutInitialized: "藍新結帳已初始化",
            cash: "現金",
            card: "刷卡",
            transfer: "轉帳",
            newebpay: "藍新",
            manual: "手動",
          }
        : {
            badge: "PAYMENT DESK",
            title: "Frontdesk New Order",
            sub: "Create desk orders, capture payment, and initialize Newebpay checkout from one flow.",
            createOrder: "Create Order",
            memberIdOptional: "memberId (optional)",
            amount: "amount",
            note: "note",
            creating: "Creating...",
            takePayment: "Take Payment",
            orderId: "orderId",
            recording: "Recording...",
            recordPayment: "Record Payment",
            checkout: "Newebpay Checkout",
            initializing: "Initializing...",
            initCheckout: "Initialize Checkout",
            checkoutUrl: "Checkout URL",
            createFail: "Create order failed",
            paymentFail: "Payment failed",
            newebpayInitFail: "Newebpay init failed",
            orderCreated: "Order created",
            paymentRecorded: "Payment recorded",
            checkoutInitialized: "Newebpay checkout initialized",
            cash: "cash",
            card: "card",
            transfer: "transfer",
            newebpay: "newebpay",
            manual: "manual",
          },
    [lang],
  );

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
        setError(payload?.error || t.createFail);
        return;
      }
      const newOrderId = String(payload.order?.id || "");
      setOrderId(newOrderId);
      setMessage(`${t.orderCreated}: ${newOrderId}`);
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
        setError(payload?.error || t.paymentFail);
        return;
      }
      setMessage(`${t.paymentRecorded}: ${payload.payment?.id}`);
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
        setError(payload?.error || t.newebpayInitFail);
        return;
      }
      setCheckoutUrl(String(payload.checkoutUrl || ""));
      setMessage(t.checkoutInitialized);
    } finally {
      setInitializing(false);
    }
  }

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="fdGlassPanel">
            <div className="fdEyebrow">{t.badge}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {t.title}
            </h1>
            <p className="fdGlassText">{t.sub}</p>
          </div>
        </section>

        {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
        {message ? <div className="sub" style={{ marginBottom: 12, color: "var(--brand)" }}>{message}</div> : null}

        <section className="fdTwoCol">
          <form onSubmit={createOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.createOrder}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={memberId} onChange={(e) => setMemberId(e.target.value)} placeholder={t.memberIdOptional} className="input" />
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t.amount}
                className="input"
                required
              />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.note} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={creating}>
              {creating ? t.creating : t.createOrder}
            </button>
          </form>

          <form onSubmit={payOrder} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.takePayment}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder={t.orderId} className="input" required />
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input">
                <option value="cash">{t.cash}</option>
                <option value="card">{t.card}</option>
                <option value="transfer">{t.transfer}</option>
                <option value="newebpay">{t.newebpay}</option>
                <option value="manual">{t.manual}</option>
              </select>
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={paying}>
              {paying ? t.recording : t.recordPayment}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <form onSubmit={initNewebpay} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.checkout}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder={t.orderId} className="input" required />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={initializing}>
              {initializing ? t.initializing : t.initCheckout}
            </button>
            {checkoutUrl ? (
              <p className="sub" style={{ marginTop: 10 }}>
                {t.checkoutUrl}: {" "}
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
