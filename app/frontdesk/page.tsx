"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n-provider";

type ActionCard = {
  href: string;
  title: string;
  desc: string;
  tag: string;
};

type ShiftItem = {
  id: string;
  status: string;
  opened_at: string;
};

type BookingItem = {
  id: string;
  member_id: string;
  service_name: string;
  status: string;
  starts_at: string;
};

type OrderItem = {
  id: string;
  member_id: string | null;
  status: string;
  amount: number;
  created_at: string;
};

function isSameLocalDay(iso: string, now: Date) {
  const date = new Date(iso);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function fmtDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function minutesSince(value: string) {
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

function minutesUntil(value: string) {
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor((ts - Date.now()) / 60000);
}

function playNotificationTone() {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Browser may block autoplay audio until user interaction.
  }
}

export default function FrontdeskPortalPage() {
  const { locale } = useI18n();
  const lang: "zh" | "en" = locale === "en" ? "en" : "zh";
  const sceneRef = useRef<HTMLElement | null>(null);
  const overdueOrderIdsRef = useRef<Set<string> | null>(null);
  const loadingRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftState, setShiftState] = useState<"open" | "closed">("closed");
  const [pendingItems, setPendingItems] = useState(0);
  const [ordersToday, setOrdersToday] = useState(0);
  const [paidToday, setPaidToday] = useState(0);
  const [revenueToday, setRevenueToday] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [unpaidOrderList, setUnpaidOrderList] = useState<OrderItem[]>([]);
  const [upcomingBookingList, setUpcomingBookingList] = useState<BookingItem[]>([]);

  useEffect(() => {
    const onScroll = () => {
      if (!sceneRef.current) return;
      const y = Math.min(window.scrollY || 0, 320);
      sceneRef.current.style.setProperty("--fd-scroll", `${y}px`);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("frontdesk_sound_enabled");
    if (saved === "0") setSoundEnabled(false);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("frontdesk_sound_enabled", soundEnabled ? "1" : "0");
  }, [soundEnabled]);

  const loadDashboard = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [shiftsRes, bookingsRes, ordersRes] = await Promise.all([
        fetch("/api/frontdesk/handover"),
        fetch("/api/bookings"),
        fetch("/api/orders"),
      ]);

      const [shiftsPayload, bookingsPayload, ordersPayload] = await Promise.all([
        shiftsRes.json(),
        bookingsRes.json(),
        ordersRes.json(),
      ]);

      if (!shiftsRes.ok) throw new Error(shiftsPayload?.error || "Load shifts failed");
      if (!bookingsRes.ok) throw new Error(bookingsPayload?.error || "Load bookings failed");
      if (!ordersRes.ok) throw new Error(ordersPayload?.error || "Load orders failed");

      const shifts = (shiftsPayload.items || []) as ShiftItem[];
      const bookings = (bookingsPayload.items || []) as BookingItem[];
      const orders = (ordersPayload.items || []) as OrderItem[];

      const now = new Date();
      const nowMs = now.getTime();
      const inTwoHoursMs = nowMs + 2 * 60 * 60 * 1000;
      const openShift = shifts.find((item) => item.status === "open");
      const todayOrders = orders.filter((item) => isSameLocalDay(item.created_at, now));
      const todayPaidOrders = todayOrders.filter((item) => item.status === "paid");
      const unpaidOrders = todayOrders
        .filter((item) => !["paid", "cancelled", "voided", "refunded"].includes(item.status))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const upcomingBookings = bookings
        .filter((item) => {
          if (item.status !== "booked") return false;
          const startsAtMs = new Date(item.starts_at).getTime();
          return startsAtMs >= nowMs && startsAtMs <= inTwoHoursMs;
        })
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

      const currentOverdueIds = new Set(
        unpaidOrders.filter((item) => minutesSince(item.created_at) >= 15).map((item) => item.id),
      );
      if (overdueOrderIdsRef.current) {
        const hasNewOverdue = Array.from(currentOverdueIds).some((id) => !overdueOrderIdsRef.current?.has(id));
        if (hasNewOverdue && soundEnabled) playNotificationTone();
      }
      overdueOrderIdsRef.current = currentOverdueIds;

      setShiftState(openShift ? "open" : "closed");
      setPendingItems(unpaidOrders.length + upcomingBookings.length);
      setOrdersToday(todayOrders.length);
      setPaidToday(todayPaidOrders.length);
      setRevenueToday(todayPaidOrders.reduce((sum, item) => sum + Number(item.amount || 0), 0));
      setUnpaidOrderList(unpaidOrders.slice(0, 5));
      setUpcomingBookingList(upcomingBookings.slice(0, 5));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load dashboard failed");
    } finally {
      loadingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [soundEnabled]);

  useEffect(() => {
    void loadDashboard(false);
    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  const completionRate = useMemo(() => {
    if (!ordersToday) return 0;
    return Math.min(100, Math.round((paidToday / ordersToday) * 100));
  }, [ordersToday, paidToday]);

  const t = useMemo(
    () =>
      lang === "zh"
        ? {
            badge: "櫃檯中心",
            title: "櫃檯工作台",
            sub: "整合入場、會員、收款、預約與交班的即時作業中控。",
            primary: "開始掃碼入場",
            secondary: "會員查詢 / 建立",
            statusTitle: "今日班次",
            statusOpen: "班次狀態",
            statusOpenValue: shiftState === "open" ? "進行中" : "未開班",
            statusTasks: "待處理",
            statusTasksValue: `${pendingItems} 項`,
            statusTip: "先完成入場與收款，再執行交班結算。",
            opsTitle: "今日營運",
            completion: "收款完成率",
            orders: "今日訂單",
            paid: "已收款",
            revenue: "收款金額",
            refresh: "每 30 秒自動刷新即時數據。",
            soundOn: "提示音開啟",
            soundOff: "提示音靜音",
            unpaidTitle: "未結帳訂單（今日）",
            upcomingTitle: "即將到店（2 小時內）",
            emptyUnpaid: "目前沒有待收款訂單。",
            emptyUpcoming: "目前沒有即將到店預約。",
            collectAction: "去收款",
            bookingAction: "看預約",
            overdue: "逾時",
            minutes: "分鐘",
            dueSoon: "即將開始",
            normal: "一般",
            cards: [
              { href: "/frontdesk/orders/new", title: "新增訂單 + 收款", desc: "建立櫃檯訂單並完成付款流程。", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "預約協助", desc: "協助建立、改期與取消預約。", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "交班結算", desc: "完成班次收尾與交接。", tag: "SHIFT" },
            ] as ActionCard[],
          }
        : {
            badge: "FRONTDESK",
            title: "Frontdesk Workspace",
            sub: "Unified control panel for entry, members, payments, bookings, and handover.",
            primary: "Start Check-in Scanner",
            secondary: "Member Search / Create",
            statusTitle: "Today Shift",
            statusOpen: "Shift State",
            statusOpenValue: shiftState === "open" ? "Open" : "Closed",
            statusTasks: "Pending",
            statusTasksValue: `${pendingItems} items`,
            statusTip: "Finish check-ins and payments first, then run shift handover.",
            opsTitle: "Today Operations",
            completion: "Payment Completion",
            orders: "Orders Today",
            paid: "Paid Orders",
            revenue: "Collected",
            refresh: "Live metrics auto-refresh every 30 seconds.",
            soundOn: "Sound On",
            soundOff: "Sound Off",
            unpaidTitle: "Unpaid Orders (Today)",
            upcomingTitle: "Arriving Soon (Next 2 Hours)",
            emptyUnpaid: "No pending payment orders.",
            emptyUpcoming: "No upcoming bookings.",
            collectAction: "Collect",
            bookingAction: "View",
            overdue: "Overdue",
            minutes: "min",
            dueSoon: "Starting Soon",
            normal: "Normal",
            cards: [
              { href: "/frontdesk/orders/new", title: "New Order + Payment", desc: "Create desk orders and complete payment flow.", tag: "PAYMENT" },
              { href: "/frontdesk/bookings", title: "Booking Assist", desc: "Create, reschedule, and cancel bookings quickly.", tag: "BOOKING" },
              { href: "/frontdesk/handover", title: "Shift Handover", desc: "Close shift with clean financial handoff.", tag: "SHIFT" },
            ] as ActionCard[],
          },
    [lang, pendingItems, shiftState],
  );

  return (
    <main ref={sceneRef} className="fdGlassScene">
      <section className="fdGlassBackdrop fdEnter">
        {error ? <div className="error">{error}</div> : null}

        <div className="fdGlassTop">
          <article className="fdGlassPanel fdGlassTall">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.badge}</span>
              <span className="fdChip">{t.statusOpenValue}</span>
            </div>
            <h2 className="fdGlassTitle">{t.title}</h2>
            <p className="fdGlassText">{t.sub}</p>
            <div className="fdGaugeWrap">
              <div className="fdGaugeRing" />
              <div className="fdGaugeValue">{loading ? "..." : `${completionRate}%`}</div>
            </div>
            <p className="fdGlassText" style={{ marginTop: 8 }}>{t.completion}</p>
          </article>

          <article className="fdGlassPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusTitle}</span>
              <span className="fdChip">{t.statusTasksValue}</span>
            </div>
            <h2 className="fdGlassTitle" style={{ marginTop: 16 }}>
              {lang === "zh" ? "櫃檯作業" : "Frontdesk Ops"}
            </h2>
            <p className="fdGlassText">{t.statusTip}</p>
            <div className="fdPillActions">
              <a className="fdPillBtn fdPillBtnPrimary" href="/frontdesk/checkin">
                {t.primary}
              </a>
              <a className="fdPillBtn" href="/frontdesk/member-search">
                {t.secondary}
              </a>
              <button
                type="button"
                className="fdPillBtn"
                onClick={() => setSoundEnabled((prev) => !prev)}
              >
                {soundEnabled ? t.soundOn : t.soundOff}
              </button>
            </div>
          </article>

          <article className="fdGlassPanel fdGlassTall">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusOpen}</span>
              <span className="fdChip">{t.statusTasks}</span>
            </div>
            <h2 className="fdGlassTitle">{t.opsTitle}</h2>
            <div className="fdMetricLine">
              <span>{t.statusOpen}</span>
              <strong>{t.statusOpenValue}</strong>
            </div>
            <div className="fdMetricLine">
              <span>{t.orders}</span>
              <strong>{loading ? "-" : ordersToday}</strong>
            </div>
            <div className="fdMetricLine">
              <span>{t.paid}</span>
              <strong>{loading ? "-" : paidToday}</strong>
            </div>
            <div className="fdMetricLine">
              <span>{t.revenue}</span>
              <strong>{loading ? "-" : revenueToday}</strong>
            </div>
            <p className="fdGlassText" style={{ marginTop: 10, fontSize: 12 }}>{t.refresh}</p>
          </article>
        </div>

        <section style={{ marginTop: 14 }}>
          <div className="fdActionGrid">
            {t.cards.map((card, idx) => (
              <a
                key={card.href}
                href={card.href}
                className="fdGlassSubPanel fdActionCard fdEnter"
                style={{ animationDelay: `${120 + idx * 60}ms` }}
              >
                <div className="fdActionHead">
                  <span className="kvLabel">{card.tag}</span>
                  <span className="fdArrow">{">>"}</span>
                </div>
                <h3 className="fdActionTitle">{card.title}</h3>
                <p className="sub" style={{ marginTop: 8 }}>
                  {card.desc}
                </p>
              </a>
            ))}
          </div>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <article className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.unpaidTitle}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {unpaidOrderList.map((item) => {
                const ageMin = minutesSince(item.created_at);
                const isOverdue = ageMin >= 15;
                const badgeStyle = isOverdue
                  ? { background: "rgba(190, 24, 93, 0.22)", borderColor: "rgba(190, 24, 93, 0.6)", color: "#fecdd3" }
                  : { background: "rgba(234, 179, 8, 0.18)", borderColor: "rgba(234, 179, 8, 0.5)", color: "#fde68a" };

                return (
                  <div key={item.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <p className="sub" style={{ marginTop: 0 }}>{item.id.slice(0, 8)} | {item.status} | {item.amount}</p>
                      <span className="fdChip" style={badgeStyle}>
                        {isOverdue ? `${t.overdue} ${ageMin}${t.minutes}` : `${ageMin}${t.minutes}`}
                      </span>
                    </div>
                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                    <a className="fdPillBtn" style={{ marginTop: 8, display: "inline-flex" }} href={`/frontdesk/orders/new?orderId=${encodeURIComponent(item.id)}`}>
                      {t.collectAction}
                    </a>
                  </div>
                );
              })}
              {!loading && unpaidOrderList.length === 0 ? <p className="fdGlassText">{t.emptyUnpaid}</p> : null}
            </div>
          </article>

          <article className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.upcomingTitle}</h2>
            <div className="fdDataGrid" style={{ marginTop: 8 }}>
              {upcomingBookingList.map((item) => {
                const mins = minutesUntil(item.starts_at);
                const isSoon = mins <= 15;
                const badgeStyle = isSoon
                  ? { background: "rgba(37, 99, 235, 0.22)", borderColor: "rgba(37, 99, 235, 0.55)", color: "#bfdbfe" }
                  : { background: "rgba(16, 185, 129, 0.18)", borderColor: "rgba(16, 185, 129, 0.45)", color: "#bbf7d0" };

                return (
                  <div key={item.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <p className="sub" style={{ marginTop: 0 }}>{item.service_name || "-"}</p>
                      <span className="fdChip" style={badgeStyle}>
                        {isSoon ? `${t.dueSoon} (${Math.max(0, mins)}${t.minutes})` : t.normal}
                      </span>
                    </div>
                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.starts_at)}</p>
                    <p className="sub" style={{ marginTop: 4 }}>#{item.member_id}</p>
                    <a className="fdPillBtn" style={{ marginTop: 8, display: "inline-flex" }} href="/frontdesk/bookings">
                      {t.bookingAction}
                    </a>
                  </div>
                );
              })}
              {!loading && upcomingBookingList.length === 0 ? <p className="fdGlassText">{t.emptyUpcoming}</p> : null}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
