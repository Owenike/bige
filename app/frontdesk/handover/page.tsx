"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

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

function fmtDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function FrontdeskHandoverPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";

  const [items, setItems] = useState<ShiftItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openNote, setOpenNote] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [cashTotal, setCashTotal] = useState("0");
  const [cardTotal, setCardTotal] = useState("0");
  const [transferTotal, setTransferTotal] = useState("0");
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "SHIFT HANDOVER",
            title: "櫃台交班",
            sub: "管理開班與結班紀錄，並保留可追溯的金額彙總。",
            openTitle: "開班",
            openNote: "開班備註",
            openBtn: "開班",
            opening: "開班中...",
            closeTitle: "結班",
            shiftId: "班次 ID",
            cash: "現金總額",
            card: "刷卡總額",
            transfer: "轉帳總額",
            closeNote: "結班備註",
            closeBtn: "結班",
            closing: "結班中...",
            recent: "最近班次",
            noData: "目前沒有班次資料",
            status: "狀態",
            openedAt: "開班時間",
            closedAt: "結班時間",
            note: "備註",
            loadFail: "載入失敗",
            openFail: "開班失敗",
            closeFail: "結班失敗",
          }
        : {
            badge: "SHIFT HANDOVER",
            title: "Frontdesk Handover",
            sub: "Manage open/close shift records with traceable summaries.",
            openTitle: "Open Shift",
            openNote: "Opening Note",
            openBtn: "Open",
            opening: "Opening...",
            closeTitle: "Close Shift",
            shiftId: "Shift ID",
            cash: "Cash Total",
            card: "Card Total",
            transfer: "Transfer Total",
            closeNote: "Closing Note",
            closeBtn: "Close",
            closing: "Closing...",
            recent: "Recent Shifts",
            noData: "No shift data yet",
            status: "Status",
            openedAt: "Opened At",
            closedAt: "Closed At",
            note: "Note",
            loadFail: "Load failed",
            openFail: "Open shift failed",
            closeFail: "Close shift failed",
          },
    [lang],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/frontdesk/handover");
    const payload = await res.json();
    if (!res.ok) {
      setError(payload?.error || t.loadFail);
      return;
    }
    setItems((payload.items || []) as ShiftItem[]);
  }, [t.loadFail]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", note: openNote || null }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || t.openFail);
        return;
      }
      setOpenNote("");
      await load();
    } finally {
      setOpening(false);
    }
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    setClosing(true);
    setError(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          shiftId,
          cashTotal: Number(cashTotal),
          cardTotal: Number(cardTotal),
          transferTotal: Number(transferTotal),
          note: closeNote || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.error || t.closeFail);
        return;
      }
      setCloseNote("");
      await load();
    } finally {
      setClosing(false);
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

        <section className="fdTwoCol">
          <form onSubmit={openShift} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.openTitle}</h2>
            <input
              value={openNote}
              onChange={(e) => setOpenNote(e.target.value)}
              placeholder={t.openNote}
              className="input"
            />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={opening}>
              {opening ? t.opening : t.openBtn}
            </button>
          </form>

          <form onSubmit={closeShift} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.closeTitle}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <input value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder={t.shiftId} className="input" required />
              <input type="number" value={cashTotal} onChange={(e) => setCashTotal(e.target.value)} placeholder={t.cash} className="input" />
              <input type="number" value={cardTotal} onChange={(e) => setCardTotal(e.target.value)} placeholder={t.card} className="input" />
              <input type="number" value={transferTotal} onChange={(e) => setTransferTotal(e.target.value)} placeholder={t.transfer} className="input" />
              <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder={t.closeNote} className="input" />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={closing}>
              {closing ? t.closing : t.closeBtn}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <h2 className="sectionTitle">{t.recent}</h2>
          <div className="fdActionGrid">
            {items.length === 0 ? (
              <div className="fdGlassSubPanel" style={{ padding: 14 }}>
                <p className="fdGlassText" style={{ marginTop: 0 }}>{t.noData}</p>
              </div>
            ) : (
              items.map((item) => (
                <article key={item.id} className="fdGlassSubPanel fdActionCard" style={{ padding: 14 }}>
                  <h3 className="fdActionTitle" style={{ fontSize: 20 }}>{item.id.slice(0, 8)}</h3>
                  <div className="fdDataGrid" style={{ marginTop: 8 }}>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.status}: {item.status}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.openedAt}: {fmtDate(item.opened_at)}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.closedAt}: {fmtDate(item.closed_at)}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.note}: {item.note || "-"}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.cash}: {item.cash_total}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.card}: {item.card_total}</p>
                    <p className="fdGlassText" style={{ marginTop: 0 }}>{t.transfer}: {item.transfer_total}</p>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

