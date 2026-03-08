"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n-provider";

interface ShiftItem {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  opening_cash?: number | null;
  expected_cash?: number | null;
  counted_cash?: number | null;
  difference?: number | null;
  cash_total: number;
  card_total: number;
  transfer_total: number;
  note: string | null;
  difference_reason?: string | null;
  closing_confirmed?: boolean | null;
}

type ActiveShiftSummary = {
  shiftId: string;
  openingCash: number;
  expectedCash: number;
  expectedCashDelta: number;
  cashAdjustmentNet: number;
  netRevenue: number;
  inflow: { cash: number; card: number; transfer: number; newebpay: number; manual: number };
  outflow: { cash: number; card: number; transfer: number; newebpay: number; manual: number };
  counts: {
    payments: number;
    refunds: number;
    voids: number;
    invoices: number;
    checkins: number;
    redemptions: number;
    inventorySales: number;
    notes: number;
    adjustments: number;
  };
};

type NotificationItem = {
  id: string;
  status: "unread" | "read" | "archived";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  eventType: string;
  actionUrl: string | null;
  createdAt: string;
};

function getApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as { error?: unknown; message?: unknown; errorMessage?: unknown };
  if (typeof record.error === "string" && record.error) return record.error;
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as { message?: unknown }).message === "string"
  ) {
    return (record.error as { message: string }).message;
  }
  if (typeof record.message === "string" && record.message) return record.message;
  if (typeof record.errorMessage === "string" && record.errorMessage) return record.errorMessage;
  return fallback;
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
  const [activeSummary, setActiveSummary] = useState<ActiveShiftSummary | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [openNote, setOpenNote] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [cashTotal, setCashTotal] = useState("0");
  const [cardTotal, setCardTotal] = useState("0");
  const [transferTotal, setTransferTotal] = useState("0");
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustDirection, setAdjustDirection] = useState<"inflow" | "outflow">("inflow");
  const [adjustAmount, setAdjustAmount] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const activeShift = useMemo(() => items.find((item) => item.status === "open") || null, [items]);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "SHIFT HANDOVER",
            title: "櫃檯交班",
            sub: "管理開班與結班紀錄，並保留可追溯的金額彙總。",
            openTitle: "開班",
            openNote: "開班備註",
            openBtn: "開始開班",
            opening: "開班中...",
            closeTitle: "結班",
            activeShift: "目前開班",
            noActiveShift: "目前沒有開班中的班次。",
            cash: "現金總額",
            card: "刷卡總額",
            transfer: "轉帳總額",
            closeNote: "結班備註",
            closeBtn: "執行結班",
            closing: "結班中...",
            adjustTitle: "現金異動 / 零用金",
            adjustDirectionIn: "現金流入",
            adjustDirectionOut: "現金流出",
            adjustAmount: "金額",
            adjustReason: "原因",
            adjustNote: "備註",
            adjustBtn: "新增現金異動",
            adjusting: "處理中...",
            adjustFail: "現金異動失敗",
            adjustSuccess: "現金異動已記錄",
            recent: "近期班次",
            noData: "尚無班次資料",
            status: "狀態",
            openedAt: "開班時間",
            closedAt: "結班時間",
            note: "備註",
            loadFail: "載入失敗",
            openFail: "開班失敗",
            closeFail: "結班失敗",
            openSuccess: "已開班",
            closeSuccess: "已結班",
            alreadyOpen: "已有開班中的班次，請先結班。",
          }
        : {
            badge: "SHIFT HANDOVER",
            title: "Frontdesk Handover",
            sub: "Manage open/close shift records with traceable summaries.",
            openTitle: "Open Shift",
            openNote: "Opening Note",
            openBtn: "Open Shift",
            opening: "Opening...",
            closeTitle: "Close Shift",
            activeShift: "Active Shift",
            noActiveShift: "No active shift.",
            cash: "Cash Total",
            card: "Card Total",
            transfer: "Transfer Total",
            closeNote: "Closing Note",
            closeBtn: "Close Shift",
            closing: "Closing...",
            adjustTitle: "Cash Adjustment / Petty Cash",
            adjustDirectionIn: "Cash Inflow",
            adjustDirectionOut: "Cash Outflow",
            adjustAmount: "Amount",
            adjustReason: "Reason",
            adjustNote: "Note",
            adjustBtn: "Record Adjustment",
            adjusting: "Submitting...",
            adjustFail: "Cash adjustment failed",
            adjustSuccess: "Cash adjustment recorded",
            recent: "Recent Shifts",
            noData: "No shift data yet",
            status: "Status",
            openedAt: "Opened At",
            closedAt: "Closed At",
            note: "Note",
            loadFail: "Load failed",
            openFail: "Open shift failed",
            closeFail: "Close shift failed",
            openSuccess: "Shift opened",
            closeSuccess: "Shift closed",
            alreadyOpen: "An active shift already exists. Close it first.",
          },
    [lang],
  );

  const load = useCallback(async () => {
    setError(null);
    const [res, notificationsRes] = await Promise.all([
      fetch("/api/frontdesk/handover"),
      fetch("/api/notifications?status=all&limit=12"),
    ]);
    const payload = await res.json();
    const notificationsPayload = await notificationsRes.json().catch(() => null);
    if (!res.ok) {
      setError(getApiError(payload, t.loadFail));
      return;
    }
    if (!notificationsRes.ok) {
      setError(getApiError(notificationsPayload, lang === "zh" ? "載入通知失敗" : "Load notifications failed"));
    }
    setItems((payload.items || payload.data?.items || []) as ShiftItem[]);
    setActiveSummary((payload.activeSummary || payload.data?.activeSummary || null) as ActiveShiftSummary | null);
    const data = (notificationsPayload?.data || notificationsPayload || {}) as {
      items?: NotificationItem[];
      unreadCount?: number;
    };
    if (notificationsRes.ok) {
      setNotifications(data.items || []);
      setUnreadNotificationCount(data.unreadCount || 0);
    }
  }, [lang, t.loadFail]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    if (activeShift) {
      setError(t.alreadyOpen);
      return;
    }
    setOpening(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", note: openNote || null }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(getApiError(payload, t.openFail));
        return;
      }
      setOpenNote("");
      setMessage(`${t.openSuccess}: ${String(payload?.shift?.id || payload?.data?.shift?.id || "").slice(0, 8)}`);
      await load();
    } finally {
      setOpening(false);
    }
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    if (!activeShift) {
      setError(t.noActiveShift);
      return;
    }
    setClosing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          shiftId: activeShift.id,
          cashTotal: Number(cashTotal),
          cardTotal: Number(cardTotal),
          transferTotal: Number(transferTotal),
          note: closeNote || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(getApiError(payload, t.closeFail));
        return;
      }
      setCloseNote("");
      setMessage(`${t.closeSuccess}: ${String(payload?.shift?.id || payload?.data?.shift?.id || activeShift.id).slice(0, 8)}`);
      await load();
    } finally {
      setClosing(false);
    }
  }

  async function addCashAdjustment(event: FormEvent) {
    event.preventDefault();
    if (!activeShift) {
      setError(t.noActiveShift);
      return;
    }
    setAdjusting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/frontdesk/handover/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: adjustDirection,
          amount: Number(adjustAmount),
          reason: adjustReason,
          note: adjustNote || null,
          shiftId: activeShift.id,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(getApiError(payload, t.adjustFail));
        return;
      }
      setAdjustAmount("0");
      setAdjustReason("");
      setAdjustNote("");
      setMessage(t.adjustSuccess);
      await load();
    } finally {
      setAdjusting(false);
    }
  }

  async function markNotificationRead(notificationId: string) {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notificationIds: [notificationId] }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      setError(getApiError(payload, lang === "zh" ? "更新通知失敗" : "Failed to update notification"));
      return;
    }
    setNotifications((prev) => prev.map((item) => (item.id === notificationId ? { ...item, status: "read" } : item)));
    setUnreadNotificationCount((prev) => Math.max(0, prev - 1));
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

        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
          <h2 className="sectionTitle">
            {lang === "zh" ? `櫃檯提醒（未讀 ${unreadNotificationCount}）` : `Frontdesk Alerts (Unread ${unreadNotificationCount})`}
          </h2>
          <div className="fdDataGrid" style={{ marginTop: 8 }}>
            {notifications.map((item) => (
              <div key={item.id} className="fdGlassSubPanel" style={{ padding: 10 }}>
                <p className="sub" style={{ marginTop: 0 }}>
                  [{item.severity}] {item.title}
                </p>
                <p className="sub" style={{ marginTop: 0 }}>{item.message}</p>
                <p className="sub" style={{ marginTop: 0 }}>
                  {new Date(item.createdAt).toLocaleString()} | {item.eventType} | {item.status}
                </p>
                <div className="actions" style={{ marginTop: 8 }}>
                  {item.actionUrl ? (
                    <a className="fdPillBtn" href={item.actionUrl}>
                      {lang === "zh" ? "前往處理" : "Open"}
                    </a>
                  ) : null}
                  {item.status === "unread" ? (
                    <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void markNotificationRead(item.id)}>
                      {lang === "zh" ? "標記已讀" : "Mark Read"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {notifications.length === 0 ? (
              <p className="fdGlassText">{lang === "zh" ? "目前沒有通知。" : "No notifications."}</p>
            ) : null}
          </div>
        </section>

        <section className="fdTwoCol">
          <form onSubmit={openShift} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.openTitle}</h2>
            <input
              value={openNote}
              onChange={(e) => setOpenNote(e.target.value)}
              placeholder={t.openNote}
              className="input"
            />
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={opening || Boolean(activeShift)}>
              {opening ? t.opening : t.openBtn}
            </button>
          </form>

          <form onSubmit={closeShift} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.closeTitle}</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <div className="input" style={{ display: "flex", alignItems: "center" }}>
                {t.activeShift}: {activeShift ? activeShift.id.slice(0, 8) : t.noActiveShift}
              </div>
              <input type="number" value={cashTotal} onChange={(e) => setCashTotal(e.target.value)} placeholder={t.cash} className="input" />
              <input type="number" value={cardTotal} onChange={(e) => setCardTotal(e.target.value)} placeholder={t.card} className="input" />
              <input type="number" value={transferTotal} onChange={(e) => setTransferTotal(e.target.value)} placeholder={t.transfer} className="input" />
              <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder={t.closeNote} className="input" />
            </div>
            <button type="submit" className="fdPillBtn" style={{ marginTop: 10 }} disabled={closing || !activeShift}>
              {closing ? t.closing : t.closeBtn}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          <form onSubmit={addCashAdjustment} className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.adjustTitle}</h2>
            <div className="fdDataGrid">
              <select
                className="input"
                value={adjustDirection}
                onChange={(e) => setAdjustDirection(e.target.value === "outflow" ? "outflow" : "inflow")}
              >
                <option value="inflow">{t.adjustDirectionIn}</option>
                <option value="outflow">{t.adjustDirectionOut}</option>
              </select>
              <input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder={t.adjustAmount} className="input" />
              <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={t.adjustReason} className="input" />
              <input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder={t.adjustNote} className="input" />
            </div>
            <button type="submit" className="fdPillBtn fdPillBtnPrimary" style={{ marginTop: 10 }} disabled={adjusting || !activeShift}>
              {adjusting ? t.adjusting : t.adjustBtn}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 14 }}>
          {activeSummary ? (
            <div className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 12 }}>
              <h3 className="sectionTitle" style={{ marginTop: 0, marginBottom: 8 }}>{lang === "zh" ? "當前班別對帳" : "Current Shift Reconciliation"}</h3>
              <div className="fdDataGrid">
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "開班現金" : "Opening Cash"}: {activeSummary.openingCash}
                </p>
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "預期現金" : "Expected Cash"}: {activeSummary.expectedCash}
                </p>
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "現金流入/流出" : "Cash In/Out"}: {activeSummary.inflow.cash} / {activeSummary.outflow.cash}
                </p>
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "現金異動淨額" : "Cash Adjustment Net"}: {activeSummary.cashAdjustmentNet}
                </p>
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "支付筆數" : "Payments"}: {activeSummary.counts.payments}, {lang === "zh" ? "退款" : "Refunds"}: {activeSummary.counts.refunds}
                </p>
                <p className="fdGlassText" style={{ marginTop: 0 }}>
                  {lang === "zh" ? "作廢/發票/入場/核銷" : "Voids/Invoices/Check-ins/Redemptions"}: {activeSummary.counts.voids}/{activeSummary.counts.invoices}/{activeSummary.counts.checkins}/{activeSummary.counts.redemptions}
                </p>
              </div>
            </div>
          ) : null}
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
