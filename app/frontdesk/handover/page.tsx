"use client";

import { FormEvent, useEffect, useState } from "react";

interface ShiftItem {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  note: string | null;
}

export default function FrontdeskHandoverPage() {
  const [items, setItems] = useState<ShiftItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [cashTotal, setCashTotal] = useState("0");
  const [cardTotal, setCardTotal] = useState("0");
  const [transferTotal, setTransferTotal] = useState("0");

  async function load() {
    setError(null);
    const res = await fetch("/api/frontdesk/handover");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Load failed");
      return;
    }
    setItems((payload.items || []) as ShiftItem[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/frontdesk/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", note: note || null }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Open shift failed");
      return;
    }
    setNote("");
    await load();
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/frontdesk/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "close",
        shiftId,
        cashTotal: Number(cashTotal),
        cardTotal: Number(cardTotal),
        transferTotal: Number(transferTotal),
        note: note || null,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || "Close shift failed");
      return;
    }
    await load();
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Frontdesk Handover</h1>
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <form onSubmit={openShift}>
        <h2>Open Shift</h2>
        <p><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="opening note" /></p>
        <button type="submit">Open</button>
      </form>

      <form onSubmit={closeShift} style={{ marginTop: 20 }}>
        <h2>Close Shift</h2>
        <p><input value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder="shiftId" required /></p>
        <p><input type="number" value={cashTotal} onChange={(e) => setCashTotal(e.target.value)} placeholder="cash total" /></p>
        <p><input type="number" value={cardTotal} onChange={(e) => setCardTotal(e.target.value)} placeholder="card total" /></p>
        <p><input type="number" value={transferTotal} onChange={(e) => setTransferTotal(e.target.value)} placeholder="transfer total" /></p>
        <button type="submit">Close</button>
      </form>

      <h2>Recent Shifts</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.status} | {new Date(item.opened_at).toLocaleString()} | shiftId: {item.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
