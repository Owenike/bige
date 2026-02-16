"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n-provider";
import { FrontdeskCheckinView } from "./checkin/CheckinView";
import { FrontdeskMemberSearchView } from "./member-search/MemberSearchView";

type CapabilityStatus = "ready" | "building" | "planned";
type FrontdeskModalType = "capability" | "entry" | "member";
type CapabilityCard = {
  id: string;
  title: string;
  desc: string;
  detail: string;
  area: string;
  status: CapabilityStatus;
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
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [modalType, setModalType] = useState<FrontdeskModalType>("capability");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string>("member");

  const openCapabilityModal = useCallback((id: string, type: FrontdeskModalType = "capability") => {
    setModalType(type);
    setSelectedCapabilityId(id);
    setCapabilityOpen(true);
  }, []);

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
    setPortalReady(true);
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
            capabilityTitle: "櫃檯能力地圖",
            capabilitySub: "A~K 全模組進度：優先完成可營運與高風險稽核。",
            capabilityOpenBtn: "開啟能力地圖",
            capabilityModalTitle: "櫃檯能力地圖（A~K）",
            capabilityDetailTitle: "模組說明",
            capabilityCurrent: "目前選擇",
            entryModalTitle: "入場放行",
            entryModalDesc: "快速進入入場流程，支援掃碼驗證與人工放行。",
            entryModalHint: "建議：尖峰時段優先使用掃碼入場，例外情境再用人工放行。",
            memberModalTitle: "會員查詢 / 建檔",
            memberModalDesc: "快速查詢既有會員或建立新會員，並支援防重複建檔。",
            memberModalHint: "建議：先查詢再建檔，避免重複資料。",
            openCheckinPage: "開啟入場作業頁",
            openMemberPage: "開啟會員作業頁",
            close: "關閉",
            ready: "已上線",
            building: "建置中",
            planned: "規劃中",
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
            capabilityTitle: "Frontdesk Capability Map",
            capabilitySub: "A-K module progress with operations-first and audit-first rollout.",
            capabilityOpenBtn: "Open Capability Map",
            capabilityModalTitle: "Frontdesk Capability Map (A-K)",
            capabilityDetailTitle: "Module Detail",
            capabilityCurrent: "Current",
            entryModalTitle: "Entry Access",
            entryModalDesc: "Open check-in flow with scanner and exception handling.",
            entryModalHint: "Tip: Use scanner first during peak hours, then manual allow for exceptions.",
            memberModalTitle: "Member Search / Create",
            memberModalDesc: "Search existing members or create new profiles with duplicate prevention.",
            memberModalHint: "Tip: Search first before create to avoid duplicates.",
            openCheckinPage: "Open Check-in Workspace",
            openMemberPage: "Open Member Workspace",
            close: "Close",
            ready: "Ready",
            building: "Building",
            planned: "Planned",
          },
    [lang, pendingItems, shiftState],
  );

  const capabilityCards = useMemo(
    (): CapabilityCard[] =>
      lang === "zh"
        ? [
            { id: "entry", title: "A. 入場 / 放行", desc: "掃碼、人工放行、取消誤刷、原因碼與稽核。", detail: "支援會員卡 / QR / 人工例外放行，並要求原因碼與備註，完整寫入稽核。", area: "ENTRY", status: "building" },
            { id: "member", title: "B. 會員查詢 / 建檔", desc: "防重複建檔、自訂欄位、快速下一步。", detail: "支援電話/姓名搜尋、防重複建立、補資料與自訂欄位，櫃檯可直接接續收款與預約。", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. 收銀 / POS / 發票", desc: "訂單收款、退費/作廢送審、結帳流程。", detail: "包含櫃檯收款、多付款方式、退費與作廢送審流程，並保留稽核軌跡。", area: "POS", status: "building" },
            { id: "booking", title: "D. 預約 / 課務", desc: "建立即時預約與課務調整。", detail: "可建立、改期、取消課務預約，支援現場快速調整時段。", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. 置物櫃 / 租借", desc: "置物櫃租用與租借物管理（下一批）。", detail: "規劃中：置物櫃租期、押金、逾期與租借物品生命週期管理。", area: "LOCKER", status: "planned" },
            { id: "inventory", title: "F. 商品 / 庫存 / 銷售", desc: "前台銷售與庫存追蹤。", detail: "建置中：商品銷售、庫存扣減、低庫存提醒與追溯。", area: "INVENTORY", status: "building" },
            { id: "cs", title: "G. 客服 / 事件紀錄", desc: "客訴與事件工單（含附件與追蹤）。", detail: "規劃中：客訴工單、現場事件與後續追蹤，支援附件紀錄。", area: "CS", status: "planned" },
            { id: "lead", title: "H. 線索 / 參觀導覽", desc: "Lead 建檔、轉會員、追蹤轉換。", detail: "規劃中：潛在客建檔、導覽排程與轉會員流程。", area: "LEAD", status: "planned" },
            { id: "chain", title: "I. 跨店規則", desc: "跨店可用範圍、停權/黑名單同步。", detail: "建置中：跨店入場規則、停權同步、可用店範圍控制。", area: "CHAIN", status: "building" },
            { id: "report", title: "J. 報表 / 即時監控", desc: "今日營收、到期、欠費、No-show、待辦。", detail: "建置中：櫃檯今日營運看板與交接待辦彙總。", area: "REPORT", status: "building" },
            { id: "audit", title: "K. 權限 / 稽核", desc: "高風險送審、角色權限、完整稽核軌跡。", detail: "已上線：高風險動作送審、管理者核准/駁回、完整 Audit Log。", area: "AUDIT", status: "ready" },
          ]
        : [
            { id: "entry", title: "A. Entry / Allow", desc: "Scan, exception pass, undo, reason code with audit.", detail: "Supports card/QR/manual exception pass with reason code and full audit trail.", area: "ENTRY", status: "building" },
            { id: "member", title: "B. Member Search / Create", desc: "Duplicate prevention, custom fields, quick actions.", detail: "Search/create with duplicate prevention and configurable custom fields.", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. POS / Invoice", desc: "Order payment, refund/void approval flow.", detail: "Desk payment, multi-method checkout, and approved high-risk refund/void flow.", area: "POS", status: "building" },
            { id: "booking", title: "D. Booking / Classes", desc: "Booking creation and class schedule handling.", detail: "Create, reschedule, and cancel class bookings from desk operations.", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. Locker / Rental", desc: "Locker contracts and rental item lifecycle (next).", detail: "Planned: locker rental, deposit, overdue and rental lifecycle.", area: "LOCKER", status: "planned" },
            { id: "inventory", title: "F. Product / Inventory", desc: "Frontdesk selling and inventory traceability.", detail: "Building: product checkout, stock movement, and low-stock warnings.", area: "INVENTORY", status: "building" },
            { id: "cs", title: "G. Service / Incidents", desc: "Complaint and on-site incident ticket handling.", detail: "Planned: complaint tickets and on-site incident records with attachments.", area: "CS", status: "planned" },
            { id: "lead", title: "H. Lead / Tours", desc: "Lead intake, visit scheduling, conversion.", detail: "Planned: lead management, visit schedule, and conversion tracking.", area: "LEAD", status: "planned" },
            { id: "chain", title: "I. Multi-Branch Rules", desc: "Cross-branch policy and blacklist sync.", detail: "Building: cross-branch entry policies and blacklist synchronization.", area: "CHAIN", status: "building" },
            { id: "report", title: "J. Reports / Live Monitor", desc: "Revenue, due list, no-show, handover TODO.", detail: "Building: desk operational dashboards and handover task monitor.", area: "REPORT", status: "building" },
            { id: "audit", title: "K. Role / Audit", desc: "Approval workflow, role control, full audit logs.", detail: "Ready: approval workflow, role-based controls, and audit logs.", area: "AUDIT", status: "ready" },
          ],
    [lang],
  );

  const selectedCapability = useMemo(
    () => capabilityCards.find((item) => item.id === selectedCapabilityId) ?? capabilityCards[0],
    [capabilityCards, selectedCapabilityId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCapabilityOpen(false);
    };
    if (capabilityOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capabilityOpen]);

  useEffect(() => {
    if (!capabilityOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [capabilityOpen]);

  function statusLabel(status: CapabilityStatus) {
    if (status === "ready") return t.ready;
    if (status === "building") return t.building;
    return t.planned;
  }

  function statusStyle(status: CapabilityStatus) {
    if (status === "ready") {
      return { background: "rgba(34,184,166,.10)", borderColor: "rgba(34,184,166,.45)", color: "#137a6d" };
    }
    if (status === "building") {
      return { background: "rgba(255,255,255,.62)", borderColor: "rgba(164,176,194,.44)", color: "rgba(71,83,102,.86)" };
    }
    return { background: "rgba(255,255,255,.62)", borderColor: "rgba(164,176,194,.44)", color: "rgba(71,83,102,.86)" };
  }

  return (
    <main ref={sceneRef} className="fdGlassScene">
      <section className="fdGlassBackdrop fdEnter">
        {error ? <div className="error">{error}</div> : null}

        <div className="fdGlassTop">
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
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => openCapabilityModal("entry", "entry")}>
                {t.primary}
              </button>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => openCapabilityModal("member", "member")}>
                {t.secondary}
              </button>
              <button
                type="button"
                className="fdPillBtn fdPillBtnGhost"
                onClick={() => setSoundEnabled((prev) => !prev)}
              >
                {soundEnabled ? t.soundOn : t.soundOff}
              </button>
            </div>
          </article>

          <article className="fdGlassPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusOpen}</span>
              <span className="fdChip">{t.statusTasks}</span>
            </div>
            <h2 className="fdGlassTitle">{t.opsTitle}</h2>
            <div className="fdMetricLine">
              <span className="fdMetricLabel">{t.statusOpen}</span>
              <strong className="fdMetricValue">{t.statusOpenValue}</strong>
            </div>
            <div className="fdMetricLine">
              <span className="fdMetricLabel">{t.orders}</span>
              <strong className="fdMetricValue">{loading ? "-" : ordersToday}</strong>
            </div>
            <div className="fdMetricLine">
              <span className="fdMetricLabel">{t.paid}</span>
              <strong className="fdMetricValue">{loading ? "-" : paidToday}</strong>
            </div>
            <div className="fdMetricLine">
              <span className="fdMetricLabel">{t.revenue}</span>
              <strong className="fdMetricValue">{loading ? "-" : revenueToday}</strong>
            </div>
            <p className="fdGlassText" style={{ marginTop: 10, fontSize: 12 }}>{t.refresh}</p>
          </article>
        </div>

        <section className="fdGlassSubPanel" style={{ marginTop: 14, padding: 14 }}>
          <h2 className="sectionTitle">{t.capabilityTitle}</h2>
          <p className="fdGlassText" style={{ marginTop: 8 }}>{t.capabilitySub}</p>
          <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => openCapabilityModal("member", "capability")}>
            {t.capabilityOpenBtn}
          </button>
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          <article className="fdGlassSubPanel" style={{ padding: 14 }}>
            <h2 className="sectionTitle">{t.unpaidTitle}</h2>
            <div className="fdListStack" style={{ marginTop: 8 }}>
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
            <div className="fdListStack" style={{ marginTop: 8 }}>
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

        {capabilityOpen && portalReady ? createPortal((
          <div className={`fdModalBackdrop ${modalType === "capability" ? "" : "fdModalBackdropFeature"}`} onClick={() => setCapabilityOpen(false)} role="presentation">
            <div className={`fdModal ${modalType === "capability" ? "" : "fdModalFeature"}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t.capabilityModalTitle}>
              <div className="fdModalHead">
                <h2 className="sectionTitle" style={{ margin: 0 }}>
                  {modalType === "entry" ? t.entryModalTitle : modalType === "member" ? t.memberModalTitle : t.capabilityModalTitle}
                </h2>
                <button type="button" className="fdPillBtn fdPillBtnGhost fdModalCloseBtn" onClick={() => setCapabilityOpen(false)}>
                  {t.close}
                </button>
              </div>
              {modalType === "capability" ? (
                <div className="fdModalLayout" style={{ marginTop: 10 }}>
                  <div className="fdModalList">
                    {capabilityCards.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`fdGlassSubPanel fdCapabilityCard fdModalCapabilityItem ${selectedCapability?.id === item.id ? "fdCapabilityCardActive" : ""}`}
                        onClick={() => setSelectedCapabilityId(item.id)}
                      >
                        <div className="fdActionHead">
                          <span className="kvLabel">{item.area}</span>
                          <span className="fdChip" style={statusStyle(item.status)}>
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <h3 className="fdActionTitle">{item.title}</h3>
                        <p className="sub fdCapabilityDesc" style={{ marginTop: 8 }}>{item.desc}</p>
                      </button>
                    ))}
                  </div>
                  {selectedCapability ? (
                    <div className="fdGlassSubPanel fdModalDetail">
                      <div className="fdActionHead">
                        <span className="kvLabel">{t.capabilityCurrent}</span>
                        <span className="fdChip" style={statusStyle(selectedCapability.status)}>
                          {statusLabel(selectedCapability.status)}
                        </span>
                      </div>
                      <h3 className="fdActionTitle" style={{ marginTop: 8 }}>{selectedCapability.title}</h3>
                      <p className="sub" style={{ marginTop: 8 }}>{selectedCapability.detail}</p>
                      <div className="fdGlassSubPanel" style={{ marginTop: 12, padding: 10 }}>
                        <div className="kvLabel">{t.capabilityDetailTitle}</div>
                        <p className="sub" style={{ marginTop: 6 }}>{selectedCapability.desc}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="fdModalFeatureBody">
                  {modalType === "entry" ? <FrontdeskCheckinView embedded /> : <FrontdeskMemberSearchView embedded />}
                </div>
              )}
            </div>
          </div>
        ), document.body) : null}
      </section>
    </main>
  );
}
