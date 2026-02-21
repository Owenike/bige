"use client";

import { FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n-provider";
import { FrontdeskCheckinView } from "./checkin/CheckinView";
import { FrontdeskMemberSearchView } from "./member-search/MemberSearchView";

type CapabilityStatus = "ready" | "building" | "planned";
type FrontdeskModalType = "capability" | "entry" | "member" | "handover";
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
  opened_by?: string | null;
  opened_by_name?: string | null;
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

type PosOrderItem = {
  id: string;
  member_id: string | null;
  status: string;
  amount: number;
  channel: string;
  note?: string | null;
  created_at: string;
  updated_at?: string;
  branch_id?: string | null;
};

type PosPaymentItem = {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  method: string;
  gateway_ref?: string | null;
  paid_at?: string | null;
};

type PosApprovalItem = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: string;
  decision_note?: string | null;
  created_at: string;
  resolved_at?: string | null;
};

type PosAuditItem = {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  created_at: string;
};

type PosInvoiceEvent = {
  id: string;
  action: string;
  target_id: string;
  reason: string | null;
  payload?: {
    invoiceNo?: string;
    amount?: number;
    carrier?: string | null;
    taxId?: string | null;
    buyerName?: string | null;
    allowanceAmount?: number;
    [key: string]: unknown;
  };
  created_at: string;
};

type LockerRentalItem = {
  id: string;
  lockerCode: string;
  memberId: string | null;
  memberCode: string;
  renterName: string;
  phone: string;
  depositAmount: number;
  note: string;
  status: "active" | "returned" | "cancelled" | string;
  rentalTerm: "daily" | "monthly" | "half_year" | "yearly" | "custom" | string;
  rentedAt: string;
  dueAt: string | null;
  returnedAt: string | null;
};

type LockerRentalTerm = "daily" | "monthly" | "half_year" | "yearly" | "custom";

type InventoryProductItem = {
  code: string;
  title: string;
  unitPrice: number;
  unitQuantity: number;
  onHand: number;
  safetyStock: number;
  isLowStock: boolean;
};

type InventoryMoveItem = {
  id: string;
  productCode: string;
  delta: number;
  reason: string;
  note: string;
  orderId: string | null;
  createdAt: string;
};

type CsIncidentEventItem = {
  id: string;
  action: string;
  note: string;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
};

type CsIncidentItem = {
  id: string;
  incidentNo: string;
  incidentType: string;
  priority: string;
  status: string;
  source: string;
  memberId: string | null;
  memberCode: string;
  memberName: string;
  contactPhone: string;
  title: string;
  detail: string;
  happenedAt: string | null;
  dueAt: string | null;
  resolutionNote: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: CsIncidentEventItem[];
};

type LeadStatus = "new" | "tour_scheduled" | "converted" | "lost";

type LeadEventItem = {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
};

type LeadItem = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  interest: string | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  tourAt: string | null;
  memberId: string | null;
  note: string | null;
  lastReason: string | null;
  events: LeadEventItem[];
};

type ChainRuleItem = {
  allowCrossBranch: boolean;
  requireManagerApproval: boolean;
  suspensionSync: boolean;
  guestPassEnabled: boolean;
  maxEntryPerDay: number | null;
  allowedBranchIds: string[];
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type ChainBlacklistItem = {
  id: string;
  name: string;
  memberCode: string | null;
  phone: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

function isMemberCode(value: string) {
  if (!/^\d{1,4}$/.test(value)) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 9999;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

function parseAmount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseDateTimeInput(value: string) {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function addMonths(base: Date, months: number) {
  const date = new Date(base);
  const dayOfMonth = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < dayOfMonth) {
    date.setDate(0);
  }
  return date;
}

function calcLockerDueAtByTerm(term: LockerRentalTerm) {
  const now = new Date();
  if (term === "daily") return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  if (term === "monthly") return addMonths(now, 1).toISOString();
  if (term === "half_year") return addMonths(now, 6).toISOString();
  if (term === "yearly") return addMonths(now, 12).toISOString();
  return null;
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
  const capabilityRingRef = useRef<HTMLDivElement | null>(null);
  const capabilityDragStateRef = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startAngle: 0,
    moved: false,
  });
  const capabilitySuppressClickRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftState, setShiftState] = useState<"open" | "closed" | "unknown">("unknown");
  const [activeShift, setActiveShift] = useState<ShiftItem | null>(null);
  const [shiftActionError, setShiftActionError] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState(0);
  const [ordersToday, setOrdersToday] = useState(0);
  const [paidToday, setPaidToday] = useState(0);
  const [revenueToday, setRevenueToday] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [unpaidOrderList, setUnpaidOrderList] = useState<OrderItem[]>([]);
  const [upcomingBookingList, setUpcomingBookingList] = useState<BookingItem[]>([]);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [capabilityRailDragging, setCapabilityRailDragging] = useState(false);
  const [capabilityRingAngle, setCapabilityRingAngle] = useState(0);
  const [modalType, setModalType] = useState<FrontdeskModalType>("capability");
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string>("member");
  const [toolbarQuery, setToolbarQuery] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [openingNote, setOpeningNote] = useState("");
  const [openingShift, setOpeningShift] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [closeCashTotal, setCloseCashTotal] = useState("0");
  const [closeCardTotal, setCloseCardTotal] = useState("0");
  const [closeTransferTotal, setCloseTransferTotal] = useState("0");
  const [closeNote, setCloseNote] = useState("");
  const [posMemberId, setPosMemberId] = useState("");
  const [posSubtotal, setPosSubtotal] = useState("0");
  const [posDiscountAmount, setPosDiscountAmount] = useState("0");
  const [posDiscountNote, setPosDiscountNote] = useState("");
  const [posManagerOverride, setPosManagerOverride] = useState(false);
  const [posNote, setPosNote] = useState("");
  const [posOrderId, setPosOrderId] = useState("");
  const [posPaymentAmount, setPosPaymentAmount] = useState("0");
  const [posPaymentMethod, setPosPaymentMethod] = useState("cash");
  const [posCheckoutUrl, setPosCheckoutUrl] = useState("");
  const [posOrders, setPosOrders] = useState<PosOrderItem[]>([]);
  const [posPayments, setPosPayments] = useState<PosPaymentItem[]>([]);
  const [posApprovals, setPosApprovals] = useState<PosApprovalItem[]>([]);
  const [posAudit, setPosAudit] = useState<PosAuditItem[]>([]);
  const [posInvoices, setPosInvoices] = useState<PosInvoiceEvent[]>([]);
  const [posInvoiceTaxId, setPosInvoiceTaxId] = useState("");
  const [posInvoiceCarrier, setPosInvoiceCarrier] = useState("");
  const [posInvoiceBuyerName, setPosInvoiceBuyerName] = useState("");
  const [posInvoiceNo, setPosInvoiceNo] = useState("");
  const [posAllowanceAmount, setPosAllowanceAmount] = useState("0");
  const [posVoidReason, setPosVoidReason] = useState("");
  const [posRefundPaymentId, setPosRefundPaymentId] = useState("");
  const [posRefundReason, setPosRefundReason] = useState("");
  const [posInvoiceReason, setPosInvoiceReason] = useState("");
  const [posLoading, setPosLoading] = useState(false);
  const [posCreatingOrder, setPosCreatingOrder] = useState(false);
  const [posPayingOrder, setPosPayingOrder] = useState(false);
  const [posInitializingCheckout, setPosInitializingCheckout] = useState(false);
  const [posSubmittingRisk, setPosSubmittingRisk] = useState(false);
  const [posSubmittingInvoice, setPosSubmittingInvoice] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [posMessage, setPosMessage] = useState<string | null>(null);
  const [lockerRentals, setLockerRentals] = useState<LockerRentalItem[]>([]);
  const [lockerLoading, setLockerLoading] = useState(false);
  const [lockerSubmitting, setLockerSubmitting] = useState(false);
  const [lockerError, setLockerError] = useState<string | null>(null);
  const [lockerMessage, setLockerMessage] = useState<string | null>(null);
  const [lockerCode, setLockerCode] = useState("");
  const [lockerMemberId, setLockerMemberId] = useState("");
  const [lockerRenterName, setLockerRenterName] = useState("");
  const [lockerPhone, setLockerPhone] = useState("");
  const [lockerDeposit, setLockerDeposit] = useState("0");
  const [lockerRentalTerm, setLockerRentalTerm] = useState<LockerRentalTerm>("daily");
  const [lockerDueAt, setLockerDueAt] = useState("");
  const [lockerNote, setLockerNote] = useState("");
  const [inventoryItems, setInventoryItems] = useState<InventoryProductItem[]>([]);
  const [inventoryMoves, setInventoryMoves] = useState<InventoryMoveItem[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventorySubmitting, setInventorySubmitting] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryMessage, setInventoryMessage] = useState<string | null>(null);
  const [createProductCode, setCreateProductCode] = useState("");
  const [createProductTitle, setCreateProductTitle] = useState("");
  const [createProductUnitPrice, setCreateProductUnitPrice] = useState("0");
  const [createProductOnHand, setCreateProductOnHand] = useState("0");
  const [createProductSafetyStock, setCreateProductSafetyStock] = useState("5");
  const [createProductSortOrder, setCreateProductSortOrder] = useState("0");
  const [saleProductCode, setSaleProductCode] = useState("");
  const [saleQty, setSaleQty] = useState("1");
  const [saleMemberCode, setSaleMemberCode] = useState("");
  const [salePaymentMethod, setSalePaymentMethod] = useState("cash");
  const [saleNote, setSaleNote] = useState("");
  const [adjustProductCode, setAdjustProductCode] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustNote, setAdjustNote] = useState("");
  const [csIncidents, setCsIncidents] = useState<CsIncidentItem[]>([]);
  const [csLoading, setCsLoading] = useState(false);
  const [csSubmitting, setCsSubmitting] = useState(false);
  const [csError, setCsError] = useState<string | null>(null);
  const [csMessage, setCsMessage] = useState<string | null>(null);
  const [csFilterStatus, setCsFilterStatus] = useState<"all" | "open" | "in_progress" | "resolved" | "closed">("all");
  const [csIncidentType, setCsIncidentType] = useState("complaint");
  const [csPriority, setCsPriority] = useState("normal");
  const [csSource, setCsSource] = useState("frontdesk");
  const [csMemberCode, setCsMemberCode] = useState("");
  const [csMemberName, setCsMemberName] = useState("");
  const [csContactPhone, setCsContactPhone] = useState("");
  const [csCaseTitle, setCsCaseTitle] = useState("");
  const [csCaseDetail, setCsCaseDetail] = useState("");
  const [csHappenedAt, setCsHappenedAt] = useState("");
  const [csDueAt, setCsDueAt] = useState("");
  const [csSelectedIncidentId, setCsSelectedIncidentId] = useState("");
  const [csStatusTo, setCsStatusTo] = useState<"open" | "in_progress" | "resolved" | "closed">("in_progress");
  const [csStatusNote, setCsStatusNote] = useState("");
  const [csFollowupNote, setCsFollowupNote] = useState("");
  const [csResolveNote, setCsResolveNote] = useState("");
  const [leadItems, setLeadItems] = useState<LeadItem[]>([]);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [leadMessage, setLeadMessage] = useState<string | null>(null);
  const [leadStatusFilter, setLeadStatusFilter] = useState<"all" | LeadStatus>("all");
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadSource, setLeadSource] = useState("walkin");
  const [leadInterest, setLeadInterest] = useState("membership");
  const [leadCreateNote, setLeadCreateNote] = useState("");
  const [leadCreateTourAt, setLeadCreateTourAt] = useState("");
  const [leadSelectedId, setLeadSelectedId] = useState("");
  const [leadScheduleTourAt, setLeadScheduleTourAt] = useState("");
  const [leadScheduleNote, setLeadScheduleNote] = useState("");
  const [leadFollowupNote, setLeadFollowupNote] = useState("");
  const [leadConvertMemberId, setLeadConvertMemberId] = useState("");
  const [leadConvertNote, setLeadConvertNote] = useState("");
  const [leadLostReason, setLeadLostReason] = useState("");
  const [leadLostNote, setLeadLostNote] = useState("");
  const [chainLoading, setChainLoading] = useState(false);
  const [chainSubmitting, setChainSubmitting] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [chainMessage, setChainMessage] = useState<string | null>(null);
  const [chainRule, setChainRule] = useState<ChainRuleItem>({
    allowCrossBranch: true,
    requireManagerApproval: true,
    suspensionSync: true,
    guestPassEnabled: false,
    maxEntryPerDay: null,
    allowedBranchIds: [],
    note: null,
    updatedAt: null,
    updatedBy: null,
  });
  const [chainAllowedBranchText, setChainAllowedBranchText] = useState("");
  const [chainMaxEntryPerDayText, setChainMaxEntryPerDayText] = useState("");
  const [chainRuleNote, setChainRuleNote] = useState("");
  const [chainBlacklistItems, setChainBlacklistItems] = useState<ChainBlacklistItem[]>([]);
  const [chainBlacklistName, setChainBlacklistName] = useState("");
  const [chainBlacklistMemberCode, setChainBlacklistMemberCode] = useState("");
  const [chainBlacklistPhone, setChainBlacklistPhone] = useState("");
  const [chainBlacklistReason, setChainBlacklistReason] = useState("");
  const [chainBlacklistExpiresAt, setChainBlacklistExpiresAt] = useState("");
  const [chainRemoveTargetId, setChainRemoveTargetId] = useState("");
  const [chainRemoveReason, setChainRemoveReason] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const openCapabilityModal = useCallback((id: string, type: FrontdeskModalType = "capability") => {
    setModalType(type);
    setSelectedCapabilityId(id);
    setCapabilityOpen(true);
  }, []);

  const capabilityModalTypeById = useCallback((id: string): FrontdeskModalType => {
    if (id === "entry") return "entry";
    if (id === "member") return "member";
    return "capability";
  }, []);

  const openCapabilityShortcut = useCallback((id: string) => {
    openCapabilityModal(id, capabilityModalTypeById(id));
  }, [capabilityModalTypeById, openCapabilityModal]);

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
    document.body.classList.add("fdPageDark");
    return () => {
      document.body.classList.remove("fdPageDark");
    };
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
      setActiveShift(openShift || null);
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
            statusOpenValue: shiftState === "open" ? "進行中" : shiftState === "closed" ? "未開班" : "載入中",
            statusTasks: "待處理",
            statusTasksValue: `${pendingItems} 項`,
            statusTip: "先完成入場與收款，再執行交班結算。",
            quickOpsTitle: "櫃檯作業",
            quickOpsSub: "入場與會員的高頻操作入口。",
            quickServiceTitle: "櫃檯服務",
            quickServiceSub: "收銀與置物櫃作業快速切換。",
            quickShiftTitle: "當班資訊",
            quickShiftSub: "交班前請確認時間、當班人員與今日數據。",
            quickPosAction: "收銀",
            quickLockerAction: "置物櫃",
            modeClosed: "未開班",
            modeOpen: "開班中",
            startShiftTitle: "開始開班",
            openingCash: "零用金",
            openingNote: "備註",
            openingNotePlaceholder: "可填寫本班次交接提醒",
            startShiftAction: "開班",
            startingShiftAction: "開班中...",
            openShiftFirst: "請先開班",
            openShiftDisabledHint: "工具列與常用操作已停用，請先開班。",
            loadingState: "載入中",
            openedAt: "開班時間",
            shiftOperator: "當班人員",
            handoverAction: "交班",
            handoverModalTitle: "交班結算",
            handoverHint: "請確認三種收款總額，送出後班次將關閉。",
            closeCashTotal: "現金總額",
            closeCardTotal: "刷卡總額",
            closeTransferTotal: "轉帳總額",
            closeNote: "交班備註",
            closeShiftAction: "送出交班",
            closingShiftAction: "交班送出中...",
            invalidAmount: "金額格式錯誤，請輸入數字。",
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
            cash: "現金",
            card: "刷卡",
            transfer: "轉帳",
            newebpay: "藍新",
            manual: "手動",
            overdue: "逾時",
            minutes: "分鐘",
            dueSoon: "即將開始",
            normal: "一般",
            capabilityTitle: "櫃檯能力地圖",
            capabilitySub: "A~K 全模組進度：優先完成可營運與高風險稽核。",
            capabilityOpenBtn: "開啟能力地圖",
            capabilityArcHint: "拖曳下方 A~K 按鈕，點擊即開啟對應功能。",
            capabilityDragHint: "可用滑鼠按住拖曳左右滑動",
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
            openPosPage: "開啟收銀作業頁",
            posModuleTitle: "收銀作業",
            posModuleSub: "快速建立訂單、記錄付款，並處理待收款訂單。",
            posCreateSection: "建立訂單",
            posPaymentSection: "記錄付款",
            posCheckoutSection: "藍新金流結帳",
            posVoidSection: "作廢送審",
            posRefundSection: "退費送審",
            posApprovalsSection: "送審狀態",
            posAuditSection: "稽核紀錄",
            posInvoiceSection: "發票作業",
            posOrdersSection: "訂單列表",
            posPaymentsSection: "付款明細",
            posMemberIdOptional: "會員 ID（UUID，選填）",
            posAmountLabel: "訂單金額",
            posSubtotalLabel: "原價",
            posDiscountLabel: "折扣",
            posDiscountNoteLabel: "折扣原因",
            posManagerOverrideLabel: "主管同意高折扣（>=20% 或 >=500）",
            posManagerOverrideRequired: "高折扣需主管同意",
            posNoteLabel: "備註（選填）",
            posCurrentOrder: "目前訂單",
            posNoOrder: "尚未選擇訂單",
            posRemainingLabel: "尚未收款",
            posPaymentAmountLabel: "付款金額",
            posPaymentMethodLabel: "付款方式",
            posCreateAction: "建立訂單",
            posCreatingAction: "建立中...",
            posPayAction: "記錄付款",
            posPayingAction: "記錄中...",
            posInitCheckoutAction: "初始化結帳",
            posInitializingCheckoutAction: "初始化中...",
            posClearOrderAction: "清除目前訂單",
            posCheckoutUrlLabel: "結帳連結",
            posUseOrderAction: "使用此訂單",
            posVoidAction: "送出作廢",
            posRefundAction: "送出退費",
            posIssueInvoiceAction: "開立發票",
            posVoidInvoiceAction: "作廢發票",
            posAllowanceInvoiceAction: "開立折讓",
            posPrintReceiptAction: "列印收據",
            posOpenEntryAction: "付款後入場",
            posOpenMemberAction: "會員資料",
            posOpenBookingAction: "預約作業",
            posReloadAction: "重新整理",
            posOrderCreated: "訂單已建立",
            posPaymentRecorded: "付款已記錄",
            posCheckoutInitialized: "藍新結帳已初始化",
            posCreateFail: "建立訂單失敗",
            posPaymentFail: "付款失敗",
            posCheckoutFail: "藍新初始化失敗",
            posVoidFail: "作廢送審失敗",
            posRefundFail: "退費送審失敗",
            posInvoiceFail: "發票操作失敗",
            posInvalidMemberId: "會員 ID 格式錯誤，請輸入 UUID 或留空",
            posInvalidAmount: "金額格式錯誤",
            posOrderRequired: "請先建立或選擇訂單",
            posReasonRequired: "請輸入原因",
            posRefundPaymentIdLabel: "付款 ID",
            posInvoiceNoRequired: "請先輸入發票號碼",
            posInvoiceIssued: "發票已開立",
            posInvoiceVoided: "發票已作廢",
            posInvoiceAllowanceIssued: "折讓已建立",
            posOrderVoided: "訂單已作廢",
            posPaymentRefunded: "付款已退費",
            posNoPayments: "目前沒有付款紀錄。",
            posNoApprovals: "目前沒有送審紀錄。",
            posNoAudit: "目前沒有稽核紀錄。",
            posNoInvoices: "目前沒有發票紀錄。",
            posNoOrders: "目前沒有訂單資料。",
            posRequestSubmitted: "已送審，待主管處理",
            posInvoiceNoLabel: "發票號碼",
            posInvoiceTaxIdLabel: "統編（選填）",
            posInvoiceCarrierLabel: "載具（選填）",
            posInvoiceBuyerLabel: "買受人（選填）",
            posAllowanceAmountLabel: "折讓金額",
            posReasonLabel: "原因",
            posStatusPending: "待審",
            posStatusApproved: "已核准",
            posStatusRejected: "已駁回",
            posStatusCancelled: "已取消",
            posPendingTitle: "待收款訂單",
            posNoPending: "目前沒有待收款訂單。",
            lockerTitle: "置物櫃租借作業",
            lockerSub: "現場快速登記租借與歸還，並保留操作紀錄。",
            lockerCodeLabel: "置物櫃編號",
            lockerMemberIdLabel: "會員 ID（1~9999，選填）",
            lockerRenterLabel: "租借人",
            lockerPhoneLabel: "電話（選填）",
            lockerDepositLabel: "押金",
            lockerDepositTag: "押金",
            lockerRentalTermLabel: "租借方案",
            lockerTermDaily: "當日租借",
            lockerTermMonthly: "單月租借",
            lockerTermHalfYear: "半年租借",
            lockerTermYearly: "一年租借",
            lockerTermCustom: "自訂到期",
            lockerDueAtLabel: "到期時間（選填）",
            lockerDueAutoHint: "系統自動計算到期：",
            lockerNoteLabel: "備註（選填）",
            lockerRentAction: "登記租借",
            lockerRentingAction: "登記中...",
            lockerReload: "重新整理",
            lockerActiveList: "使用中",
            lockerRecentList: "近期歸還",
            lockerDepositHeld: "在押總額",
            lockerDepositReturned: "歸還總額（近期）",
            lockerNoneActive: "目前沒有使用中的置物櫃。",
            lockerNoneRecent: "目前沒有近期歸還紀錄。",
            lockerReturnAction: "登記歸還",
            lockerReturningAction: "處理中...",
            lockerRentSuccess: "已完成租借登記",
            lockerReturnSuccess: "已完成歸還登記",
            lockerCodeRequired: "請輸入置物櫃編號",
            lockerIdentifierRequired: "請至少填寫會員 ID、租借人或電話其中一項",
            lockerMemberIdInvalid: "會員 ID 格式錯誤，請輸入 1~9999",
            lockerMemberNotFound: "找不到此會員編號",
            lockerDepositInvalid: "押金格式錯誤，請輸入數字",
            lockerDueAtInvalid: "到期時間格式錯誤",
            lockerDueAtRequired: "選擇自訂到期時，請填寫到期時間",
            lockerLoadFail: "載入置物櫃資料失敗",
            lockerRentFail: "租借登記失敗",
            lockerReturnFail: "歸還登記失敗",
            lockerInUse: "此置物櫃目前使用中",
            lockerStatusActive: "使用中",
            lockerStatusReturned: "已歸還",
            lockerRentedAt: "租借時間",
            lockerReturnedAt: "歸還時間",
            lockerTermTag: "租期",
            inventoryTitle: "商品 / 庫存 / 銷售",
            inventorySub: "在櫃檯直接完成商品銷售入帳與庫存調整。",
            inventorySummarySkus: "上架品項",
            inventorySummaryLow: "低庫存",
            inventorySummaryOnHand: "總庫存",
            inventorySummarySold: "今日售出",
            inventoryCreateSection: "新增商品",
            inventoryCreateCodeLabel: "商品代碼（英文 / 數字 / 底線）",
            inventoryCreateTitleLabel: "商品名稱",
            inventoryCreateUnitPriceLabel: "單價",
            inventoryCreateOnHandLabel: "期初庫存",
            inventoryCreateSafetyStockLabel: "安全庫存",
            inventoryCreateSortOrderLabel: "排序",
            inventorySalesSection: "銷售入帳",
            inventoryAdjustSection: "庫存調整",
            inventoryProductLabel: "商品",
            inventoryQtyLabel: "數量",
            inventoryMemberCodeLabel: "會員編號（1~9999，選填）",
            inventoryPaymentMethodLabel: "收款方式",
            inventoryAdjustDeltaLabel: "庫存變動（+補貨 / -盤損）",
            inventoryNoteLabel: "備註（選填）",
            inventoryCreateAction: "新增商品",
            inventoryCreatingAction: "新增中...",
            inventorySaleAction: "送出銷售",
            inventorySellingAction: "銷售入帳中...",
            inventoryAdjustAction: "送出調整",
            inventoryAdjustingAction: "調整中...",
            inventoryReloadAction: "重新整理",
            inventoryProductsList: "商品庫存",
            inventoryMovesList: "最近異動",
            inventoryNoProducts: "目前沒有可販售商品。",
            inventoryNoMoves: "目前沒有庫存異動紀錄。",
            inventoryOnHandTag: "庫存",
            inventoryLowTag: "低庫存",
            inventoryCreateSuccess: "商品已新增",
            inventorySaleSuccess: "商品銷售已入帳",
            inventoryAdjustSuccess: "庫存調整完成",
            inventoryLoadFail: "載入商品庫存失敗",
            inventoryCreateFail: "新增商品失敗",
            inventorySaleFail: "銷售入帳失敗",
            inventoryAdjustFail: "庫存調整失敗",
            inventoryCreateCodeInvalid: "商品代碼格式錯誤（僅可英文、數字、底線）",
            inventoryCreateTitleRequired: "請輸入商品名稱",
            inventoryCreateUnitPriceInvalid: "單價格式錯誤",
            inventoryCreateOnHandInvalid: "期初庫存格式錯誤",
            inventoryCreateSafetyStockInvalid: "安全庫存格式錯誤",
            inventoryCreateSortOrderInvalid: "排序格式錯誤",
            inventoryProductRequired: "請先選擇商品",
            inventoryQtyInvalid: "數量格式錯誤",
            inventoryDeltaInvalid: "庫存變動格式錯誤",
            inventoryMoveSale: "銷售",
            inventoryMoveAdjust: "調整",
            inventoryMoveRestock: "補貨",
            csTitle: "客服 / 事件紀錄",
            csSub: "建立客訴與現場事件工單，追蹤處理進度並保留完整記錄。",
            csSummaryOpen: "開啟中",
            csSummaryInProgress: "處理中",
            csSummaryResolved: "已結案",
            csSummaryOverdue: "逾期待處理",
            csCreateSection: "建立事件工單",
            csOperateSection: "工單操作",
            csListSection: "事件列表",
            csEventsSection: "事件追蹤",
            csFilterStatusLabel: "狀態篩選",
            csIncidentTypeLabel: "事件類型",
            csPriorityLabel: "優先等級",
            csSourceLabel: "來源",
            csMemberCodeLabel: "會員編號（1~9999，選填）",
            csMemberNameLabel: "會員姓名（選填）",
            csContactPhoneLabel: "聯絡電話（選填）",
            csCaseTitleLabel: "事件標題",
            csCaseDetailLabel: "事件內容",
            csHappenedAtLabel: "發生時間（選填）",
            csDueAtLabel: "處理期限（選填）",
            csSelectIncidentLabel: "選擇工單",
            csStatusToLabel: "更新狀態",
            csStatusNoteLabel: "狀態備註（選填）",
            csFollowupNoteLabel: "追蹤紀錄",
            csResolveNoteLabel: "結案說明",
            csCreateAction: "建立工單",
            csCreatingAction: "建立中...",
            csReloadAction: "重新整理",
            csUpdateStatusAction: "更新狀態",
            csAddFollowupAction: "新增追蹤",
            csResolveAction: "送出結案",
            csActioning: "處理中...",
            csNoIncidents: "目前沒有事件工單。",
            csNoEvents: "目前沒有追蹤紀錄。",
            csLoadFail: "載入事件工單失敗",
            csCreateFail: "建立事件工單失敗",
            csUpdateFail: "更新狀態失敗",
            csFollowupFail: "新增追蹤失敗",
            csResolveFail: "結案失敗",
            csCreateSuccess: "事件工單已建立",
            csUpdateSuccess: "狀態更新完成",
            csFollowupSuccess: "追蹤紀錄已新增",
            csResolveSuccess: "事件已結案",
            csCaseTitleRequired: "請輸入事件標題",
            csCaseDetailRequired: "請輸入事件內容",
            csIncidentRequired: "請先選擇工單",
            csNoteRequired: "請輸入內容",
            csMemberCodeInvalid: "會員編號格式錯誤，請輸入 1~9999",
            csDateInvalid: "日期時間格式錯誤",
            csStatusOpen: "開啟中",
            csStatusInProgress: "處理中",
            csStatusResolved: "已結案",
            csStatusClosed: "已關閉",
            csStatusAll: "全部",
            csTypeComplaint: "客訴",
            csTypeFacility: "設備",
            csTypeSafety: "安全",
            csTypeBilling: "帳務",
            csTypeMember: "會員資料",
            csTypeOther: "其他",
            csPriorityLow: "低",
            csPriorityNormal: "中",
            csPriorityHigh: "高",
            csPriorityUrgent: "緊急",
            csSourceFrontdesk: "櫃檯",
            csSourcePhone: "電話",
            csSourceLine: "LINE",
            csSourceEmail: "Email",
            csSourceWalkin: "現場",
            csSourceOther: "其他",
            csEventCreated: "建立",
            csEventStatusChanged: "狀態更新",
            csEventFollowup: "追蹤紀錄",
            csEventResolved: "結案",
            csEventReopened: "重新開單",
            csEventAssigned: "指派",
            csResolutionTag: "結案說明",
            csUseIncidentAction: "使用此工單",
            csCreatedAt: "建立時間",
            csUpdatedAt: "更新時間",
            csDueAt: "期限",
            close: "關閉",
            cancel: "取消",
            openShiftFail: "開班失敗",
            closeShiftFail: "交班失敗",
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
            statusOpenValue: shiftState === "open" ? "Open" : shiftState === "closed" ? "Closed" : "Loading",
            statusTasks: "Pending",
            statusTasksValue: `${pendingItems} items`,
            statusTip: "Finish check-ins and payments first, then run shift handover.",
            quickOpsTitle: "Frontdesk Ops",
            quickOpsSub: "High-frequency shortcuts for entry and member tasks.",
            quickServiceTitle: "Frontdesk Service",
            quickServiceSub: "Jump directly to POS and locker operations.",
            quickShiftTitle: "Shift Info",
            quickShiftSub: "Confirm operator/time and run handover from here.",
            quickPosAction: "POS",
            quickLockerAction: "Locker",
            modeClosed: "Closed",
            modeOpen: "Open",
            startShiftTitle: "Start Shift",
            openingCash: "Opening Cash",
            openingNote: "Note",
            openingNotePlaceholder: "Optional handover reminder for this shift",
            startShiftAction: "Open Shift",
            startingShiftAction: "Opening...",
            openShiftFirst: "Please open shift first",
            openShiftDisabledHint: "Toolbar and common actions are disabled until shift opens.",
            loadingState: "Loading",
            openedAt: "Opened At",
            shiftOperator: "Operator",
            handoverAction: "Handover",
            handoverModalTitle: "Shift Handover",
            handoverHint: "Confirm all totals before submit. The shift will be closed.",
            closeCashTotal: "Cash Total",
            closeCardTotal: "Card Total",
            closeTransferTotal: "Transfer Total",
            closeNote: "Handover Note",
            closeShiftAction: "Submit Close",
            closingShiftAction: "Closing...",
            invalidAmount: "Invalid amount format.",
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
            cash: "cash",
            card: "card",
            transfer: "transfer",
            newebpay: "newebpay",
            manual: "manual",
            overdue: "Overdue",
            minutes: "min",
            dueSoon: "Starting Soon",
            normal: "Normal",
            capabilityTitle: "Frontdesk Capability Map",
            capabilitySub: "A-K module progress with operations-first and audit-first rollout.",
            capabilityOpenBtn: "Open Capability Map",
            capabilityArcHint: "Drag the A-K buttons below and click to open each module.",
            capabilityDragHint: "Mouse drag is supported for horizontal slide",
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
            openPosPage: "Open POS Workspace",
            posModuleTitle: "POS Workspace",
            posModuleSub: "Quickly create orders, capture payments, and process unpaid orders.",
            posCreateSection: "Create Order",
            posPaymentSection: "Capture Payment",
            posCheckoutSection: "Newebpay Checkout",
            posVoidSection: "Void Request",
            posRefundSection: "Refund Request",
            posApprovalsSection: "Approval Status",
            posAuditSection: "Audit Logs",
            posInvoiceSection: "Invoice",
            posOrdersSection: "Orders",
            posPaymentsSection: "Payments",
            posMemberIdOptional: "Member ID (UUID, optional)",
            posAmountLabel: "Order Amount",
            posSubtotalLabel: "Subtotal",
            posDiscountLabel: "Discount",
            posDiscountNoteLabel: "Discount Reason",
            posManagerOverrideLabel: "Manager override for high discount (>=20% or >=500)",
            posManagerOverrideRequired: "High discount requires manager override",
            posNoteLabel: "Note (optional)",
            posCurrentOrder: "Current Order",
            posNoOrder: "No order selected",
            posRemainingLabel: "Remaining",
            posPaymentAmountLabel: "Payment Amount",
            posPaymentMethodLabel: "Payment Method",
            posCreateAction: "Create Order",
            posCreatingAction: "Creating...",
            posPayAction: "Record Payment",
            posPayingAction: "Recording...",
            posInitCheckoutAction: "Initialize Checkout",
            posInitializingCheckoutAction: "Initializing...",
            posClearOrderAction: "Clear Current Order",
            posCheckoutUrlLabel: "Checkout URL",
            posUseOrderAction: "Use Order",
            posVoidAction: "Submit Void",
            posRefundAction: "Submit Refund",
            posIssueInvoiceAction: "Issue Invoice",
            posVoidInvoiceAction: "Void Invoice",
            posAllowanceInvoiceAction: "Create Allowance",
            posPrintReceiptAction: "Print Receipt",
            posOpenEntryAction: "Go Check-in",
            posOpenMemberAction: "Open Member",
            posOpenBookingAction: "Open Booking",
            posReloadAction: "Reload",
            posOrderCreated: "Order created",
            posPaymentRecorded: "Payment recorded",
            posCheckoutInitialized: "Checkout initialized",
            posCreateFail: "Create order failed",
            posPaymentFail: "Payment failed",
            posCheckoutFail: "Newebpay init failed",
            posVoidFail: "Void request failed",
            posRefundFail: "Refund request failed",
            posInvoiceFail: "Invoice action failed",
            posInvalidMemberId: "Invalid member ID format. Use UUID or leave empty.",
            posInvalidAmount: "Invalid amount format",
            posOrderRequired: "Please create or select an order first",
            posReasonRequired: "Please enter reason",
            posRefundPaymentIdLabel: "Payment ID",
            posInvoiceNoRequired: "Please enter invoice number",
            posInvoiceIssued: "Invoice issued",
            posInvoiceVoided: "Invoice voided",
            posInvoiceAllowanceIssued: "Allowance created",
            posOrderVoided: "Order voided",
            posPaymentRefunded: "Payment refunded",
            posNoPayments: "No payment records yet.",
            posNoApprovals: "No approval requests yet.",
            posNoAudit: "No audit records yet.",
            posNoInvoices: "No invoice records yet.",
            posNoOrders: "No orders yet.",
            posRequestSubmitted: "Submitted for manager approval",
            posInvoiceNoLabel: "Invoice No.",
            posInvoiceTaxIdLabel: "Tax ID (optional)",
            posInvoiceCarrierLabel: "Carrier (optional)",
            posInvoiceBuyerLabel: "Buyer Name (optional)",
            posAllowanceAmountLabel: "Allowance Amount",
            posReasonLabel: "Reason",
            posStatusPending: "Pending",
            posStatusApproved: "Approved",
            posStatusRejected: "Rejected",
            posStatusCancelled: "Cancelled",
            posPendingTitle: "Pending Payments",
            posNoPending: "No unpaid orders right now.",
            lockerTitle: "Locker Rental Desk",
            lockerSub: "Register locker rent/return quickly with audit trail.",
            lockerCodeLabel: "Locker Code",
            lockerMemberIdLabel: "Member ID (1-9999, optional)",
            lockerRenterLabel: "Renter Name",
            lockerPhoneLabel: "Phone (optional)",
            lockerDepositLabel: "Deposit",
            lockerDepositTag: "Deposit",
            lockerRentalTermLabel: "Rental Term",
            lockerTermDaily: "Daily",
            lockerTermMonthly: "Monthly",
            lockerTermHalfYear: "Half-Year",
            lockerTermYearly: "Yearly",
            lockerTermCustom: "Custom Due",
            lockerDueAtLabel: "Due At (optional)",
            lockerDueAutoHint: "Auto due time:",
            lockerNoteLabel: "Note (optional)",
            lockerRentAction: "Rent Locker",
            lockerRentingAction: "Saving...",
            lockerReload: "Reload",
            lockerActiveList: "Active Lockers",
            lockerRecentList: "Recently Returned",
            lockerDepositHeld: "Held Deposit Total",
            lockerDepositReturned: "Returned Deposit Total (Recent)",
            lockerNoneActive: "No active locker rentals.",
            lockerNoneRecent: "No recent returns.",
            lockerReturnAction: "Mark Returned",
            lockerReturningAction: "Processing...",
            lockerRentSuccess: "Locker rental created",
            lockerReturnSuccess: "Locker return recorded",
            lockerCodeRequired: "lockerCode is required",
            lockerIdentifierRequired: "Provide memberId, renter name, or phone",
            lockerMemberIdInvalid: "Invalid memberId format. Use 1-9999.",
            lockerMemberNotFound: "Member not found by memberId",
            lockerDepositInvalid: "Invalid deposit amount",
            lockerDueAtInvalid: "Invalid dueAt format",
            lockerDueAtRequired: "dueAt is required for custom rental term",
            lockerLoadFail: "Load locker data failed",
            lockerRentFail: "Create locker rental failed",
            lockerReturnFail: "Return locker failed",
            lockerInUse: "Locker is already in use",
            lockerStatusActive: "Active",
            lockerStatusReturned: "Returned",
            lockerRentedAt: "Rented At",
            lockerReturnedAt: "Returned At",
            lockerTermTag: "Term",
            inventoryTitle: "Product / Inventory / Sales",
            inventorySub: "Complete product sales and stock adjustments directly at frontdesk.",
            inventorySummarySkus: "SKUs",
            inventorySummaryLow: "Low Stock",
            inventorySummaryOnHand: "Total On Hand",
            inventorySummarySold: "Sold Today",
            inventoryCreateSection: "Create Product",
            inventoryCreateCodeLabel: "Code (letters / numbers / underscore)",
            inventoryCreateTitleLabel: "Title",
            inventoryCreateUnitPriceLabel: "Unit Price",
            inventoryCreateOnHandLabel: "Opening Stock",
            inventoryCreateSafetyStockLabel: "Safety Stock",
            inventoryCreateSortOrderLabel: "Sort Order",
            inventorySalesSection: "Sales Entry",
            inventoryAdjustSection: "Stock Adjustment",
            inventoryProductLabel: "Product",
            inventoryQtyLabel: "Quantity",
            inventoryMemberCodeLabel: "Member Code (1-9999, optional)",
            inventoryPaymentMethodLabel: "Payment Method",
            inventoryAdjustDeltaLabel: "Stock Delta (+restock / -shrink)",
            inventoryNoteLabel: "Note (optional)",
            inventoryCreateAction: "Create Product",
            inventoryCreatingAction: "Creating...",
            inventorySaleAction: "Submit Sale",
            inventorySellingAction: "Posting Sale...",
            inventoryAdjustAction: "Submit Adjustment",
            inventoryAdjustingAction: "Adjusting...",
            inventoryReloadAction: "Reload",
            inventoryProductsList: "Product Inventory",
            inventoryMovesList: "Recent Movements",
            inventoryNoProducts: "No sellable products found.",
            inventoryNoMoves: "No inventory movement yet.",
            inventoryOnHandTag: "On Hand",
            inventoryLowTag: "Low Stock",
            inventoryCreateSuccess: "Product created",
            inventorySaleSuccess: "Product sale posted",
            inventoryAdjustSuccess: "Inventory adjusted",
            inventoryLoadFail: "Load inventory failed",
            inventoryCreateFail: "Create product failed",
            inventorySaleFail: "Product sale failed",
            inventoryAdjustFail: "Inventory adjustment failed",
            inventoryCreateCodeInvalid: "Invalid code format. Use letters, numbers, underscore only.",
            inventoryCreateTitleRequired: "Please enter product title",
            inventoryCreateUnitPriceInvalid: "Invalid unit price format",
            inventoryCreateOnHandInvalid: "Invalid opening stock format",
            inventoryCreateSafetyStockInvalid: "Invalid safety stock format",
            inventoryCreateSortOrderInvalid: "Invalid sort order format",
            inventoryProductRequired: "Please select product",
            inventoryQtyInvalid: "Invalid quantity format",
            inventoryDeltaInvalid: "Invalid stock delta format",
            inventoryMoveSale: "Sale",
            inventoryMoveAdjust: "Adjustment",
            inventoryMoveRestock: "Restock",
            csTitle: "Service / Incident Log",
            csSub: "Create complaint/on-site incident tickets, track progress, and keep full records.",
            csSummaryOpen: "Open",
            csSummaryInProgress: "In Progress",
            csSummaryResolved: "Resolved",
            csSummaryOverdue: "Overdue",
            csCreateSection: "Create Ticket",
            csOperateSection: "Ticket Actions",
            csListSection: "Incident List",
            csEventsSection: "Incident Timeline",
            csFilterStatusLabel: "Status Filter",
            csIncidentTypeLabel: "Type",
            csPriorityLabel: "Priority",
            csSourceLabel: "Source",
            csMemberCodeLabel: "Member Code (1-9999, optional)",
            csMemberNameLabel: "Member Name (optional)",
            csContactPhoneLabel: "Contact Phone (optional)",
            csCaseTitleLabel: "Title",
            csCaseDetailLabel: "Detail",
            csHappenedAtLabel: "Happened At (optional)",
            csDueAtLabel: "Due At (optional)",
            csSelectIncidentLabel: "Select Ticket",
            csStatusToLabel: "Set Status",
            csStatusNoteLabel: "Status Note (optional)",
            csFollowupNoteLabel: "Follow-up Note",
            csResolveNoteLabel: "Resolution Note",
            csCreateAction: "Create Ticket",
            csCreatingAction: "Creating...",
            csReloadAction: "Reload",
            csUpdateStatusAction: "Update Status",
            csAddFollowupAction: "Add Follow-up",
            csResolveAction: "Resolve Ticket",
            csActioning: "Processing...",
            csNoIncidents: "No incident tickets yet.",
            csNoEvents: "No timeline records yet.",
            csLoadFail: "Load incidents failed",
            csCreateFail: "Create incident failed",
            csUpdateFail: "Update status failed",
            csFollowupFail: "Add follow-up failed",
            csResolveFail: "Resolve incident failed",
            csCreateSuccess: "Incident ticket created",
            csUpdateSuccess: "Status updated",
            csFollowupSuccess: "Follow-up added",
            csResolveSuccess: "Incident resolved",
            csCaseTitleRequired: "Please enter incident title",
            csCaseDetailRequired: "Please enter incident detail",
            csIncidentRequired: "Please select an incident first",
            csNoteRequired: "Please enter note",
            csMemberCodeInvalid: "Invalid member code format. Use 1-9999.",
            csDateInvalid: "Invalid date time format",
            csStatusOpen: "Open",
            csStatusInProgress: "In Progress",
            csStatusResolved: "Resolved",
            csStatusClosed: "Closed",
            csStatusAll: "All",
            csTypeComplaint: "Complaint",
            csTypeFacility: "Facility",
            csTypeSafety: "Safety",
            csTypeBilling: "Billing",
            csTypeMember: "Member",
            csTypeOther: "Other",
            csPriorityLow: "Low",
            csPriorityNormal: "Normal",
            csPriorityHigh: "High",
            csPriorityUrgent: "Urgent",
            csSourceFrontdesk: "Frontdesk",
            csSourcePhone: "Phone",
            csSourceLine: "LINE",
            csSourceEmail: "Email",
            csSourceWalkin: "Walk-in",
            csSourceOther: "Other",
            csEventCreated: "Created",
            csEventStatusChanged: "Status Updated",
            csEventFollowup: "Follow-up",
            csEventResolved: "Resolved",
            csEventReopened: "Reopened",
            csEventAssigned: "Assigned",
            csResolutionTag: "Resolution",
            csUseIncidentAction: "Use This Ticket",
            csCreatedAt: "Created At",
            csUpdatedAt: "Updated At",
            csDueAt: "Due At",
            close: "Close",
            cancel: "Cancel",
            openShiftFail: "Open shift failed",
            closeShiftFail: "Close shift failed",
            ready: "Ready",
            building: "Building",
            planned: "Planned",
          },
    [lang, pendingItems, shiftState],
  );

  const leadUi = lang === "zh"
    ? {
        title: "線索 / 參觀導覽",
        sub: "建立潛在客線索、安排導覽、追蹤轉換與失單原因。",
        summaryNew: "新線索",
        summaryTour: "已排導覽",
        summaryConverted: "已轉會員",
        summaryLost: "已失單",
        createSection: "新增線索",
        actionSection: "線索操作",
        listSection: "線索列表",
        timelineSection: "追蹤紀錄",
        reload: "重新整理",
        creating: "建立中...",
        createAction: "建立線索",
        nameLabel: "姓名",
        phoneLabel: "電話（選填）",
        sourceLabel: "來源",
        interestLabel: "興趣",
        noteLabel: "備註（選填）",
        tourAtLabel: "導覽時間（選填）",
        selectLead: "選擇線索",
        statusFilter: "狀態篩選",
        scheduleTitle: "安排導覽",
        scheduleAction: "送出導覽",
        followupTitle: "追蹤紀錄",
        followupAction: "新增追蹤",
        convertTitle: "轉為會員",
        convertAction: "送出轉換",
        convertHint: "留空將嘗試以線索姓名/電話建立會員",
        lostTitle: "標記失單",
        lostAction: "標記失單",
        reasonLabel: "原因",
        noItems: "目前沒有線索。",
        noEvents: "目前沒有追蹤紀錄。",
        createdAt: "建立",
        updatedAt: "更新",
        useLead: "使用此線索",
      }
    : {
        title: "Lead / Tour Desk",
        sub: "Create leads, schedule tours, and track conversion/lost reasons.",
        summaryNew: "New",
        summaryTour: "Tour Scheduled",
        summaryConverted: "Converted",
        summaryLost: "Lost",
        createSection: "Create Lead",
        actionSection: "Lead Actions",
        listSection: "Lead List",
        timelineSection: "Timeline",
        reload: "Reload",
        creating: "Creating...",
        createAction: "Create Lead",
        nameLabel: "Name",
        phoneLabel: "Phone (optional)",
        sourceLabel: "Source",
        interestLabel: "Interest",
        noteLabel: "Note (optional)",
        tourAtLabel: "Tour At (optional)",
        selectLead: "Select Lead",
        statusFilter: "Status Filter",
        scheduleTitle: "Schedule Tour",
        scheduleAction: "Save Tour",
        followupTitle: "Follow-up",
        followupAction: "Add Follow-up",
        convertTitle: "Convert to Member",
        convertAction: "Convert",
        convertHint: "Leave empty to auto-create member from lead name/phone",
        lostTitle: "Mark Lost",
        lostAction: "Mark Lost",
        reasonLabel: "Reason",
        noItems: "No leads yet.",
        noEvents: "No lead events yet.",
        createdAt: "Created",
        updatedAt: "Updated",
        useLead: "Use Lead",
      };

  const chainUi = lang === "zh"
    ? {
        title: "跨店規則",
        sub: "設定跨店放行規則與黑名單同步，避免門市規則不一致。",
        settingsSection: "規則設定",
        blacklistSection: "黑名單",
        addBlacklistSection: "新增黑名單",
        removeAction: "移除黑名單",
        reload: "重新整理",
        saveAction: "儲存規則",
        saving: "儲存中...",
        allowCrossBranch: "允許跨店入場",
        requireManagerApproval: "例外跨店需主管覆核",
        suspensionSync: "停權狀態跨店同步",
        guestPass: "允許跨店訪客票",
        maxEntryPerDay: "每日跨店次數上限（留空不限）",
        allowedBranches: "允許分館代碼（逗號分隔）",
        ruleNote: "規則備註（選填）",
        blacklistName: "姓名",
        blacklistMemberCode: "會員編號（選填）",
        blacklistPhone: "電話（選填）",
        blacklistReason: "原因",
        blacklistExpiresAt: "到期時間（選填）",
        noBlacklist: "目前沒有黑名單。",
        activeCount: "生效名單",
        updatedAt: "規則更新時間",
      }
    : {
        title: "Multi-Branch Rules",
        sub: "Configure cross-branch access policy and synced blacklist.",
        settingsSection: "Rule Settings",
        blacklistSection: "Blacklist",
        addBlacklistSection: "Add Blacklist",
        removeAction: "Remove",
        reload: "Reload",
        saveAction: "Save Rules",
        saving: "Saving...",
        allowCrossBranch: "Allow cross-branch entry",
        requireManagerApproval: "Require manager approval for exceptions",
        suspensionSync: "Sync suspension across branches",
        guestPass: "Allow guest pass across branches",
        maxEntryPerDay: "Daily cross-branch limit (blank = unlimited)",
        allowedBranches: "Allowed branch codes (comma-separated)",
        ruleNote: "Rule note (optional)",
        blacklistName: "Name",
        blacklistMemberCode: "Member Code (optional)",
        blacklistPhone: "Phone (optional)",
        blacklistReason: "Reason",
        blacklistExpiresAt: "Expires At (optional)",
        noBlacklist: "No blacklist records.",
        activeCount: "Active",
        updatedAt: "Last Updated",
      };

  const reportUi = lang === "zh"
    ? {
        title: "報表 / 即時監控",
        sub: "櫃檯即時營運看板：班次、收款、待辦、工單、轉換。",
        reload: "刷新看板",
        shiftState: "班次狀態",
        pendingApprovals: "待審送單",
        overdueOrders: "逾時未收款",
        upcomingBookings: "2 小時內到店",
        unresolvedIncidents: "未結案事件",
        convertedLeads: "已轉會員線索",
        todoTitle: "待辦",
        todoNone: "目前沒有待辦項目。",
        auditTitle: "營運觀察",
      }
    : {
        title: "Reports / Live Monitor",
        sub: "Desk live board for shift, payments, tickets, and conversion.",
        reload: "Refresh Board",
        shiftState: "Shift",
        pendingApprovals: "Pending Approvals",
        overdueOrders: "Overdue Unpaid",
        upcomingBookings: "Arriving in 2h",
        unresolvedIncidents: "Open Incidents",
        convertedLeads: "Converted Leads",
        todoTitle: "Todo",
        todoNone: "No pending tasks.",
        auditTitle: "Ops Signals",
      };

  const shiftResolved = shiftState !== "unknown";
  const shiftOpen = shiftState === "open";
  const actionsDisabled = !shiftResolved || !shiftOpen;
  const isFeatureModal = modalType === "entry" || modalType === "member";
  const lockerActiveItems = useMemo(
    () => lockerRentals.filter((item) => item.status === "active"),
    [lockerRentals],
  );
  const lockerRecentReturnedItems = useMemo(
    () => lockerRentals.filter((item) => item.status === "returned").slice(0, 8),
    [lockerRentals],
  );
  const lockerHeldDepositTotal = useMemo(
    () => lockerActiveItems.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0),
    [lockerActiveItems],
  );
  const lockerReturnedDepositTotal = useMemo(
    () => lockerRecentReturnedItems.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0),
    [lockerRecentReturnedItems],
  );
  const inventorySkuCount = inventoryItems.length;
  const inventoryLowStockCount = useMemo(
    () => inventoryItems.filter((item) => item.isLowStock).length,
    [inventoryItems],
  );
  const inventoryTotalOnHand = useMemo(
    () => inventoryItems.reduce((sum, item) => sum + Number(item.onHand || 0), 0),
    [inventoryItems],
  );
  const inventorySoldToday = useMemo(() => {
    const now = new Date();
    return inventoryMoves
      .filter((item) => item.reason === "sale" && isSameLocalDay(item.createdAt, now))
      .reduce((sum, item) => sum + Math.max(0, -Number(item.delta || 0)), 0);
  }, [inventoryMoves]);
  const csOpenCount = useMemo(
    () => csIncidents.filter((item) => item.status === "open").length,
    [csIncidents],
  );
  const csInProgressCount = useMemo(
    () => csIncidents.filter((item) => item.status === "in_progress").length,
    [csIncidents],
  );
  const csResolvedCount = useMemo(
    () => csIncidents.filter((item) => item.status === "resolved" || item.status === "closed").length,
    [csIncidents],
  );
  const csOverdueCount = useMemo(() => {
    const nowMs = Date.now();
    return csIncidents.filter((item) => {
      if (!item.dueAt) return false;
      if (item.status === "resolved" || item.status === "closed") return false;
      const dueAtMs = new Date(item.dueAt).getTime();
      return Number.isFinite(dueAtMs) && dueAtMs < nowMs;
    }).length;
  }, [csIncidents]);
  const csSelectedIncident = useMemo(
    () => csIncidents.find((item) => item.id === csSelectedIncidentId) || null,
    [csIncidents, csSelectedIncidentId],
  );
  const selectedPosOrder = useMemo(
    () => posOrders.find((item) => item.id === posOrderId) || null,
    [posOrderId, posOrders],
  );
  const posPaidTotal = useMemo(
    () => posPayments.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [posPayments],
  );
  const posRemaining = useMemo(
    () => Math.max(0, Number(selectedPosOrder?.amount || 0) - posPaidTotal),
    [posPaidTotal, selectedPosOrder?.amount],
  );
  const leadNewCount = useMemo(
    () => leadItems.filter((item) => item.status === "new").length,
    [leadItems],
  );
  const leadTourCount = useMemo(
    () => leadItems.filter((item) => item.status === "tour_scheduled").length,
    [leadItems],
  );
  const leadConvertedCount = useMemo(
    () => leadItems.filter((item) => item.status === "converted").length,
    [leadItems],
  );
  const leadLostCount = useMemo(
    () => leadItems.filter((item) => item.status === "lost").length,
    [leadItems],
  );
  const selectedLead = useMemo(
    () => leadItems.find((item) => item.id === leadSelectedId) || null,
    [leadItems, leadSelectedId],
  );
  const chainActiveBlacklistCount = chainBlacklistItems.length;
  const reportPendingApprovalCount = useMemo(
    () => posApprovals.filter((item) => item.status === "pending").length,
    [posApprovals],
  );
  const reportOverdueOrderCount = useMemo(
    () => unpaidOrderList.filter((item) => minutesSince(item.created_at) >= 15).length,
    [unpaidOrderList],
  );
  const reportUpcomingCount = upcomingBookingList.length;
  const reportUnresolvedIncidentCount = useMemo(
    () => csIncidents.filter((item) => item.status !== "resolved" && item.status !== "closed").length,
    [csIncidents],
  );

  const reportTodos = useMemo(() => {
    const items: string[] = [];
    if (reportPendingApprovalCount > 0) {
      items.push(lang === "zh" ? `有 ${reportPendingApprovalCount} 筆待審核送單` : `${reportPendingApprovalCount} approval requests pending`);
    }
    if (reportOverdueOrderCount > 0) {
      items.push(lang === "zh" ? `有 ${reportOverdueOrderCount} 筆逾時未收款訂單` : `${reportOverdueOrderCount} overdue unpaid orders`);
    }
    if (reportUnresolvedIncidentCount > 0) {
      items.push(lang === "zh" ? `有 ${reportUnresolvedIncidentCount} 件事件工單尚未結案` : `${reportUnresolvedIncidentCount} unresolved incidents`);
    }
    return items;
  }, [lang, reportOverdueOrderCount, reportPendingApprovalCount, reportUnresolvedIncidentCount]);

  const handleOpenShift = useCallback(async () => {
    const openingCashAmount = parseAmount(openingCash);
    if (Number.isNaN(openingCashAmount)) {
      setShiftActionError(t.invalidAmount);
      return;
    }

    setOpeningShift(true);
    setShiftActionError(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          openingCash: openingCashAmount,
          note: openingNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.openShiftFail);
      await loadDashboard(false);
      setOpeningNote("");
      setCloseNote("");
    } catch (err) {
      setShiftActionError(err instanceof Error ? err.message : t.openShiftFail);
    } finally {
      setOpeningShift(false);
    }
  }, [loadDashboard, openingCash, openingNote, t.invalidAmount, t.openShiftFail]);

  const handleCloseShift = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeShift?.id) {
      setShiftActionError(t.closeShiftFail);
      return;
    }

    const cashTotal = parseAmount(closeCashTotal);
    const cardTotal = parseAmount(closeCardTotal);
    const transferTotal = parseAmount(closeTransferTotal);
    if (Number.isNaN(cashTotal) || Number.isNaN(cardTotal) || Number.isNaN(transferTotal)) {
      setShiftActionError(t.invalidAmount);
      return;
    }

    setClosingShift(true);
    setShiftActionError(null);
    try {
      const res = await fetch("/api/frontdesk/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          shiftId: activeShift.id,
          cashTotal,
          cardTotal,
          transferTotal,
          note: closeNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.closeShiftFail);
      setCapabilityOpen(false);
      setModalType("capability");
      setCloseCashTotal("0");
      setCloseCardTotal("0");
      setCloseTransferTotal("0");
      setCloseNote("");
      await loadDashboard(false);
    } catch (err) {
      setShiftActionError(err instanceof Error ? err.message : t.closeShiftFail);
    } finally {
      setClosingShift(false);
    }
  }, [
    activeShift?.id,
    closeCardTotal,
    closeCashTotal,
    closeNote,
    closeTransferTotal,
    loadDashboard,
    t.closeShiftFail,
    t.invalidAmount,
  ]);

  const loadPosOrders = useCallback(async () => {
    const res = await fetch("/api/orders");
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || t.posCreateFail);
    setPosOrders((payload.items || []) as PosOrderItem[]);
    return (payload.items || []) as PosOrderItem[];
  }, [t.posCreateFail]);

  const loadPosPayments = useCallback(async (orderId: string) => {
    if (!orderId) {
      setPosPayments([]);
      return [] as PosPaymentItem[];
    }
    const res = await fetch(`/api/payments?orderId=${encodeURIComponent(orderId)}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || t.posPaymentFail);
    const items = (payload.items || []) as PosPaymentItem[];
    setPosPayments(items);
    return items;
  }, [t.posPaymentFail]);

  const loadPosApprovals = useCallback(async () => {
    const res = await fetch("/api/approvals?status=all&limit=20");
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || t.posReloadAction);
    setPosApprovals((payload.items || []) as PosApprovalItem[]);
  }, [t.posReloadAction]);

  const loadPosAudit = useCallback(async (targetId?: string) => {
    const query = targetId
      ? `/api/frontdesk/audit?limit=20&targetType=order&targetId=${encodeURIComponent(targetId)}`
      : "/api/frontdesk/audit?limit=20";
    const res = await fetch(query);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || t.posReloadAction);
    setPosAudit((payload.items || []) as PosAuditItem[]);
  }, [t.posReloadAction]);

  const loadPosInvoices = useCallback(async (orderId: string) => {
    if (!orderId) {
      setPosInvoices([]);
      return;
    }
    const res = await fetch(`/api/frontdesk/invoices?orderId=${encodeURIComponent(orderId)}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || t.posInvoiceFail);
    setPosInvoices((payload.items || []) as PosInvoiceEvent[]);
  }, [t.posInvoiceFail]);

  const handlePosSelectOrder = useCallback(async (orderId: string, amount?: number) => {
    setPosOrderId(orderId);
    setPosPaymentAmount(amount !== undefined ? String(amount) : posPaymentAmount);
    setPosCheckoutUrl("");
    setPosError(null);
    setPosMessage(null);
    setPosLoading(true);
    try {
      await Promise.all([
        loadPosPayments(orderId),
        loadPosInvoices(orderId),
        loadPosAudit(orderId),
      ]);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posReloadAction);
    } finally {
      setPosLoading(false);
    }
  }, [loadPosAudit, loadPosInvoices, loadPosPayments, posPaymentAmount, t.posReloadAction]);

  const handlePosCreateOrder = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedMemberId = posMemberId.trim();
    const subtotal = Number(posSubtotal);
    const discountAmount = Number(posDiscountAmount);
    const amount = Number((subtotal - discountAmount).toFixed(2));
    if (normalizedMemberId && !isUuid(normalizedMemberId)) {
      setPosError(t.posInvalidMemberId);
      setPosMessage(null);
      return;
    }
    if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
      setPosError(t.posInvalidAmount);
      setPosMessage(null);
      return;
    }
    const highDiscount = discountAmount > 0 && (discountAmount >= 500 || discountAmount / subtotal >= 0.2);
    if (highDiscount && !posManagerOverride) {
      setPosError(t.posManagerOverrideRequired);
      setPosMessage(null);
      return;
    }

    setPosCreatingOrder(true);
    setPosError(null);
    setPosMessage(null);
    setPosCheckoutUrl("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: normalizedMemberId || null,
          subtotal,
          discountAmount,
          discountNote: posDiscountNote.trim() || null,
          managerOverride: highDiscount ? posManagerOverride : false,
          amount,
          channel: "frontdesk",
          note: posNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posCreateFail);
      const newOrderId = String(payload?.order?.id || "");
      setPosOrderId(newOrderId);
      setPosPaymentAmount(String(amount));
      setPosMessage(`${t.posOrderCreated}: ${newOrderId}`);
      await Promise.all([loadDashboard(true), loadPosOrders(), handlePosSelectOrder(newOrderId, amount), loadPosApprovals()]);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posCreateFail);
    } finally {
      setPosCreatingOrder(false);
    }
  }, [
    handlePosSelectOrder,
    loadDashboard,
    loadPosApprovals,
    loadPosOrders,
    posDiscountAmount,
    posDiscountNote,
    posManagerOverride,
    posMemberId,
    posNote,
    posSubtotal,
    t.posCreateFail,
    t.posInvalidAmount,
    t.posInvalidMemberId,
    t.posManagerOverrideRequired,
    t.posOrderCreated,
  ]);

  const handlePosPayOrder = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(posPaymentAmount);
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setPosError(t.posInvalidAmount);
      setPosMessage(null);
      return;
    }
    if (amount > posRemaining + 0.01) {
      setPosError(t.posInvalidAmount);
      setPosMessage(null);
      return;
    }

    setPosPayingOrder(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: posOrderId,
          amount,
          method: posPaymentMethod,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posPaymentFail);
      setPosMessage(`${t.posPaymentRecorded}: ${payload?.payment?.id || "-"}`);
      await Promise.all([
        loadDashboard(true),
        loadPosOrders(),
        loadPosPayments(posOrderId),
        loadPosAudit(posOrderId),
      ]);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posPaymentFail);
    } finally {
      setPosPayingOrder(false);
    }
  }, [
    loadDashboard,
    loadPosAudit,
    loadPosOrders,
    loadPosPayments,
    posOrderId,
    posPaymentAmount,
    posPaymentMethod,
    posRemaining,
    t.posInvalidAmount,
    t.posOrderRequired,
    t.posPaymentFail,
    t.posPaymentRecorded,
  ]);

  const handlePosInitCheckout = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    setPosInitializingCheckout(true);
    setPosError(null);
    setPosMessage(null);
    setPosCheckoutUrl("");
    try {
      const res = await fetch("/api/payments/newebpay/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: posOrderId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posCheckoutFail);
      setPosCheckoutUrl(String(payload?.checkoutUrl || ""));
      setPosMessage(t.posCheckoutInitialized);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posCheckoutFail);
    } finally {
      setPosInitializingCheckout(false);
    }
  }, [posOrderId, t.posCheckoutFail, t.posCheckoutInitialized, t.posOrderRequired]);

  const handlePosVoidOrder = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    if (!posVoidReason.trim()) {
      setPosError(t.posReasonRequired);
      setPosMessage(null);
      return;
    }
    setPosSubmittingRisk(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(posOrderId)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: posVoidReason.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posVoidFail);
      setPosMessage(res.status === 202 ? t.posRequestSubmitted : t.posOrderVoided);
      setPosVoidReason("");
      await Promise.all([loadPosOrders(), loadPosApprovals(), loadPosAudit(posOrderId), loadDashboard(true)]);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posVoidFail);
    } finally {
      setPosSubmittingRisk(false);
    }
  }, [loadDashboard, loadPosApprovals, loadPosAudit, loadPosOrders, posOrderId, posVoidReason, t.posOrderRequired, t.posOrderVoided, t.posReasonRequired, t.posRequestSubmitted, t.posVoidFail]);

  const handlePosRefundPayment = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posRefundPaymentId.trim()) {
      setPosError(t.posRefundPaymentIdLabel);
      setPosMessage(null);
      return;
    }
    if (!posRefundReason.trim()) {
      setPosError(t.posReasonRequired);
      setPosMessage(null);
      return;
    }
    setPosSubmittingRisk(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(posRefundPaymentId.trim())}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: posRefundReason.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posRefundFail);
      setPosMessage(res.status === 202 ? t.posRequestSubmitted : t.posPaymentRefunded);
      setPosRefundReason("");
      await Promise.all([loadPosApprovals(), loadPosAudit(posOrderId), loadDashboard(true)]);
      if (posOrderId) await loadPosPayments(posOrderId);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posRefundFail);
    } finally {
      setPosSubmittingRisk(false);
    }
  }, [loadDashboard, loadPosApprovals, loadPosAudit, loadPosPayments, posOrderId, posRefundPaymentId, posRefundReason, t.posPaymentRefunded, t.posReasonRequired, t.posRefundFail, t.posRefundPaymentIdLabel, t.posRequestSubmitted]);

  const handlePosIssueInvoice = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    setPosSubmittingInvoice(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch("/api/frontdesk/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          orderId: posOrderId,
          invoiceNo: posInvoiceNo.trim() || null,
          taxId: posInvoiceTaxId.trim() || null,
          carrier: posInvoiceCarrier.trim() || null,
          buyerName: posInvoiceBuyerName.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posInvoiceFail);
      setPosMessage(t.posInvoiceIssued);
      const invoiceNo = String(payload?.invoiceEvent?.payload?.invoiceNo || posInvoiceNo || "");
      if (invoiceNo) setPosInvoiceNo(invoiceNo);
      await loadPosInvoices(posOrderId);
      await loadPosAudit(posOrderId);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posInvoiceFail);
    } finally {
      setPosSubmittingInvoice(false);
    }
  }, [loadPosAudit, loadPosInvoices, posInvoiceBuyerName, posInvoiceCarrier, posInvoiceNo, posInvoiceTaxId, posOrderId, t.posInvoiceFail, t.posInvoiceIssued, t.posOrderRequired]);

  const handlePosVoidInvoice = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    if (!posInvoiceNo.trim()) {
      setPosError(t.posInvoiceNoRequired);
      setPosMessage(null);
      return;
    }
    if (!posInvoiceReason.trim()) {
      setPosError(t.posReasonRequired);
      setPosMessage(null);
      return;
    }
    setPosSubmittingInvoice(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch("/api/frontdesk/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "void",
          orderId: posOrderId,
          invoiceNo: posInvoiceNo.trim(),
          reason: posInvoiceReason.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posInvoiceFail);
      setPosMessage(t.posInvoiceVoided);
      await loadPosInvoices(posOrderId);
      await loadPosAudit(posOrderId);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posInvoiceFail);
    } finally {
      setPosSubmittingInvoice(false);
    }
  }, [loadPosAudit, loadPosInvoices, posInvoiceNo, posInvoiceReason, posOrderId, t.posInvoiceFail, t.posInvoiceNoRequired, t.posInvoiceVoided, t.posOrderRequired, t.posReasonRequired]);

  const handlePosAllowanceInvoice = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!posOrderId) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    if (!posInvoiceNo.trim()) {
      setPosError(t.posInvoiceNoRequired);
      setPosMessage(null);
      return;
    }
    if (!posInvoiceReason.trim()) {
      setPosError(t.posReasonRequired);
      setPosMessage(null);
      return;
    }
    const allowanceAmount = Number(posAllowanceAmount);
    if (!Number.isFinite(allowanceAmount) || allowanceAmount <= 0) {
      setPosError(t.posInvalidAmount);
      setPosMessage(null);
      return;
    }
    setPosSubmittingInvoice(true);
    setPosError(null);
    setPosMessage(null);
    try {
      const res = await fetch("/api/frontdesk/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "allowance",
          orderId: posOrderId,
          invoiceNo: posInvoiceNo.trim(),
          allowanceAmount,
          reason: posInvoiceReason.trim(),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.posInvoiceFail);
      setPosMessage(t.posInvoiceAllowanceIssued);
      await loadPosInvoices(posOrderId);
      await loadPosAudit(posOrderId);
    } catch (err) {
      setPosError(err instanceof Error ? err.message : t.posInvoiceFail);
    } finally {
      setPosSubmittingInvoice(false);
    }
  }, [loadPosAudit, loadPosInvoices, posAllowanceAmount, posInvoiceNo, posInvoiceReason, posOrderId, t.posInvalidAmount, t.posInvoiceAllowanceIssued, t.posInvoiceFail, t.posInvoiceNoRequired, t.posOrderRequired, t.posReasonRequired]);

  const handlePosPrintReceipt = useCallback(() => {
    if (!selectedPosOrder) {
      setPosError(t.posOrderRequired);
      setPosMessage(null);
      return;
    }
    const win = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!win) return;
    const paidRows = posPayments
      .map((item) => `<tr><td>${item.id}</td><td>${item.method}</td><td>${item.status}</td><td>${item.amount}</td><td>${item.paid_at ? fmtDateTime(item.paid_at) : "-"}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Receipt ${selectedPosOrder.id}</title></head><body>
      <h2>Frontdesk Receipt</h2>
      <p>Order: ${selectedPosOrder.id}</p>
      <p>Amount: ${selectedPosOrder.amount}</p>
      <p>Status: ${selectedPosOrder.status}</p>
      <p>Member: ${selectedPosOrder.member_id || "-"}</p>
      <p>Printed At: ${new Date().toLocaleString()}</p>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead><tr><th>Payment ID</th><th>Method</th><th>Status</th><th>Amount</th><th>Paid At</th></tr></thead>
        <tbody>${paidRows || "<tr><td colspan='5'>No payments</td></tr>"}</tbody>
      </table>
    </body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }, [posPayments, selectedPosOrder, t.posOrderRequired]);

  const loadLockerRentals = useCallback(async () => {
    setLockerLoading(true);
    setLockerError(null);
    try {
      const res = await fetch("/api/frontdesk/lockers");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.lockerLoadFail);
      setLockerRentals((payload.items || []) as LockerRentalItem[]);
    } catch (err) {
      setLockerError(err instanceof Error ? err.message : t.lockerLoadFail);
    } finally {
      setLockerLoading(false);
    }
  }, [t.lockerLoadFail]);

  const handleCreateLockerRental = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLockerCode = lockerCode.trim().toUpperCase();
    const normalizedMemberId = lockerMemberId.trim();
    const normalizedRenter = lockerRenterName.trim();
    const normalizedPhone = lockerPhone.trim();
    const depositAmount = parseAmount(lockerDeposit);
    const dueAt = lockerRentalTerm === "custom" ? parseDateTimeInput(lockerDueAt) : calcLockerDueAtByTerm(lockerRentalTerm);

    if (!normalizedLockerCode) {
      setLockerError(t.lockerCodeRequired);
      setLockerMessage(null);
      return;
    }
    if (normalizedMemberId && !isMemberCode(normalizedMemberId)) {
      setLockerError(t.lockerMemberIdInvalid);
      setLockerMessage(null);
      return;
    }
    if (!normalizedMemberId && !normalizedRenter && !normalizedPhone) {
      setLockerError(t.lockerIdentifierRequired);
      setLockerMessage(null);
      return;
    }
    if (Number.isNaN(depositAmount)) {
      setLockerError(t.lockerDepositInvalid);
      setLockerMessage(null);
      return;
    }
    if (lockerRentalTerm === "custom" && !lockerDueAt.trim()) {
      setLockerError(t.lockerDueAtRequired);
      setLockerMessage(null);
      return;
    }
    if (lockerRentalTerm === "custom" && lockerDueAt.trim() && !dueAt) {
      setLockerError(t.lockerDueAtInvalid);
      setLockerMessage(null);
      return;
    }

    setLockerSubmitting(true);
    setLockerError(null);
    setLockerMessage(null);
    try {
      const res = await fetch("/api/frontdesk/lockers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rent",
          lockerCode: normalizedLockerCode,
          memberId: normalizedMemberId || null,
          renterName: normalizedRenter || null,
          phone: normalizedPhone || null,
          depositAmount,
          rentalTerm: lockerRentalTerm,
          dueAt,
          note: lockerNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (res.status === 404) throw new Error(payload?.error || t.lockerMemberNotFound);
        if (res.status === 409) throw new Error(payload?.error || t.lockerInUse);
        throw new Error(payload?.error || t.lockerRentFail);
      }

      setLockerCode("");
      setLockerMemberId("");
      setLockerRenterName("");
      setLockerPhone("");
      setLockerDeposit("0");
      setLockerRentalTerm("daily");
      setLockerDueAt("");
      setLockerNote("");
      setLockerMessage(t.lockerRentSuccess);
      await loadLockerRentals();
    } catch (err) {
      setLockerError(err instanceof Error ? err.message : t.lockerRentFail);
    } finally {
      setLockerSubmitting(false);
    }
  }, [
    loadLockerRentals,
    lockerCode,
    lockerDeposit,
    lockerDueAt,
    lockerMemberId,
    lockerNote,
    lockerPhone,
    lockerRentalTerm,
    lockerRenterName,
    t.lockerCodeRequired,
    t.lockerDepositInvalid,
    t.lockerDueAtInvalid,
    t.lockerDueAtRequired,
    t.lockerIdentifierRequired,
    t.lockerInUse,
    t.lockerMemberIdInvalid,
    t.lockerMemberNotFound,
    t.lockerRentFail,
    t.lockerRentSuccess,
  ]);

  const handleReturnLockerRental = useCallback(async (rentalId: string) => {
    setLockerSubmitting(true);
    setLockerError(null);
    setLockerMessage(null);
    try {
      const res = await fetch("/api/frontdesk/lockers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "return",
          rentalId,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.lockerReturnFail);
      setLockerMessage(t.lockerReturnSuccess);
      await loadLockerRentals();
    } catch (err) {
      setLockerError(err instanceof Error ? err.message : t.lockerReturnFail);
    } finally {
      setLockerSubmitting(false);
    }
  }, [loadLockerRentals, t.lockerReturnFail, t.lockerReturnSuccess]);

  const loadInventoryModule = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const res = await fetch("/api/frontdesk/inventory");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.inventoryLoadFail);
      const nextItems = (payload.items || []) as InventoryProductItem[];
      const nextMoves = (payload.moves || []) as InventoryMoveItem[];
      setInventoryItems(nextItems);
      setInventoryMoves(nextMoves);
      if (nextItems.length > 0) {
        setSaleProductCode((prev) => prev || nextItems[0].code);
        setAdjustProductCode((prev) => prev || nextItems[0].code);
      }
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : t.inventoryLoadFail);
    } finally {
      setInventoryLoading(false);
    }
  }, [t.inventoryLoadFail]);

  const handleInventoryCreateProduct = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = createProductCode.trim();
    const title = createProductTitle.trim();
    const unitPrice = Number(createProductUnitPrice);
    const openingOnHand = Number(createProductOnHand);
    const safetyStock = Number(createProductSafetyStock);
    const sortOrder = Number(createProductSortOrder);

    if (!/^[a-z0-9_]+$/i.test(code)) {
      setInventoryError(t.inventoryCreateCodeInvalid);
      setInventoryMessage(null);
      return;
    }
    if (!title) {
      setInventoryError(t.inventoryCreateTitleRequired);
      setInventoryMessage(null);
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setInventoryError(t.inventoryCreateUnitPriceInvalid);
      setInventoryMessage(null);
      return;
    }
    if (!Number.isFinite(openingOnHand) || !Number.isInteger(openingOnHand) || openingOnHand < 0) {
      setInventoryError(t.inventoryCreateOnHandInvalid);
      setInventoryMessage(null);
      return;
    }
    if (!Number.isFinite(safetyStock) || !Number.isInteger(safetyStock) || safetyStock < 0) {
      setInventoryError(t.inventoryCreateSafetyStockInvalid);
      setInventoryMessage(null);
      return;
    }
    if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
      setInventoryError(t.inventoryCreateSortOrderInvalid);
      setInventoryMessage(null);
      return;
    }

    setInventorySubmitting(true);
    setInventoryError(null);
    setInventoryMessage(null);
    try {
      const res = await fetch("/api/frontdesk/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_product",
          productCode: code,
          title,
          unitPrice,
          openingOnHand,
          safetyStock,
          sortOrder,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.inventoryCreateFail);
      setInventoryMessage(`${t.inventoryCreateSuccess}: ${payload?.product?.code || code}`);
      setCreateProductCode("");
      setCreateProductTitle("");
      setCreateProductUnitPrice("0");
      setCreateProductOnHand("0");
      setCreateProductSafetyStock("5");
      setCreateProductSortOrder("0");
      await loadInventoryModule();
      setSaleProductCode(code);
      setAdjustProductCode(code);
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : t.inventoryCreateFail);
    } finally {
      setInventorySubmitting(false);
    }
  }, [
    createProductCode,
    createProductOnHand,
    createProductSafetyStock,
    createProductSortOrder,
    createProductTitle,
    createProductUnitPrice,
    loadInventoryModule,
    t.inventoryCreateCodeInvalid,
    t.inventoryCreateFail,
    t.inventoryCreateOnHandInvalid,
    t.inventoryCreateSafetyStockInvalid,
    t.inventoryCreateSortOrderInvalid,
    t.inventoryCreateSuccess,
    t.inventoryCreateTitleRequired,
    t.inventoryCreateUnitPriceInvalid,
  ]);

  const handleInventorySale = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saleProductCode) {
      setInventoryError(t.inventoryProductRequired);
      setInventoryMessage(null);
      return;
    }
    const quantity = Number(saleQty);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      setInventoryError(t.inventoryQtyInvalid);
      setInventoryMessage(null);
      return;
    }

    setInventorySubmitting(true);
    setInventoryError(null);
    setInventoryMessage(null);
    try {
      const res = await fetch("/api/frontdesk/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sale",
          productCode: saleProductCode,
          quantity,
          memberCode: saleMemberCode.trim() || null,
          paymentMethod: salePaymentMethod,
          note: saleNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.inventorySaleFail);
      setInventoryMessage(`${t.inventorySaleSuccess}: #${payload?.order?.id || "-"}`);
      setSaleQty("1");
      setSaleNote("");
      await loadInventoryModule();
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : t.inventorySaleFail);
    } finally {
      setInventorySubmitting(false);
    }
  }, [
    loadInventoryModule,
    saleMemberCode,
    saleNote,
    salePaymentMethod,
    saleProductCode,
    saleQty,
    t.inventoryProductRequired,
    t.inventoryQtyInvalid,
    t.inventorySaleFail,
    t.inventorySaleSuccess,
  ]);

  const handleInventoryAdjust = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!adjustProductCode) {
      setInventoryError(t.inventoryProductRequired);
      setInventoryMessage(null);
      return;
    }
    const delta = Number(adjustDelta);
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
      setInventoryError(t.inventoryDeltaInvalid);
      setInventoryMessage(null);
      return;
    }

    setInventorySubmitting(true);
    setInventoryError(null);
    setInventoryMessage(null);
    try {
      const res = await fetch("/api/frontdesk/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          productCode: adjustProductCode,
          delta,
          note: adjustNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.inventoryAdjustFail);
      setInventoryMessage(`${t.inventoryAdjustSuccess}: ${adjustProductCode} (${delta > 0 ? "+" : ""}${delta})`);
      setAdjustDelta("1");
      setAdjustNote("");
      await loadInventoryModule();
    } catch (err) {
      setInventoryError(err instanceof Error ? err.message : t.inventoryAdjustFail);
    } finally {
      setInventorySubmitting(false);
    }
  }, [
    adjustDelta,
    adjustNote,
    adjustProductCode,
    loadInventoryModule,
    t.inventoryAdjustFail,
    t.inventoryAdjustSuccess,
    t.inventoryDeltaInvalid,
    t.inventoryProductRequired,
  ]);

  const loadCsModule = useCallback(async () => {
    setCsLoading(true);
    setCsError(null);
    try {
      const res = await fetch(`/api/frontdesk/incidents?status=${encodeURIComponent(csFilterStatus)}&limit=50`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.csLoadFail);
      const nextItems = (payload.items || []) as CsIncidentItem[];
      setCsIncidents(nextItems);
      setCsSelectedIncidentId((prev) => {
        if (prev && nextItems.some((item) => item.id === prev)) return prev;
        return nextItems[0]?.id || "";
      });
    } catch (err) {
      setCsError(err instanceof Error ? err.message : t.csLoadFail);
    } finally {
      setCsLoading(false);
    }
  }, [csFilterStatus, t.csLoadFail]);

  const handleCsCreateIncident = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const memberCode = csMemberCode.trim();
    const title = csCaseTitle.trim();
    const detail = csCaseDetail.trim();
    const happenedAt = parseDateTimeInput(csHappenedAt);
    const dueAt = parseDateTimeInput(csDueAt);

    if (!title) {
      setCsError(t.csCaseTitleRequired);
      setCsMessage(null);
      return;
    }
    if (!detail) {
      setCsError(t.csCaseDetailRequired);
      setCsMessage(null);
      return;
    }
    if (memberCode && !isMemberCode(memberCode)) {
      setCsError(t.csMemberCodeInvalid);
      setCsMessage(null);
      return;
    }
    if (csHappenedAt.trim() && !happenedAt) {
      setCsError(t.csDateInvalid);
      setCsMessage(null);
      return;
    }
    if (csDueAt.trim() && !dueAt) {
      setCsError(t.csDateInvalid);
      setCsMessage(null);
      return;
    }

    setCsSubmitting(true);
    setCsError(null);
    setCsMessage(null);
    try {
      const res = await fetch("/api/frontdesk/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          incidentType: csIncidentType,
          priority: csPriority,
          source: csSource,
          memberCode: memberCode || null,
          memberName: csMemberName.trim() || null,
          contactPhone: csContactPhone.trim() || null,
          title,
          detail,
          happenedAt,
          dueAt,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.csCreateFail);
      setCsCaseTitle("");
      setCsCaseDetail("");
      setCsMemberCode("");
      setCsMemberName("");
      setCsContactPhone("");
      setCsHappenedAt("");
      setCsDueAt("");
      const incidentNo = String(payload?.incident?.incidentNo || "");
      setCsMessage(incidentNo ? `${t.csCreateSuccess}: ${incidentNo}` : t.csCreateSuccess);
      await loadCsModule();
    } catch (err) {
      setCsError(err instanceof Error ? err.message : t.csCreateFail);
    } finally {
      setCsSubmitting(false);
    }
  }, [
    csCaseDetail,
    csCaseTitle,
    csContactPhone,
    csDueAt,
    csHappenedAt,
    csIncidentType,
    csMemberCode,
    csMemberName,
    csPriority,
    csSource,
    loadCsModule,
    t.csCaseDetailRequired,
    t.csCaseTitleRequired,
    t.csCreateFail,
    t.csCreateSuccess,
    t.csDateInvalid,
    t.csMemberCodeInvalid,
  ]);

  const handleCsUpdateStatus = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!csSelectedIncidentId) {
      setCsError(t.csIncidentRequired);
      setCsMessage(null);
      return;
    }
    setCsSubmitting(true);
    setCsError(null);
    setCsMessage(null);
    try {
      const res = await fetch("/api/frontdesk/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          incidentId: csSelectedIncidentId,
          status: csStatusTo,
          note: csStatusNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.csUpdateFail);
      setCsMessage(t.csUpdateSuccess);
      setCsStatusNote("");
      await loadCsModule();
    } catch (err) {
      setCsError(err instanceof Error ? err.message : t.csUpdateFail);
    } finally {
      setCsSubmitting(false);
    }
  }, [csSelectedIncidentId, csStatusNote, csStatusTo, loadCsModule, t.csIncidentRequired, t.csUpdateFail, t.csUpdateSuccess]);

  const handleCsAddFollowup = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!csSelectedIncidentId) {
      setCsError(t.csIncidentRequired);
      setCsMessage(null);
      return;
    }
    const note = csFollowupNote.trim();
    if (!note) {
      setCsError(t.csNoteRequired);
      setCsMessage(null);
      return;
    }
    setCsSubmitting(true);
    setCsError(null);
    setCsMessage(null);
    try {
      const res = await fetch("/api/frontdesk/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "followup",
          incidentId: csSelectedIncidentId,
          note,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.csFollowupFail);
      setCsMessage(t.csFollowupSuccess);
      setCsFollowupNote("");
      await loadCsModule();
    } catch (err) {
      setCsError(err instanceof Error ? err.message : t.csFollowupFail);
    } finally {
      setCsSubmitting(false);
    }
  }, [csFollowupNote, csSelectedIncidentId, loadCsModule, t.csFollowupFail, t.csFollowupSuccess, t.csIncidentRequired, t.csNoteRequired]);

  const handleCsResolve = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!csSelectedIncidentId) {
      setCsError(t.csIncidentRequired);
      setCsMessage(null);
      return;
    }
    const resolutionNote = csResolveNote.trim();
    if (!resolutionNote) {
      setCsError(t.csNoteRequired);
      setCsMessage(null);
      return;
    }
    setCsSubmitting(true);
    setCsError(null);
    setCsMessage(null);
    try {
      const res = await fetch("/api/frontdesk/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          incidentId: csSelectedIncidentId,
          resolutionNote,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || t.csResolveFail);
      setCsMessage(t.csResolveSuccess);
      setCsResolveNote("");
      setCsStatusTo("resolved");
      await loadCsModule();
    } catch (err) {
      setCsError(err instanceof Error ? err.message : t.csResolveFail);
    } finally {
      setCsSubmitting(false);
    }
  }, [csResolveNote, csSelectedIncidentId, loadCsModule, t.csIncidentRequired, t.csNoteRequired, t.csResolveFail, t.csResolveSuccess]);

  const loadLeadModule = useCallback(async () => {
    setLeadLoading(true);
    setLeadError(null);
    try {
      const res = await fetch(`/api/frontdesk/leads?status=${encodeURIComponent(leadStatusFilter)}&limit=80`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "載入線索失敗" : "Load leads failed"));
      const items = (payload.items || []) as LeadItem[];
      setLeadItems(items);
      setLeadSelectedId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        return items[0]?.id || "";
      });
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "載入線索失敗" : "Load leads failed"));
    } finally {
      setLeadLoading(false);
    }
  }, [lang, leadStatusFilter]);

  const handleLeadCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = leadName.trim();
    const phone = leadPhone.trim();
    const note = leadCreateNote.trim();
    const tourAt = parseDateTimeInput(leadCreateTourAt);

    if (!name) {
      setLeadError(lang === "zh" ? "請輸入姓名" : "Please enter lead name");
      setLeadMessage(null);
      return;
    }
    if (leadCreateTourAt.trim() && !tourAt) {
      setLeadError(lang === "zh" ? "導覽時間格式錯誤" : "Invalid tour time");
      setLeadMessage(null);
      return;
    }

    setLeadSubmitting(true);
    setLeadError(null);
    setLeadMessage(null);
    try {
      const res = await fetch("/api/frontdesk/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name,
          phone: phone || null,
          source: leadSource.trim() || null,
          interest: leadInterest.trim() || null,
          note: note || null,
          tourAt,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "建立線索失敗" : "Create lead failed"));
      setLeadName("");
      setLeadPhone("");
      setLeadCreateNote("");
      setLeadCreateTourAt("");
      const newLeadId = String(payload?.leadId || "");
      setLeadMessage(lang === "zh" ? "線索已建立" : "Lead created");
      await loadLeadModule();
      if (newLeadId) setLeadSelectedId(newLeadId);
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "建立線索失敗" : "Create lead failed"));
    } finally {
      setLeadSubmitting(false);
    }
  }, [
    lang,
    leadCreateNote,
    leadCreateTourAt,
    leadInterest,
    leadName,
    leadPhone,
    leadSource,
    loadLeadModule,
  ]);

  const handleLeadScheduleTour = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadSelectedId) {
      setLeadError(lang === "zh" ? "請先選擇線索" : "Please select a lead first");
      setLeadMessage(null);
      return;
    }
    const tourAt = parseDateTimeInput(leadScheduleTourAt);
    if (!tourAt) {
      setLeadError(lang === "zh" ? "請輸入有效導覽時間" : "Please enter a valid tour time");
      setLeadMessage(null);
      return;
    }

    setLeadSubmitting(true);
    setLeadError(null);
    setLeadMessage(null);
    try {
      const res = await fetch("/api/frontdesk/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule_tour",
          leadId: leadSelectedId,
          tourAt,
          note: leadScheduleNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "安排導覽失敗" : "Schedule tour failed"));
      setLeadMessage(lang === "zh" ? "導覽時間已更新" : "Tour scheduled");
      setLeadScheduleNote("");
      await loadLeadModule();
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "安排導覽失敗" : "Schedule tour failed"));
    } finally {
      setLeadSubmitting(false);
    }
  }, [lang, leadScheduleNote, leadScheduleTourAt, leadSelectedId, loadLeadModule]);

  const handleLeadFollowup = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadSelectedId) {
      setLeadError(lang === "zh" ? "請先選擇線索" : "Please select a lead first");
      setLeadMessage(null);
      return;
    }
    const note = leadFollowupNote.trim();
    if (!note) {
      setLeadError(lang === "zh" ? "請輸入追蹤內容" : "Please enter follow-up note");
      setLeadMessage(null);
      return;
    }

    setLeadSubmitting(true);
    setLeadError(null);
    setLeadMessage(null);
    try {
      const res = await fetch("/api/frontdesk/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "followup",
          leadId: leadSelectedId,
          note,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "新增追蹤失敗" : "Add follow-up failed"));
      setLeadMessage(lang === "zh" ? "已新增追蹤紀錄" : "Follow-up added");
      setLeadFollowupNote("");
      await loadLeadModule();
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "新增追蹤失敗" : "Add follow-up failed"));
    } finally {
      setLeadSubmitting(false);
    }
  }, [lang, leadFollowupNote, leadSelectedId, loadLeadModule]);

  const handleLeadConvert = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadSelectedId) {
      setLeadError(lang === "zh" ? "請先選擇線索" : "Please select a lead first");
      setLeadMessage(null);
      return;
    }

    let memberId = leadConvertMemberId.trim();
    if (memberId && !isUuid(memberId)) {
      setLeadError(lang === "zh" ? "會員 ID 格式錯誤，需為 UUID" : "Invalid member ID format");
      setLeadMessage(null);
      return;
    }

    setLeadSubmitting(true);
    setLeadError(null);
    setLeadMessage(null);
    try {
      if (!memberId) {
        if (!selectedLead?.name || !selectedLead?.phone) {
          throw new Error(lang === "zh"
            ? "請填寫會員 ID，或先補齊線索姓名與電話"
            : "Provide member ID or ensure lead has name and phone");
        }
        const memberRes = await fetch("/api/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: selectedLead.name,
            phone: selectedLead.phone,
            leadSource: selectedLead.source || "frontdesk_lead",
          }),
        });
        const memberPayload = await memberRes.json();
        if (memberRes.status === 409 && memberPayload?.existingMember?.id) {
          memberId = String(memberPayload.existingMember.id);
        } else if (!memberRes.ok) {
          throw new Error(memberPayload?.error || (lang === "zh" ? "建立會員失敗" : "Create member failed"));
        } else {
          memberId = String(memberPayload?.member?.id || "");
        }
      }

      const res = await fetch("/api/frontdesk/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "convert",
          leadId: leadSelectedId,
          memberId: memberId || null,
          note: leadConvertNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "轉會員失敗" : "Convert lead failed"));
      setLeadMessage(lang === "zh" ? "已完成轉會員" : "Lead converted");
      setLeadConvertMemberId(memberId || "");
      setLeadConvertNote("");
      await loadLeadModule();
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "轉會員失敗" : "Convert lead failed"));
    } finally {
      setLeadSubmitting(false);
    }
  }, [lang, leadConvertMemberId, leadConvertNote, leadSelectedId, loadLeadModule, selectedLead?.name, selectedLead?.phone, selectedLead?.source]);

  const handleLeadMarkLost = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leadSelectedId) {
      setLeadError(lang === "zh" ? "請先選擇線索" : "Please select a lead first");
      setLeadMessage(null);
      return;
    }
    const reason = leadLostReason.trim();
    if (!reason) {
      setLeadError(lang === "zh" ? "請輸入失單原因" : "Please enter lost reason");
      setLeadMessage(null);
      return;
    }

    setLeadSubmitting(true);
    setLeadError(null);
    setLeadMessage(null);
    try {
      const res = await fetch("/api/frontdesk/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_lost",
          leadId: leadSelectedId,
          reason,
          note: leadLostNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "標記失單失敗" : "Mark lost failed"));
      setLeadMessage(lang === "zh" ? "線索已標記失單" : "Lead marked as lost");
      setLeadLostReason("");
      setLeadLostNote("");
      await loadLeadModule();
    } catch (err) {
      setLeadError(err instanceof Error ? err.message : (lang === "zh" ? "標記失單失敗" : "Mark lost failed"));
    } finally {
      setLeadSubmitting(false);
    }
  }, [lang, leadLostNote, leadLostReason, leadSelectedId, loadLeadModule]);

  const loadChainModule = useCallback(async () => {
    setChainLoading(true);
    setChainError(null);
    try {
      const res = await fetch("/api/frontdesk/chain-rules?limit=120");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "載入跨店規則失敗" : "Load chain rules failed"));
      const nextRule = (payload.rule || null) as ChainRuleItem | null;
      const nextBlacklist = (payload.blacklist || []) as ChainBlacklistItem[];
      if (nextRule) {
        setChainRule(nextRule);
        setChainAllowedBranchText((nextRule.allowedBranchIds || []).join(", "));
        setChainMaxEntryPerDayText(nextRule.maxEntryPerDay === null || nextRule.maxEntryPerDay === undefined ? "" : String(nextRule.maxEntryPerDay));
        setChainRuleNote(nextRule.note || "");
      }
      setChainBlacklistItems(nextBlacklist);
      setChainRemoveTargetId((prev) => {
        if (prev && nextBlacklist.some((item) => item.id === prev)) return prev;
        return nextBlacklist[0]?.id || "";
      });
    } catch (err) {
      setChainError(err instanceof Error ? err.message : (lang === "zh" ? "載入跨店規則失敗" : "Load chain rules failed"));
    } finally {
      setChainLoading(false);
    }
  }, [lang]);

  const handleChainSaveRule = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const maxEntryPerDay = chainMaxEntryPerDayText.trim() ? Number(chainMaxEntryPerDayText.trim()) : null;
    if (maxEntryPerDay !== null && (!Number.isFinite(maxEntryPerDay) || !Number.isInteger(maxEntryPerDay) || maxEntryPerDay <= 0)) {
      setChainError(lang === "zh" ? "每日上限需為正整數" : "Daily limit must be a positive integer");
      setChainMessage(null);
      return;
    }
    const allowedBranchIds = chainAllowedBranchText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    setChainSubmitting(true);
    setChainError(null);
    setChainMessage(null);
    try {
      const res = await fetch("/api/frontdesk/chain-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_rule",
          allowCrossBranch: chainRule.allowCrossBranch,
          requireManagerApproval: chainRule.requireManagerApproval,
          suspensionSync: chainRule.suspensionSync,
          guestPassEnabled: chainRule.guestPassEnabled,
          maxEntryPerDay,
          allowedBranchIds,
          note: chainRuleNote.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "儲存跨店規則失敗" : "Save chain rules failed"));
      setChainMessage(lang === "zh" ? "跨店規則已更新" : "Chain rules updated");
      await loadChainModule();
    } catch (err) {
      setChainError(err instanceof Error ? err.message : (lang === "zh" ? "儲存跨店規則失敗" : "Save chain rules failed"));
    } finally {
      setChainSubmitting(false);
    }
  }, [chainAllowedBranchText, chainMaxEntryPerDayText, chainRule.allowCrossBranch, chainRule.guestPassEnabled, chainRule.requireManagerApproval, chainRule.suspensionSync, chainRuleNote, lang, loadChainModule]);

  const handleChainAddBlacklist = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = chainBlacklistName.trim();
    const reason = chainBlacklistReason.trim();
    if (!name) {
      setChainError(lang === "zh" ? "請輸入姓名" : "Please enter name");
      setChainMessage(null);
      return;
    }
    if (!reason) {
      setChainError(lang === "zh" ? "請輸入原因" : "Please enter reason");
      setChainMessage(null);
      return;
    }
    if (chainBlacklistMemberCode.trim() && !isMemberCode(chainBlacklistMemberCode.trim())) {
      setChainError(lang === "zh" ? "會員編號格式錯誤（1~9999）" : "Invalid member code format");
      setChainMessage(null);
      return;
    }
    const expiresAt = parseDateTimeInput(chainBlacklistExpiresAt);
    if (chainBlacklistExpiresAt.trim() && !expiresAt) {
      setChainError(lang === "zh" ? "到期時間格式錯誤" : "Invalid expires time");
      setChainMessage(null);
      return;
    }

    setChainSubmitting(true);
    setChainError(null);
    setChainMessage(null);
    try {
      const res = await fetch("/api/frontdesk/chain-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_blacklist",
          name,
          memberCode: chainBlacklistMemberCode.trim() || null,
          phone: chainBlacklistPhone.trim() || null,
          reason,
          expiresAt,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "新增黑名單失敗" : "Add blacklist failed"));
      setChainMessage(lang === "zh" ? "黑名單已新增" : "Blacklist added");
      setChainBlacklistName("");
      setChainBlacklistMemberCode("");
      setChainBlacklistPhone("");
      setChainBlacklistReason("");
      setChainBlacklistExpiresAt("");
      await loadChainModule();
    } catch (err) {
      setChainError(err instanceof Error ? err.message : (lang === "zh" ? "新增黑名單失敗" : "Add blacklist failed"));
    } finally {
      setChainSubmitting(false);
    }
  }, [chainBlacklistExpiresAt, chainBlacklistMemberCode, chainBlacklistName, chainBlacklistPhone, chainBlacklistReason, lang, loadChainModule]);

  const handleChainRemoveBlacklist = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chainRemoveTargetId) {
      setChainError(lang === "zh" ? "請先選擇黑名單項目" : "Please select blacklist record");
      setChainMessage(null);
      return;
    }

    setChainSubmitting(true);
    setChainError(null);
    setChainMessage(null);
    try {
      const res = await fetch("/api/frontdesk/chain-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_blacklist",
          entryId: chainRemoveTargetId,
          reason: chainRemoveReason.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (lang === "zh" ? "移除黑名單失敗" : "Remove blacklist failed"));
      setChainMessage(lang === "zh" ? "黑名單已移除" : "Blacklist removed");
      setChainRemoveReason("");
      await loadChainModule();
    } catch (err) {
      setChainError(err instanceof Error ? err.message : (lang === "zh" ? "移除黑名單失敗" : "Remove blacklist failed"));
    } finally {
      setChainSubmitting(false);
    }
  }, [chainRemoveReason, chainRemoveTargetId, lang, loadChainModule]);

  const loadReportModule = useCallback(async () => {
    setReportLoading(true);
    setReportError(null);
    try {
      await Promise.all([
        loadDashboard(true),
        loadPosOrders(),
        loadPosApprovals(),
        loadCsModule(),
        loadLeadModule(),
      ]);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : (lang === "zh" ? "載入看板失敗" : "Load report board failed"));
    } finally {
      setReportLoading(false);
    }
  }, [lang, loadCsModule, loadDashboard, loadLeadModule, loadPosApprovals, loadPosOrders]);

  const capabilityCards = useMemo(
    (): CapabilityCard[] =>
      lang === "zh"
        ? [
            { id: "entry", title: "A. 入場 / 放行", desc: "掃碼、人工放行、取消誤刷、原因碼與稽核。", detail: "支援會員卡 / QR / 人工例外放行，並要求原因碼與備註，完整寫入稽核。", area: "ENTRY", status: "ready" },
            { id: "member", title: "B. 會員查詢 / 建檔", desc: "防重複建檔、自訂欄位、快速下一步。", detail: "支援電話/姓名搜尋、防重複建立、補資料與自訂欄位，櫃檯可直接接續收款與預約。", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. 收銀 / POS / 發票", desc: "訂單收款、退費/作廢送審、結帳流程。", detail: "包含櫃檯收款、多付款方式、退費與作廢送審流程，並保留稽核軌跡。", area: "POS", status: "ready" },
            { id: "booking", title: "D. 預約 / 課務", desc: "建立即時預約與課務調整。", detail: "可建立、改期、取消課務預約，支援現場快速調整時段。", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. 置物櫃 / 租借", desc: "置物櫃租借登記、歸還與押金管理。", detail: "可直接登記租借與歸還，包含押金、到期時間與備註，並保留完整操作軌跡。", area: "LOCKER", status: "ready" },
            { id: "inventory", title: "F. 商品 / 庫存 / 銷售", desc: "前台銷售、庫存調整、低庫存提醒。", detail: "可直接在櫃檯完成商品銷售入帳、庫存扣減與補貨/盤損調整，並保留異動紀錄。", area: "INVENTORY", status: "ready" },
            { id: "cs", title: "G. 客服 / 事件紀錄", desc: "客訴與現場事件工單，含進度追蹤與結案。", detail: "可建立客服/事件工單、更新處理狀態、追加追蹤紀錄與結案說明，並保留完整操作軌跡。", area: "CS", status: "ready" },
            { id: "lead", title: "H. 線索 / 參觀導覽", desc: "Lead 建檔、轉會員、追蹤轉換。", detail: "已上線：線索建檔、導覽排程、追蹤紀錄與轉會員/失單流程。", area: "LEAD", status: "ready" },
            { id: "chain", title: "I. 跨店規則", desc: "跨店可用範圍、停權/黑名單同步。", detail: "已上線：跨店放行規則、例外覆核條件與黑名單同步維護。", area: "CHAIN", status: "ready" },
            { id: "report", title: "J. 報表 / 即時監控", desc: "今日營收、到期、欠費、No-show、待辦。", detail: "已上線：櫃檯今日營運看板、待辦彙總與風險提示。", area: "REPORT", status: "ready" },
            { id: "audit", title: "K. 權限 / 稽核", desc: "高風險送審、角色權限、完整稽核軌跡。", detail: "已上線：高風險動作送審、管理者核准/駁回、完整 Audit Log。", area: "AUDIT", status: "ready" },
          ]
        : [
            { id: "entry", title: "A. Entry / Allow", desc: "Scan, exception pass, undo, reason code with audit.", detail: "Supports card/QR/manual exception pass with reason code and full audit trail.", area: "ENTRY", status: "ready" },
            { id: "member", title: "B. Member Search / Create", desc: "Duplicate prevention, custom fields, quick actions.", detail: "Search/create with duplicate prevention and configurable custom fields.", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. POS / Invoice", desc: "Order payment, refund/void approval flow.", detail: "Desk payment, multi-method checkout, and approved high-risk refund/void flow.", area: "POS", status: "ready" },
            { id: "booking", title: "D. Booking / Classes", desc: "Booking creation and class schedule handling.", detail: "Create, reschedule, and cancel class bookings from desk operations.", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. Locker / Rental", desc: "Locker rent/return with deposit handling.", detail: "Register rental and return with deposit, due time, and operation audit trail.", area: "LOCKER", status: "ready" },
            { id: "inventory", title: "F. Product / Inventory", desc: "Desk sales, stock adjustments, low-stock alerts.", detail: "Complete product sales posting, stock deduction, restock/adjustment, and movement history in frontdesk.", area: "INVENTORY", status: "ready" },
            { id: "cs", title: "G. Service / Incidents", desc: "Complaint and on-site incident tickets with workflow.", detail: "Create incident tickets, update status, add follow-up notes, and close with resolution records.", area: "CS", status: "ready" },
            { id: "lead", title: "H. Lead / Tours", desc: "Lead intake, visit scheduling, conversion.", detail: "Ready: lead intake, tour scheduling, follow-up timeline, and conversion/lost flow.", area: "LEAD", status: "ready" },
            { id: "chain", title: "I. Multi-Branch Rules", desc: "Cross-branch policy and blacklist sync.", detail: "Ready: cross-branch access rules, approval gates, and synced blacklist controls.", area: "CHAIN", status: "ready" },
            { id: "report", title: "J. Reports / Live Monitor", desc: "Revenue, due list, no-show, handover TODO.", detail: "Ready: desk live operation board with pending tasks and risk indicators.", area: "REPORT", status: "ready" },
            { id: "audit", title: "K. Role / Audit", desc: "Approval workflow, role control, full audit logs.", detail: "Ready: approval workflow, role-based controls, and audit logs.", area: "AUDIT", status: "ready" },
          ],
    [lang],
  );

  const selectedCapability = useMemo(
    () => capabilityCards.find((item) => item.id === selectedCapabilityId) ?? capabilityCards[0],
    [capabilityCards, selectedCapabilityId],
  );

  const capabilityRingItems = useMemo(() => {
    const step = 360 / capabilityCards.length;
    return capabilityCards.map((item, index) => {
      const letterMatch = /^([A-Z])\./i.exec(item.title);
      const letter = letterMatch ? letterMatch[1].toUpperCase() : item.area.charAt(0).toUpperCase();
      const moduleTitle = item.title.replace(/^[A-Z]\.\s*/i, "");
      return { ...item, letter, moduleTitle, baseAngle: index * step };
    });
  }, [capabilityCards]);

  const handleCapabilityRingPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const ring = capabilityRingRef.current;
    if (!ring) return;
    capabilityDragStateRef.current.active = true;
    capabilityDragStateRef.current.pointerId = event.pointerId;
    capabilityDragStateRef.current.startX = event.clientX;
    capabilityDragStateRef.current.startAngle = capabilityRingAngle;
    capabilityDragStateRef.current.moved = false;
    capabilitySuppressClickRef.current = false;
    setCapabilityRailDragging(true);
    ring.setPointerCapture?.(event.pointerId);
  }, [capabilityRingAngle]);

  const handleCapabilityRingPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!capabilityDragStateRef.current.active) return;
    const ring = capabilityRingRef.current;
    if (!ring) return;
    const delta = event.clientX - capabilityDragStateRef.current.startX;
    setCapabilityRingAngle(capabilityDragStateRef.current.startAngle + delta * 0.32);
    if (Math.abs(delta) > 12) {
      capabilityDragStateRef.current.moved = true;
      capabilitySuppressClickRef.current = true;
    }
  }, []);

  const handleCapabilityRingPointerUp = useCallback(() => {
    const moved = capabilityDragStateRef.current.moved;
    capabilityDragStateRef.current.active = false;
    capabilityDragStateRef.current.pointerId = -1;
    setCapabilityRailDragging(false);
    if (moved) {
      capabilitySuppressClickRef.current = true;
      window.setTimeout(() => {
        capabilitySuppressClickRef.current = false;
      }, 180);
      capabilityDragStateRef.current.moved = false;
    } else {
      capabilitySuppressClickRef.current = false;
    }
  }, []);

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

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "locker") return;
    void loadLockerRentals();
  }, [capabilityOpen, loadLockerRentals, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "inventory") return;
    void loadInventoryModule();
  }, [capabilityOpen, loadInventoryModule, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "cs") return;
    void loadCsModule();
  }, [capabilityOpen, loadCsModule, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "lead") return;
    void loadLeadModule();
  }, [capabilityOpen, loadLeadModule, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "chain") return;
    void loadChainModule();
  }, [capabilityOpen, loadChainModule, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "report") return;
    void loadReportModule();
  }, [capabilityOpen, loadReportModule, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "pos") return;
    setPosLoading(true);
    setPosError(null);
    void Promise.all([
      loadPosOrders(),
      loadPosApprovals(),
      loadPosAudit(posOrderId || undefined),
      posOrderId ? loadPosPayments(posOrderId) : Promise.resolve([] as PosPaymentItem[]),
      posOrderId ? loadPosInvoices(posOrderId) : Promise.resolve(),
    ])
      .catch((err) => {
        setPosError(err instanceof Error ? err.message : t.posReloadAction);
      })
      .finally(() => setPosLoading(false));
  }, [
    capabilityOpen,
    loadPosApprovals,
    loadPosAudit,
    loadPosInvoices,
    loadPosOrders,
    loadPosPayments,
    modalType,
    posOrderId,
    selectedCapabilityId,
    t.posReloadAction,
  ]);

  useEffect(() => {
    if (csIncidents.length === 0) {
      if (csSelectedIncidentId) setCsSelectedIncidentId("");
      return;
    }
    if (!csSelectedIncidentId || !csIncidents.some((item) => item.id === csSelectedIncidentId)) {
      setCsSelectedIncidentId(csIncidents[0].id);
    }
  }, [csIncidents, csSelectedIncidentId]);

  useEffect(() => {
    if (leadItems.length === 0) {
      if (leadSelectedId) setLeadSelectedId("");
      return;
    }
    if (!leadSelectedId || !leadItems.some((item) => item.id === leadSelectedId)) {
      setLeadSelectedId(leadItems[0].id);
    }
  }, [leadItems, leadSelectedId]);

  useEffect(() => {
    if (lockerRentalTerm !== "custom" && lockerDueAt) {
      setLockerDueAt("");
    }
  }, [lockerDueAt, lockerRentalTerm]);

  useEffect(() => {
    if (inventoryItems.length === 0) {
      setSaleProductCode("");
      setAdjustProductCode("");
      return;
    }
    if (!saleProductCode || !inventoryItems.some((item) => item.code === saleProductCode)) {
      setSaleProductCode(inventoryItems[0].code);
    }
    if (!adjustProductCode || !inventoryItems.some((item) => item.code === adjustProductCode)) {
      setAdjustProductCode(inventoryItems[0].code);
    }
  }, [adjustProductCode, inventoryItems, saleProductCode]);

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

  function lockerTermLabel(term: string) {
    if (term === "daily") return t.lockerTermDaily;
    if (term === "monthly") return t.lockerTermMonthly;
    if (term === "half_year") return t.lockerTermHalfYear;
    if (term === "yearly") return t.lockerTermYearly;
    return t.lockerTermCustom;
  }

  function inventoryMoveReasonLabel(reason: string) {
    if (reason === "sale") return t.inventoryMoveSale;
    if (reason === "restock") return t.inventoryMoveRestock;
    return t.inventoryMoveAdjust;
  }

  function posApprovalStatusLabel(status: string) {
    if (status === "pending") return t.posStatusPending;
    if (status === "approved") return t.posStatusApproved;
    if (status === "rejected") return t.posStatusRejected;
    return t.posStatusCancelled;
  }

  function posApprovalStatusStyle(status: string) {
    if (status === "approved") {
      return { background: "rgba(16,185,129,.14)", borderColor: "rgba(16,185,129,.42)", color: "#047857" };
    }
    if (status === "rejected") {
      return { background: "rgba(239,68,68,.12)", borderColor: "rgba(239,68,68,.42)", color: "#b91c1c" };
    }
    if (status === "cancelled") {
      return { background: "rgba(107,114,128,.14)", borderColor: "rgba(107,114,128,.36)", color: "#374151" };
    }
    return { background: "rgba(234,179,8,.16)", borderColor: "rgba(234,179,8,.46)", color: "#92400e" };
  }

  function posRiskActionLabel(action: string) {
    if (action === "order_void") return t.posVoidSection;
    if (action === "payment_refund") return t.posRefundSection;
    return action;
  }

  function csStatusLabel(status: string) {
    if (status === "open") return t.csStatusOpen;
    if (status === "in_progress") return t.csStatusInProgress;
    if (status === "resolved") return t.csStatusResolved;
    return t.csStatusClosed;
  }

  function csStatusStyle(status: string) {
    if (status === "resolved") {
      return { background: "rgba(16,185,129,.14)", borderColor: "rgba(16,185,129,.42)", color: "#047857" };
    }
    if (status === "in_progress") {
      return { background: "rgba(59,130,246,.14)", borderColor: "rgba(59,130,246,.4)", color: "#1d4ed8" };
    }
    if (status === "closed") {
      return { background: "rgba(107,114,128,.14)", borderColor: "rgba(107,114,128,.36)", color: "#374151" };
    }
    return { background: "rgba(234,179,8,.16)", borderColor: "rgba(234,179,8,.46)", color: "#92400e" };
  }

  function csTypeLabel(type: string) {
    if (type === "complaint") return t.csTypeComplaint;
    if (type === "facility") return t.csTypeFacility;
    if (type === "safety") return t.csTypeSafety;
    if (type === "billing") return t.csTypeBilling;
    if (type === "member") return t.csTypeMember;
    return t.csTypeOther;
  }

  function csPriorityLabel(priority: string) {
    if (priority === "low") return t.csPriorityLow;
    if (priority === "high") return t.csPriorityHigh;
    if (priority === "urgent") return t.csPriorityUrgent;
    return t.csPriorityNormal;
  }

  function csSourceLabel(source: string) {
    if (source === "phone") return t.csSourcePhone;
    if (source === "line") return t.csSourceLine;
    if (source === "email") return t.csSourceEmail;
    if (source === "walkin") return t.csSourceWalkin;
    if (source === "other") return t.csSourceOther;
    return t.csSourceFrontdesk;
  }

  function csEventActionLabel(action: string) {
    if (action === "created") return t.csEventCreated;
    if (action === "status_changed") return t.csEventStatusChanged;
    if (action === "resolved") return t.csEventResolved;
    if (action === "reopened") return t.csEventReopened;
    if (action === "assigned") return t.csEventAssigned;
    return t.csEventFollowup;
  }

  function leadStatusLabel(status: LeadStatus | string) {
    if (status === "tour_scheduled") return lang === "zh" ? "已排導覽" : "Tour Scheduled";
    if (status === "converted") return lang === "zh" ? "已轉會員" : "Converted";
    if (status === "lost") return lang === "zh" ? "已失單" : "Lost";
    return lang === "zh" ? "新線索" : "New";
  }

  function leadStatusStyle(status: LeadStatus | string) {
    if (status === "tour_scheduled") {
      return { background: "rgba(59,130,246,.14)", borderColor: "rgba(59,130,246,.4)", color: "#1d4ed8" };
    }
    if (status === "converted") {
      return { background: "rgba(16,185,129,.14)", borderColor: "rgba(16,185,129,.42)", color: "#047857" };
    }
    if (status === "lost") {
      return { background: "rgba(107,114,128,.14)", borderColor: "rgba(107,114,128,.36)", color: "#374151" };
    }
    return { background: "rgba(234,179,8,.16)", borderColor: "rgba(234,179,8,.46)", color: "#92400e" };
  }

  function leadEventActionLabel(action: string) {
    if (action === "lead_created") return lang === "zh" ? "建立" : "Created";
    if (action === "lead_tour_scheduled") return lang === "zh" ? "安排導覽" : "Tour Scheduled";
    if (action === "lead_converted") return lang === "zh" ? "轉會員" : "Converted";
    if (action === "lead_lost") return lang === "zh" ? "標記失單" : "Marked Lost";
    return lang === "zh" ? "追蹤" : "Follow-up";
  }

  const lockerAutoDueAt = useMemo(
    () => (lockerRentalTerm === "custom" ? null : calcLockerDueAtByTerm(lockerRentalTerm)),
    [lockerRentalTerm],
  );

  return (
    <main ref={sceneRef} className={`fdGlassScene ${capabilityOpen ? "fdSceneBlurred" : ""}`}>
      <section className="fdGlassBackdrop fdEnter">
        {error ? <div className="error">{error}</div> : null}
        {shiftActionError ? <div className="error" style={{ marginTop: error ? 10 : 0 }}>{shiftActionError}</div> : null}

        <div className="fdGlassTop fdGlassTopFixed">
          <article className="fdGlassPanel fdQuickPanel">
            <h2 className="fdGlassTitle fdQuickTitle">{t.quickOpsTitle}</h2>
            <p className="fdGlassText">{t.quickOpsSub}</p>
            <div className="fdPillActions">
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => openCapabilityModal("entry", "entry")}>
                {t.primary}
              </button>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => openCapabilityModal("member", "member")}>
                {t.secondary}
              </button>
            </div>
          </article>

          <article className="fdGlassPanel fdQuickPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.quickServiceTitle}</span>
              <span className="fdChip">{t.capabilityTitle}</span>
            </div>
            <h2 className="fdGlassTitle fdQuickTitle">{t.quickServiceTitle}</h2>
            <p className="fdGlassText">{t.quickServiceSub}</p>
            <div className="fdPillActions">
              <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => openCapabilityShortcut("pos")}>
                {t.quickPosAction}
              </button>
              <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => openCapabilityShortcut("locker")}>
                {t.quickLockerAction}
              </button>
            </div>
          </article>

          <article className="fdGlassPanel fdQuickPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.quickShiftTitle}</span>
              <span className="fdChip">{t.statusOpenValue}</span>
            </div>
            <h2 className="fdGlassTitle fdQuickTitle">{t.quickShiftTitle}</h2>
            <p className="fdGlassText">{t.quickShiftSub}</p>
            <div className="fdQuickInfoGrid">
              <p className="sub" style={{ marginTop: 0 }}>{t.openedAt}: {activeShift?.opened_at ? fmtDateTime(activeShift.opened_at) : "-"}</p>
              <p className="sub" style={{ marginTop: 0 }}>{t.shiftOperator}: {activeShift?.opened_by_name || activeShift?.opened_by || "-"}</p>
            </div>
            <div className="fdPillActions">
              <button
                type="button"
                className="fdPillBtn fdPillBtnGhost"
                onClick={() => {
                  setModalType("handover");
                  setCapabilityOpen(true);
                }}
                disabled={!shiftOpen}
                style={!shiftOpen ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
              >
                {t.handoverAction}
              </button>
            </div>
            {!shiftResolved ? (
              <p className="fdGlassText" style={{ marginTop: 8 }}>{t.loadingState}...</p>
            ) : !shiftOpen ? (
              <div className="field" style={{ marginTop: 8 }}>
                <label className="kvLabel">{t.openingCash}</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                />
                <label className="kvLabel">{t.openingNote}</label>
                <textarea
                  className="input"
                  rows={2}
                  value={openingNote}
                  onChange={(e) => setOpeningNote(e.target.value)}
                  placeholder={t.openingNotePlaceholder}
                />
                <button
                  type="button"
                  className="fdPillBtn fdPillBtnPrimary"
                  onClick={() => void handleOpenShift()}
                  disabled={openingShift}
                  style={openingShift ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
                >
                  {openingShift ? t.startingShiftAction : t.startShiftAction}
                </button>
              </div>
            ) : null}
          </article>
        </div>

        <section className="fdGlassSubPanel fdCapabilityArcWrap" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <h2 className="sectionTitle">{t.capabilityTitle}</h2>
              <p className="fdGlassText" style={{ marginTop: 6 }}>{t.capabilityArcHint}</p>
            </div>
          </div>
          <div
            ref={capabilityRingRef}
            className={`fdCapabilityRingStage ${capabilityRailDragging ? "fdCapabilityRingStageDragging" : ""}`}
            onPointerDown={handleCapabilityRingPointerDown}
            onPointerMove={handleCapabilityRingPointerMove}
            onPointerUp={handleCapabilityRingPointerUp}
            onPointerCancel={handleCapabilityRingPointerUp}
          >
            <div className="fdCapabilityRingTrack">
              {capabilityRingItems.map((item, index) => {
                const angle = item.baseAngle + capabilityRingAngle;
                const rad = (angle * Math.PI) / 180;
                const depth = Math.cos(rad);
                const orbitX = Math.sin(rad) * 430;
                const orbitZ = depth * 300;
                const tiltY = -Math.sin(rad) * 24;
                const tiltX = 10 + (1 - depth) * 6;
                const scale = 0.56 + ((depth + 1) / 2) * 0.52;
                const liftY = 92 - depth * 36;
                const visibility = (depth + 1) / 2;
                const opacity = Math.max(0.22, Math.min(1, 0.18 + visibility * 0.9));
                const zIndex = Math.round((depth + 1) * 1000);
                const ringHue = (index * 31 + 190) % 360;
                return (
                <button
                  key={item.id}
                  type="button"
                  className={`fdGlassSubPanel fdCapabilityCard fdCapabilityRingCard ${selectedCapability?.id === item.id ? "fdCapabilityCardActive" : ""}`}
                  style={{
                    transform: `translate3d(calc(-50% + ${orbitX}px), calc(-50% + ${liftY}px), ${orbitZ}px) rotateY(${tiltY}deg) rotateX(${tiltX}deg) scale(${scale})`,
                    opacity,
                    zIndex,
                    ["--fd-ring-hue" as any]: String(ringHue),
                    ["--fd-ring-depth" as any]: String(visibility),
                  }}
                  onDragStart={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (capabilitySuppressClickRef.current) {
                      event.preventDefault();
                      return;
                    }
                    openCapabilityShortcut(item.id);
                  }}
                >
                  <div className="fdActionHead">
                    <span className="kvLabel">{item.letter}</span>
                    <span className="fdChip" style={statusStyle(item.status)}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <h3 className="fdActionTitle">{item.moduleTitle}</h3>
                  <p className="sub fdCapabilityDesc" style={{ marginTop: 6 }}>{item.desc}</p>
                </button>
                );
              })}
            </div>
          </div>
        </section>

        {capabilityOpen && portalReady ? createPortal((
          <div
            className={`fdModalBackdrop ${isFeatureModal ? "fdModalBackdropFeature" : ""} ${modalType === "handover" ? "fdModalBackdropHandover" : ""}`}
            onClick={() => setCapabilityOpen(false)}
            role="presentation"
          >
            <div
              className={`fdModal ${isFeatureModal ? "fdModalFeature" : ""} ${modalType === "handover" ? "fdModalHandover" : ""} ${modalType === "capability" ? "fdModalCapability" : ""}`}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={modalType === "handover" ? t.handoverModalTitle : t.capabilityModalTitle}
            >
              <div className="fdModalHead">
                <h2 className="sectionTitle" style={{ margin: 0 }}>
                  {modalType === "entry"
                    ? t.entryModalTitle
                    : modalType === "member"
                      ? t.memberModalTitle
                      : modalType === "handover"
                        ? t.handoverModalTitle
                        : t.capabilityModalTitle}
                </h2>
                {modalType === "handover" ? (
                  <button
                    type="button"
                    className="fdModalIconBtn"
                    aria-label={t.close}
                    onClick={() => setCapabilityOpen(false)}
                  >
                    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                ) : (
                  <button type="button" className="fdPillBtn fdPillBtnGhost fdModalCloseBtn" onClick={() => setCapabilityOpen(false)}>
                    {t.close}
                  </button>
                )}
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
                      {selectedCapability.id === "pos" ? (
                        <div className="fdGlassSubPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{t.posModuleTitle}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{t.posModuleSub}</p>
                          {posError ? <div className="error" style={{ marginTop: 8 }}>{posError}</div> : null}
                          {posMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{posMessage}</p> : null}
                          {actionsDisabled ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.openShiftFirst}</p> : null}

                          <div className="fdPillActions" style={{ marginTop: 10 }}>
                            <button
                              type="button"
                              className="fdPillBtn"
                              onClick={() => {
                                setPosLoading(true);
                                setPosError(null);
                                void Promise.all([
                                  loadPosOrders(),
                                  loadPosApprovals(),
                                  loadPosAudit(posOrderId || undefined),
                                  posOrderId ? loadPosPayments(posOrderId) : Promise.resolve([] as PosPaymentItem[]),
                                  posOrderId ? loadPosInvoices(posOrderId) : Promise.resolve(),
                                ])
                                  .catch((err) => setPosError(err instanceof Error ? err.message : t.posReloadAction))
                                  .finally(() => setPosLoading(false));
                              }}
                              disabled={actionsDisabled || posLoading || posCreatingOrder || posPayingOrder || posInitializingCheckout || posSubmittingRisk || posSubmittingInvoice}
                            >
                              {t.posReloadAction}
                            </button>
                            <button type="button" className="fdPillBtn" onClick={handlePosPrintReceipt} disabled={actionsDisabled || !posOrderId}>
                              {t.posPrintReceiptAction}
                            </button>
                            <button type="button" className="fdPillBtn" onClick={() => openCapabilityModal("entry", "entry")} disabled={actionsDisabled}>
                              {t.posOpenEntryAction}
                            </button>
                            <button type="button" className="fdPillBtn" onClick={() => openCapabilityModal("member", "member")} disabled={actionsDisabled}>
                              {t.posOpenMemberAction}
                            </button>
                            <a
                              className="fdPillBtn"
                              href="/frontdesk/bookings"
                              style={actionsDisabled ? { opacity: 0.7, pointerEvents: "none" } : undefined}
                              aria-disabled={actionsDisabled}
                              onClick={(event) => {
                                if (actionsDisabled) event.preventDefault();
                              }}
                            >
                              {t.posOpenBookingAction}
                            </a>
                          </div>

                          <div className="fdInventoryFormGrid" style={{ marginTop: 10 }}>
                            <form onSubmit={handlePosCreateOrder} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posCreateSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posMemberIdOptional}</span>
                                <input
                                  className="input"
                                  value={posMemberId}
                                  onChange={(event) => setPosMemberId(event.target.value)}
                                  placeholder={t.posMemberIdOptional}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posSubtotalLabel}</span>
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={posSubtotal}
                                  onChange={(event) => setPosSubtotal(event.target.value)}
                                  placeholder={t.posSubtotalLabel}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                              </label>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posDiscountLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={posDiscountAmount}
                                    onChange={(event) => setPosDiscountAmount(event.target.value)}
                                    placeholder={t.posDiscountLabel}
                                    disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posAmountLabel}</span>
                                  <div className="input">
                                    {Number.isFinite(Number(posSubtotal) - Number(posDiscountAmount))
                                      ? Math.max(0, Number(posSubtotal) - Number(posDiscountAmount))
                                      : "-"}
                                  </div>
                                </label>
                              </div>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posDiscountNoteLabel}</span>
                                <input
                                  className="input"
                                  value={posDiscountNote}
                                  onChange={(event) => setPosDiscountNote(event.target.value)}
                                  placeholder={t.posDiscountNoteLabel}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                              </label>
                              <label className="fdInventoryField" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={posManagerOverride}
                                  onChange={(event) => setPosManagerOverride(event.target.checked)}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                                <span className="sub" style={{ marginTop: 0 }}>{t.posManagerOverrideLabel}</span>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posNoteLabel}</span>
                                <input
                                  className="input"
                                  value={posNote}
                                  onChange={(event) => setPosNote(event.target.value)}
                                  placeholder={t.posNoteLabel}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}>
                                  {posCreatingOrder ? t.posCreatingAction : t.posCreateAction}
                                </button>
                              </div>
                            </form>

                            <form onSubmit={handlePosPayOrder} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posPaymentSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posCurrentOrder}</span>
                                <div className="input">{posOrderId || t.posNoOrder}</div>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posRemainingLabel}</span>
                                <div className="input">{posOrderId ? posRemaining : "-"}</div>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posPaymentAmountLabel}</span>
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={posPaymentAmount}
                                  onChange={(event) => setPosPaymentAmount(event.target.value)}
                                  placeholder={t.posPaymentAmountLabel}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posPaymentMethodLabel}</span>
                                <select
                                  className="input"
                                  value={posPaymentMethod}
                                  onChange={(event) => setPosPaymentMethod(event.target.value)}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                >
                                  <option value="cash">{t.cash}</option>
                                  <option value="card">{t.card}</option>
                                  <option value="transfer">{t.transfer}</option>
                                  <option value="manual">{t.manual}</option>
                                  <option value="newebpay">{t.newebpay}</option>
                                </select>
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout || !posOrderId}>
                                  {posPayingOrder ? t.posPayingAction : t.posPayAction}
                                </button>
                              </div>
                            </form>

                            <form onSubmit={handlePosInitCheckout} className="fdGlassSubPanel fdInventoryFormBlock" style={{ gridColumn: "1 / -1" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posCheckoutSection}</h5>
                                <button
                                  type="button"
                                  className="fdPillBtn"
                                  onClick={() => {
                                    setPosOrderId("");
                                    setPosCheckoutUrl("");
                                    setPosError(null);
                                    setPosMessage(null);
                                    setPosPayments([]);
                                    setPosInvoices([]);
                                  }}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                >
                                  {t.posClearOrderAction}
                                </button>
                              </div>
                              <p className="sub" style={{ marginTop: 8 }}>{t.posCurrentOrder}: {posOrderId || t.posNoOrder}</p>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout || !posOrderId}>
                                  {posInitializingCheckout ? t.posInitializingCheckoutAction : t.posInitCheckoutAction}
                                </button>
                              </div>
                              {posCheckoutUrl ? (
                                <p className="sub" style={{ marginTop: 8 }}>
                                  {t.posCheckoutUrlLabel}:{" "}
                                  <a href={posCheckoutUrl} target="_blank" rel="noreferrer">{posCheckoutUrl}</a>
                                </p>
                              ) : null}
                            </form>
                          </div>

                          <div className="kvLabel" style={{ marginTop: 10 }}>{t.posPendingTitle}</div>
                          <div className="fdListStack" style={{ marginTop: 8 }}>
                            {unpaidOrderList.slice(0, 4).map((item) => (
                              <div key={item.id} className="card" style={{ padding: 10 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <strong>{item.id.slice(0, 8)}</strong>
                                  <span className="fdChip">{item.status}</span>
                                </div>
                                <p className="sub" style={{ marginTop: 4 }}>NT${item.amount}</p>
                                <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                <button
                                  type="button"
                                  className="fdPillBtn"
                                  style={{ marginTop: 8, display: "inline-flex", opacity: actionsDisabled ? 0.7 : 1 }}
                                  disabled={actionsDisabled || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                  onClick={() => {
                                    void handlePosSelectOrder(item.id, Number(item.amount || 0));
                                  }}
                                >
                                  {t.posUseOrderAction}
                                </button>
                              </div>
                            ))}
                            {!loading && unpaidOrderList.length === 0 ? <p className="fdGlassText">{t.posNoPending}</p> : null}
                          </div>

                          <div className="fdInventoryListGrid" style={{ marginTop: 10 }}>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.posOrdersSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {posOrders.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.id.slice(0, 8)}</strong>
                                      <span className="fdChip">{item.status}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>NT${item.amount}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                    {item.note ? <p className="sub" style={{ marginTop: 4 }}>{item.note}</p> : null}
                                    <button
                                      type="button"
                                      className="fdPillBtn"
                                      style={{ marginTop: 8 }}
                                      onClick={() => void handlePosSelectOrder(item.id, Number(item.amount || 0))}
                                      disabled={actionsDisabled || posLoading || posCreatingOrder || posPayingOrder || posInitializingCheckout}
                                    >
                                      {t.posUseOrderAction}
                                    </button>
                                  </div>
                                ))}
                                {!posLoading && posOrders.length === 0 ? <p className="fdGlassText">{t.posNoOrders}</p> : null}
                              </div>
                            </div>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.posPaymentsSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {posPayments.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.id.slice(0, 8)}</strong>
                                      <span className="fdChip">{item.method}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>NT${item.amount}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.paid_at ? fmtDateTime(item.paid_at) : "-"}</p>
                                    <button
                                      type="button"
                                      className="fdPillBtn"
                                      style={{ marginTop: 8 }}
                                      disabled={actionsDisabled || posSubmittingRisk}
                                      onClick={() => {
                                        setPosRefundPaymentId(item.id);
                                        setPosRefundReason("");
                                      }}
                                    >
                                      {t.posRefundAction}
                                    </button>
                                  </div>
                                ))}
                                {!posLoading && posPayments.length === 0 ? <p className="fdGlassText">{t.posNoPayments}</p> : null}
                              </div>
                            </div>
                          </div>

                          <div className="fdInventoryFormGrid" style={{ marginTop: 10 }}>
                            <form onSubmit={handlePosVoidOrder} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posVoidSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posCurrentOrder}</span>
                                <div className="input">{posOrderId || t.posNoOrder}</div>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posReasonLabel}</span>
                                <input
                                  className="input"
                                  value={posVoidReason}
                                  onChange={(event) => setPosVoidReason(event.target.value)}
                                  placeholder={t.posReasonLabel}
                                  disabled={actionsDisabled || posSubmittingRisk}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posSubmittingRisk || !posOrderId}>
                                  {t.posVoidAction}
                                </button>
                              </div>
                            </form>
                            <form onSubmit={handlePosRefundPayment} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posRefundSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posRefundPaymentIdLabel}</span>
                                <input
                                  className="input"
                                  value={posRefundPaymentId}
                                  onChange={(event) => setPosRefundPaymentId(event.target.value)}
                                  placeholder={t.posRefundPaymentIdLabel}
                                  disabled={actionsDisabled || posSubmittingRisk}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posReasonLabel}</span>
                                <input
                                  className="input"
                                  value={posRefundReason}
                                  onChange={(event) => setPosRefundReason(event.target.value)}
                                  placeholder={t.posReasonLabel}
                                  disabled={actionsDisabled || posSubmittingRisk}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posSubmittingRisk}>
                                  {t.posRefundAction}
                                </button>
                              </div>
                            </form>
                          </div>

                          <div className="fdInventoryFormGrid" style={{ marginTop: 10 }}>
                            <form onSubmit={handlePosIssueInvoice} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posInvoiceSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posCurrentOrder}</span>
                                <div className="input">{posOrderId || t.posNoOrder}</div>
                              </label>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posInvoiceNoLabel}</span>
                                  <input
                                    className="input"
                                    value={posInvoiceNo}
                                    onChange={(event) => setPosInvoiceNo(event.target.value)}
                                    placeholder={t.posInvoiceNoLabel}
                                    disabled={actionsDisabled || posSubmittingInvoice}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posInvoiceTaxIdLabel}</span>
                                  <input
                                    className="input"
                                    value={posInvoiceTaxId}
                                    onChange={(event) => setPosInvoiceTaxId(event.target.value)}
                                    placeholder={t.posInvoiceTaxIdLabel}
                                    disabled={actionsDisabled || posSubmittingInvoice}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posInvoiceCarrierLabel}</span>
                                  <input
                                    className="input"
                                    value={posInvoiceCarrier}
                                    onChange={(event) => setPosInvoiceCarrier(event.target.value)}
                                    placeholder={t.posInvoiceCarrierLabel}
                                    disabled={actionsDisabled || posSubmittingInvoice}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.posInvoiceBuyerLabel}</span>
                                  <input
                                    className="input"
                                    value={posInvoiceBuyerName}
                                    onChange={(event) => setPosInvoiceBuyerName(event.target.value)}
                                    placeholder={t.posInvoiceBuyerLabel}
                                    disabled={actionsDisabled || posSubmittingInvoice}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posSubmittingInvoice || !posOrderId}>
                                  {t.posIssueInvoiceAction}
                                </button>
                              </div>
                            </form>
                            <form onSubmit={handlePosVoidInvoice} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posVoidInvoiceAction}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posInvoiceNoLabel}</span>
                                <input
                                  className="input"
                                  value={posInvoiceNo}
                                  onChange={(event) => setPosInvoiceNo(event.target.value)}
                                  placeholder={t.posInvoiceNoLabel}
                                  disabled={actionsDisabled || posSubmittingInvoice}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posReasonLabel}</span>
                                <input
                                  className="input"
                                  value={posInvoiceReason}
                                  onChange={(event) => setPosInvoiceReason(event.target.value)}
                                  placeholder={t.posReasonLabel}
                                  disabled={actionsDisabled || posSubmittingInvoice}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posSubmittingInvoice || !posOrderId}>
                                  {t.posVoidInvoiceAction}
                                </button>
                              </div>
                            </form>
                            <form onSubmit={handlePosAllowanceInvoice} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.posAllowanceInvoiceAction}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posInvoiceNoLabel}</span>
                                <input
                                  className="input"
                                  value={posInvoiceNo}
                                  onChange={(event) => setPosInvoiceNo(event.target.value)}
                                  placeholder={t.posInvoiceNoLabel}
                                  disabled={actionsDisabled || posSubmittingInvoice}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posAllowanceAmountLabel}</span>
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={posAllowanceAmount}
                                  onChange={(event) => setPosAllowanceAmount(event.target.value)}
                                  placeholder={t.posAllowanceAmountLabel}
                                  disabled={actionsDisabled || posSubmittingInvoice}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.posReasonLabel}</span>
                                <input
                                  className="input"
                                  value={posInvoiceReason}
                                  onChange={(event) => setPosInvoiceReason(event.target.value)}
                                  placeholder={t.posReasonLabel}
                                  disabled={actionsDisabled || posSubmittingInvoice}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={actionsDisabled || posSubmittingInvoice || !posOrderId}>
                                  {t.posAllowanceInvoiceAction}
                                </button>
                              </div>
                            </form>
                          </div>

                          <div className="fdInventoryListGrid" style={{ marginTop: 10 }}>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.posApprovalsSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {posApprovals.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{posRiskActionLabel(item.action)}</strong>
                                      <span className="fdChip" style={posApprovalStatusStyle(item.status)}>{posApprovalStatusLabel(item.status)}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.target_type}:{item.target_id}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.reason}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                  </div>
                                ))}
                                {!posLoading && posApprovals.length === 0 ? <p className="fdGlassText">{t.posNoApprovals}</p> : null}
                              </div>
                            </div>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.posInvoiceSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {posInvoices.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.payload?.invoiceNo || "-"}</strong>
                                      <span className="fdChip">{item.action}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.reason || "-"}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                  </div>
                                ))}
                                {!posLoading && posInvoices.length === 0 ? <p className="fdGlassText">{t.posNoInvoices}</p> : null}
                              </div>
                            </div>
                          </div>

                          <div className="fdGlassSubPanel" style={{ marginTop: 10, padding: 10 }}>
                            <div className="kvLabel">{t.posAuditSection}</div>
                            <div className="fdListStack" style={{ marginTop: 8 }}>
                              {posAudit.map((item) => (
                                <div key={item.id} className="card" style={{ padding: 10 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                    <strong>{item.action}</strong>
                                    <span className="fdChip">{item.target_type}</span>
                                  </div>
                                  <p className="sub" style={{ marginTop: 4 }}>{item.target_id || "-"}</p>
                                  <p className="sub" style={{ marginTop: 4 }}>{item.reason || "-"}</p>
                                  <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                </div>
                              ))}
                              {!posLoading && posAudit.length === 0 ? <p className="fdGlassText">{t.posNoAudit}</p> : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "locker" ? (
                        <div className="fdGlassSubPanel fdLockerPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{t.lockerTitle}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{t.lockerSub}</p>
                          {lockerError ? <div className="error" style={{ marginTop: 8 }}>{lockerError}</div> : null}
                          {lockerMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{lockerMessage}</p> : null}

                          <div className="fdLockerSummary">
                            <div className="fdGlassSubPanel fdLockerSummaryItem">
                              <div className="kvLabel">{t.lockerDepositHeld}</div>
                              <strong className="fdLockerSummaryValue">NT${lockerHeldDepositTotal}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdLockerSummaryItem">
                              <div className="kvLabel">{t.lockerDepositReturned}</div>
                              <strong className="fdLockerSummaryValue">NT${lockerReturnedDepositTotal}</strong>
                            </div>
                          </div>

                          <form onSubmit={handleCreateLockerRental} className="fdLockerForm">
                            <div className="fdLockerGrid2">
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerCodeLabel}</span>
                                <input
                                  className="input"
                                  value={lockerCode}
                                  onChange={(event) => setLockerCode(event.target.value)}
                                  placeholder={t.lockerCodeLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerMemberIdLabel}</span>
                                <input
                                  className="input"
                                  value={lockerMemberId}
                                  onChange={(event) => setLockerMemberId(event.target.value)}
                                  placeholder={t.lockerMemberIdLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                            </div>
                            <div className="fdLockerGrid2">
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerRenterLabel}</span>
                                <input
                                  className="input"
                                  value={lockerRenterName}
                                  onChange={(event) => setLockerRenterName(event.target.value)}
                                  placeholder={t.lockerRenterLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerPhoneLabel}</span>
                                <input
                                  className="input"
                                  value={lockerPhone}
                                  onChange={(event) => setLockerPhone(event.target.value)}
                                  placeholder={t.lockerPhoneLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                            </div>
                            <div className="fdLockerGrid2">
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerDepositLabel}</span>
                                <input
                                  className="input"
                                  inputMode="decimal"
                                  value={lockerDeposit}
                                  onChange={(event) => setLockerDeposit(event.target.value)}
                                  placeholder={t.lockerDepositLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerRentalTermLabel}</span>
                                <select
                                  className="input"
                                  value={lockerRentalTerm}
                                  onChange={(event) => setLockerRentalTerm(event.target.value as LockerRentalTerm)}
                                  aria-label={t.lockerRentalTermLabel}
                                  disabled={lockerSubmitting}
                                >
                                  <option value="daily">{t.lockerTermDaily}</option>
                                  <option value="monthly">{t.lockerTermMonthly}</option>
                                  <option value="half_year">{t.lockerTermHalfYear}</option>
                                  <option value="yearly">{t.lockerTermYearly}</option>
                                  <option value="custom">{t.lockerTermCustom}</option>
                                </select>
                              </label>
                            </div>
                            {lockerRentalTerm === "custom" ? (
                              <label className="fdLockerField">
                                <span className="kvLabel">{t.lockerDueAtLabel}</span>
                                <input
                                  className="input"
                                  type="datetime-local"
                                  value={lockerDueAt}
                                  onChange={(event) => setLockerDueAt(event.target.value)}
                                  aria-label={t.lockerDueAtLabel}
                                  disabled={lockerSubmitting}
                                />
                              </label>
                            ) : lockerAutoDueAt ? (
                              <p className="sub fdLockerDueHint">
                                {t.lockerDueAutoHint} {fmtDateTime(lockerAutoDueAt)}
                              </p>
                            ) : null}
                            <label className="fdLockerField">
                              <span className="kvLabel">{t.lockerNoteLabel}</span>
                              <textarea
                                className="input fdLockerNote"
                                rows={2}
                                value={lockerNote}
                                onChange={(event) => setLockerNote(event.target.value)}
                                placeholder={t.lockerNoteLabel}
                                disabled={lockerSubmitting}
                              />
                            </label>
                            <div className="fdLockerActions">
                              <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={lockerSubmitting}>
                                {lockerSubmitting ? t.lockerRentingAction : t.lockerRentAction}
                              </button>
                              <button type="button" className="fdPillBtn" onClick={() => void loadLockerRentals()} disabled={lockerLoading || lockerSubmitting}>
                                {t.lockerReload}
                              </button>
                            </div>
                          </form>

                          <div className="fdLockerListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.lockerActiveList}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {lockerActiveItems.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                      <strong>{item.lockerCode}</strong>
                                      <span className="fdChip">{t.lockerStatusActive}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {item.renterName || item.phone || (item.memberCode ? `#${item.memberCode}` : item.memberId) || "-"}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerDepositTag}: NT${item.depositAmount}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerTermTag}: {lockerTermLabel(item.rentalTerm)}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {fmtDateTime(item.rentedAt)}
                                      {item.dueAt ? ` | ${fmtDateTime(item.dueAt)}` : ""}
                                    </p>
                                    <button
                                      type="button"
                                      className="fdPillBtn"
                                      style={{ marginTop: 8 }}
                                      onClick={() => void handleReturnLockerRental(item.id)}
                                      disabled={lockerSubmitting}
                                    >
                                      {lockerSubmitting ? t.lockerReturningAction : t.lockerReturnAction}
                                    </button>
                                  </div>
                                ))}
                                {!lockerLoading && lockerActiveItems.length === 0 ? <p className="fdGlassText">{t.lockerNoneActive}</p> : null}
                              </div>
                            </div>

                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.lockerRecentList}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {lockerRecentReturnedItems.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                                      <strong>{item.lockerCode}</strong>
                                      <span className="fdChip">{t.lockerStatusReturned}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {item.renterName || item.phone || (item.memberCode ? `#${item.memberCode}` : item.memberId) || "-"}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerDepositTag}: NT${item.depositAmount}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerTermTag}: {lockerTermLabel(item.rentalTerm)}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerRentedAt}: {fmtDateTime(item.rentedAt)}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.lockerReturnedAt}: {item.returnedAt ? fmtDateTime(item.returnedAt) : "-"}
                                    </p>
                                  </div>
                                ))}
                                {!lockerLoading && lockerRecentReturnedItems.length === 0 ? <p className="fdGlassText">{t.lockerNoneRecent}</p> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "inventory" ? (
                        <div className="fdGlassSubPanel fdInventoryPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{t.inventoryTitle}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{t.inventorySub}</p>
                          {inventoryError ? <div className="error" style={{ marginTop: 8 }}>{inventoryError}</div> : null}
                          {inventoryMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{inventoryMessage}</p> : null}

                          <div className="fdInventorySummary">
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.inventorySummarySkus}</div>
                              <strong className="fdInventorySummaryValue">{inventorySkuCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.inventorySummaryLow}</div>
                              <strong className="fdInventorySummaryValue">{inventoryLowStockCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.inventorySummaryOnHand}</div>
                              <strong className="fdInventorySummaryValue">{inventoryTotalOnHand}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.inventorySummarySold}</div>
                              <strong className="fdInventorySummaryValue">{inventorySoldToday}</strong>
                            </div>
                          </div>

                          <div className="fdInventoryFormGrid">
                            <form onSubmit={handleInventoryCreateProduct} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.inventoryCreateSection}</h5>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateCodeLabel}</span>
                                  <input
                                    className="input"
                                    value={createProductCode}
                                    onChange={(event) => setCreateProductCode(event.target.value)}
                                    placeholder={t.inventoryCreateCodeLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateTitleLabel}</span>
                                  <input
                                    className="input"
                                    value={createProductTitle}
                                    onChange={(event) => setCreateProductTitle(event.target.value)}
                                    placeholder={t.inventoryCreateTitleLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateUnitPriceLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    value={createProductUnitPrice}
                                    onChange={(event) => setCreateProductUnitPrice(event.target.value)}
                                    placeholder={t.inventoryCreateUnitPriceLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateOnHandLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="numeric"
                                    value={createProductOnHand}
                                    onChange={(event) => setCreateProductOnHand(event.target.value)}
                                    placeholder={t.inventoryCreateOnHandLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateSafetyStockLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="numeric"
                                    value={createProductSafetyStock}
                                    onChange={(event) => setCreateProductSafetyStock(event.target.value)}
                                    placeholder={t.inventoryCreateSafetyStockLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryCreateSortOrderLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="numeric"
                                    value={createProductSortOrder}
                                    onChange={(event) => setCreateProductSortOrder(event.target.value)}
                                    placeholder={t.inventoryCreateSortOrderLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={inventorySubmitting}>
                                  {inventorySubmitting ? t.inventoryCreatingAction : t.inventoryCreateAction}
                                </button>
                              </div>
                            </form>

                            <form onSubmit={handleInventorySale} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.inventorySalesSection}</h5>
                              <div className="fdInventoryField">
                                <span className="kvLabel">{t.inventoryProductLabel}</span>
                                <select
                                  className="input"
                                  value={saleProductCode}
                                  onChange={(event) => setSaleProductCode(event.target.value)}
                                  disabled={inventorySubmitting}
                                >
                                  {inventoryItems.map((item) => (
                                    <option key={item.code} value={item.code}>
                                      {item.title} ({item.code}) | NT${item.unitPrice} | {t.inventoryOnHandTag}:{item.onHand}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryQtyLabel}</span>
                                  <input
                                    className="input"
                                    inputMode="numeric"
                                    value={saleQty}
                                    onChange={(event) => setSaleQty(event.target.value)}
                                    placeholder={t.inventoryQtyLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryMemberCodeLabel}</span>
                                  <input
                                    className="input"
                                    value={saleMemberCode}
                                    onChange={(event) => setSaleMemberCode(event.target.value)}
                                    placeholder={t.inventoryMemberCodeLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryPaymentMethodLabel}</span>
                                  <select
                                    className="input"
                                    value={salePaymentMethod}
                                    onChange={(event) => setSalePaymentMethod(event.target.value)}
                                    disabled={inventorySubmitting}
                                  >
                                    <option value="cash">{t.cash}</option>
                                    <option value="card">{t.card}</option>
                                    <option value="transfer">{t.transfer}</option>
                                    <option value="manual">{t.manual}</option>
                                    <option value="newebpay">{t.newebpay}</option>
                                  </select>
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.inventoryNoteLabel}</span>
                                  <input
                                    className="input"
                                    value={saleNote}
                                    onChange={(event) => setSaleNote(event.target.value)}
                                    placeholder={t.inventoryNoteLabel}
                                    disabled={inventorySubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={inventorySubmitting || inventoryItems.length === 0}>
                                  {inventorySubmitting ? t.inventorySellingAction : t.inventorySaleAction}
                                </button>
                                <button type="button" className="fdPillBtn" onClick={() => void loadInventoryModule()} disabled={inventoryLoading || inventorySubmitting}>
                                  {t.inventoryReloadAction}
                                </button>
                              </div>
                            </form>

                            <form onSubmit={handleInventoryAdjust} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.inventoryAdjustSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.inventoryProductLabel}</span>
                                <select
                                  className="input"
                                  value={adjustProductCode}
                                  onChange={(event) => setAdjustProductCode(event.target.value)}
                                  disabled={inventorySubmitting}
                                >
                                  {inventoryItems.map((item) => (
                                    <option key={item.code} value={item.code}>
                                      {item.title} ({item.code}) | {t.inventoryOnHandTag}:{item.onHand}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.inventoryAdjustDeltaLabel}</span>
                                <input
                                  className="input"
                                  value={adjustDelta}
                                  onChange={(event) => setAdjustDelta(event.target.value)}
                                  placeholder={t.inventoryAdjustDeltaLabel}
                                  disabled={inventorySubmitting}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.inventoryNoteLabel}</span>
                                <input
                                  className="input"
                                  value={adjustNote}
                                  onChange={(event) => setAdjustNote(event.target.value)}
                                  placeholder={t.inventoryNoteLabel}
                                  disabled={inventorySubmitting}
                                />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={inventorySubmitting || inventoryItems.length === 0}>
                                  {inventorySubmitting ? t.inventoryAdjustingAction : t.inventoryAdjustAction}
                                </button>
                              </div>
                            </form>
                          </div>

                          <div className="fdInventoryListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.inventoryProductsList}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {inventoryItems.map((item) => (
                                  <div key={item.code} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.title}</strong>
                                      <span className="fdChip">{item.code}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>NT${item.unitPrice}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{t.inventoryOnHandTag}: {item.onHand}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {item.isLowStock ? t.inventoryLowTag : "-"}
                                    </p>
                                    <div className="fdInventoryCardActions">
                                      <button type="button" className="fdPillBtn" onClick={() => {
                                        setSaleProductCode(item.code);
                                        setAdjustProductCode(item.code);
                                      }}>
                                        {t.inventoryProductLabel}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                {!inventoryLoading && inventoryItems.length === 0 ? <p className="fdGlassText">{t.inventoryNoProducts}</p> : null}
                              </div>
                            </div>

                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.inventoryMovesList}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {inventoryMoves.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.productCode}</strong>
                                      <span className="fdChip">{inventoryMoveReasonLabel(item.reason)}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {item.delta > 0 ? `+${item.delta}` : item.delta}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.createdAt)}</p>
                                    {item.note ? <p className="sub" style={{ marginTop: 4 }}>{item.note}</p> : null}
                                  </div>
                                ))}
                                {!inventoryLoading && inventoryMoves.length === 0 ? <p className="fdGlassText">{t.inventoryNoMoves}</p> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "cs" ? (
                        <div className="fdGlassSubPanel fdInventoryPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{t.csTitle}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{t.csSub}</p>
                          {csError ? <div className="error" style={{ marginTop: 8 }}>{csError}</div> : null}
                          {csMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{csMessage}</p> : null}

                          <div className="fdInventorySummary">
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.csSummaryOpen}</div>
                              <strong className="fdInventorySummaryValue">{csOpenCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.csSummaryInProgress}</div>
                              <strong className="fdInventorySummaryValue">{csInProgressCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.csSummaryResolved}</div>
                              <strong className="fdInventorySummaryValue">{csResolvedCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{t.csSummaryOverdue}</div>
                              <strong className="fdInventorySummaryValue">{csOverdueCount}</strong>
                            </div>
                          </div>

                          <div className="fdInventoryFormGrid">
                            <form onSubmit={handleCsCreateIncident} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.csCreateSection}</h5>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csIncidentTypeLabel}</span>
                                  <select
                                    className="input"
                                    value={csIncidentType}
                                    onChange={(event) => setCsIncidentType(event.target.value)}
                                    disabled={csSubmitting}
                                  >
                                    <option value="complaint">{t.csTypeComplaint}</option>
                                    <option value="facility">{t.csTypeFacility}</option>
                                    <option value="safety">{t.csTypeSafety}</option>
                                    <option value="billing">{t.csTypeBilling}</option>
                                    <option value="member">{t.csTypeMember}</option>
                                    <option value="other">{t.csTypeOther}</option>
                                  </select>
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csPriorityLabel}</span>
                                  <select
                                    className="input"
                                    value={csPriority}
                                    onChange={(event) => setCsPriority(event.target.value)}
                                    disabled={csSubmitting}
                                  >
                                    <option value="low">{t.csPriorityLow}</option>
                                    <option value="normal">{t.csPriorityNormal}</option>
                                    <option value="high">{t.csPriorityHigh}</option>
                                    <option value="urgent">{t.csPriorityUrgent}</option>
                                  </select>
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csSourceLabel}</span>
                                  <select
                                    className="input"
                                    value={csSource}
                                    onChange={(event) => setCsSource(event.target.value)}
                                    disabled={csSubmitting}
                                  >
                                    <option value="frontdesk">{t.csSourceFrontdesk}</option>
                                    <option value="phone">{t.csSourcePhone}</option>
                                    <option value="line">{t.csSourceLine}</option>
                                    <option value="email">{t.csSourceEmail}</option>
                                    <option value="walkin">{t.csSourceWalkin}</option>
                                    <option value="other">{t.csSourceOther}</option>
                                  </select>
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csMemberCodeLabel}</span>
                                  <input
                                    className="input"
                                    value={csMemberCode}
                                    onChange={(event) => setCsMemberCode(event.target.value)}
                                    placeholder={t.csMemberCodeLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csMemberNameLabel}</span>
                                  <input
                                    className="input"
                                    value={csMemberName}
                                    onChange={(event) => setCsMemberName(event.target.value)}
                                    placeholder={t.csMemberNameLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csContactPhoneLabel}</span>
                                  <input
                                    className="input"
                                    value={csContactPhone}
                                    onChange={(event) => setCsContactPhone(event.target.value)}
                                    placeholder={t.csContactPhoneLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                              </div>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.csCaseTitleLabel}</span>
                                <input
                                  className="input"
                                  value={csCaseTitle}
                                  onChange={(event) => setCsCaseTitle(event.target.value)}
                                  placeholder={t.csCaseTitleLabel}
                                  disabled={csSubmitting}
                                />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{t.csCaseDetailLabel}</span>
                                <textarea
                                  className="input"
                                  rows={3}
                                  value={csCaseDetail}
                                  onChange={(event) => setCsCaseDetail(event.target.value)}
                                  placeholder={t.csCaseDetailLabel}
                                  disabled={csSubmitting}
                                />
                              </label>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csHappenedAtLabel}</span>
                                  <input
                                    className="input"
                                    type="datetime-local"
                                    value={csHappenedAt}
                                    onChange={(event) => setCsHappenedAt(event.target.value)}
                                    aria-label={t.csHappenedAtLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csDueAtLabel}</span>
                                  <input
                                    className="input"
                                    type="datetime-local"
                                    value={csDueAt}
                                    onChange={(event) => setCsDueAt(event.target.value)}
                                    aria-label={t.csDueAtLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                              </div>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={csSubmitting}>
                                  {csSubmitting ? t.csCreatingAction : t.csCreateAction}
                                </button>
                                <button type="button" className="fdPillBtn" onClick={() => void loadCsModule()} disabled={csLoading || csSubmitting}>
                                  {t.csReloadAction}
                                </button>
                              </div>
                            </form>

                            <div className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{t.csOperateSection}</h5>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csFilterStatusLabel}</span>
                                  <select
                                    className="input"
                                    value={csFilterStatus}
                                    onChange={(event) => setCsFilterStatus(event.target.value as "all" | "open" | "in_progress" | "resolved" | "closed")}
                                    disabled={csSubmitting}
                                  >
                                    <option value="all">{t.csStatusAll}</option>
                                    <option value="open">{t.csStatusOpen}</option>
                                    <option value="in_progress">{t.csStatusInProgress}</option>
                                    <option value="resolved">{t.csStatusResolved}</option>
                                    <option value="closed">{t.csStatusClosed}</option>
                                  </select>
                                </label>
                                <div className="fdInventoryActions" style={{ justifyContent: "flex-start", alignItems: "end" }}>
                                  <button type="button" className="fdPillBtn" onClick={() => void loadCsModule()} disabled={csLoading || csSubmitting}>
                                    {t.csReloadAction}
                                  </button>
                                </div>
                              </div>

                              <form onSubmit={handleCsUpdateStatus}>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csSelectIncidentLabel}</span>
                                  <select
                                    className="input"
                                    value={csSelectedIncidentId}
                                    onChange={(event) => setCsSelectedIncidentId(event.target.value)}
                                    disabled={csSubmitting}
                                  >
                                    {csIncidents.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.incidentNo} | {item.title}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="fdInventoryGrid2">
                                  <label className="fdInventoryField">
                                    <span className="kvLabel">{t.csStatusToLabel}</span>
                                    <select
                                      className="input"
                                      value={csStatusTo}
                                      onChange={(event) => setCsStatusTo(event.target.value as "open" | "in_progress" | "resolved" | "closed")}
                                      disabled={csSubmitting}
                                    >
                                      <option value="open">{t.csStatusOpen}</option>
                                      <option value="in_progress">{t.csStatusInProgress}</option>
                                      <option value="resolved">{t.csStatusResolved}</option>
                                      <option value="closed">{t.csStatusClosed}</option>
                                    </select>
                                  </label>
                                  <label className="fdInventoryField">
                                    <span className="kvLabel">{t.csStatusNoteLabel}</span>
                                    <input
                                      className="input"
                                      value={csStatusNote}
                                      onChange={(event) => setCsStatusNote(event.target.value)}
                                      placeholder={t.csStatusNoteLabel}
                                      disabled={csSubmitting}
                                    />
                                  </label>
                                </div>
                                <div className="fdInventoryActions">
                                  <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={csSubmitting || csIncidents.length === 0}>
                                    {csSubmitting ? t.csActioning : t.csUpdateStatusAction}
                                  </button>
                                </div>
                              </form>

                              <form onSubmit={handleCsAddFollowup} style={{ marginTop: 10 }}>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csFollowupNoteLabel}</span>
                                  <textarea
                                    className="input"
                                    rows={2}
                                    value={csFollowupNote}
                                    onChange={(event) => setCsFollowupNote(event.target.value)}
                                    placeholder={t.csFollowupNoteLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                                <div className="fdInventoryActions">
                                  <button type="submit" className="fdPillBtn" disabled={csSubmitting || csIncidents.length === 0}>
                                    {csSubmitting ? t.csActioning : t.csAddFollowupAction}
                                  </button>
                                </div>
                              </form>

                              <form onSubmit={handleCsResolve} style={{ marginTop: 10 }}>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{t.csResolveNoteLabel}</span>
                                  <textarea
                                    className="input"
                                    rows={2}
                                    value={csResolveNote}
                                    onChange={(event) => setCsResolveNote(event.target.value)}
                                    placeholder={t.csResolveNoteLabel}
                                    disabled={csSubmitting}
                                  />
                                </label>
                                <div className="fdInventoryActions">
                                  <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={csSubmitting || csIncidents.length === 0}>
                                    {csSubmitting ? t.csActioning : t.csResolveAction}
                                  </button>
                                </div>
                              </form>
                            </div>
                          </div>

                          <div className="fdInventoryListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.csListSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {csIncidents.map((item) => (
                                  <div
                                    key={item.id}
                                    className="card"
                                    style={{
                                      padding: 10,
                                      borderColor: csSelectedIncidentId === item.id ? "rgba(34,184,166,.45)" : undefined,
                                    }}
                                  >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.incidentNo}</strong>
                                      <span className="fdChip" style={csStatusStyle(item.status)}>{csStatusLabel(item.status)}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.title}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {csTypeLabel(item.incidentType)} | {csPriorityLabel(item.priority)} | {csSourceLabel(item.source)}
                                    </p>
                                    {(item.memberCode || item.memberName || item.contactPhone) ? (
                                      <p className="sub" style={{ marginTop: 4 }}>
                                        {item.memberCode ? `#${item.memberCode}` : "-"}
                                        {item.memberName ? ` | ${item.memberName}` : ""}
                                        {item.contactPhone ? ` | ${item.contactPhone}` : ""}
                                      </p>
                                    ) : null}
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.csCreatedAt}: {fmtDateTime(item.createdAt)}
                                    </p>
                                    <p className="sub" style={{ marginTop: 4 }}>
                                      {t.csUpdatedAt}: {fmtDateTime(item.updatedAt)}
                                    </p>
                                    {item.dueAt ? (
                                      <p className="sub" style={{ marginTop: 4 }}>
                                        {t.csDueAt}: {fmtDateTime(item.dueAt)}
                                      </p>
                                    ) : null}
                                    <p className="sub" style={{ marginTop: 4 }}>{item.detail}</p>
                                    {item.resolutionNote ? (
                                      <p className="sub" style={{ marginTop: 4 }}>
                                        {t.csResolutionTag}: {item.resolutionNote}
                                      </p>
                                    ) : null}
                                    <div className="fdInventoryCardActions">
                                      <button
                                        type="button"
                                        className="fdPillBtn"
                                        onClick={() => {
                                          const status = item.status === "open" || item.status === "in_progress" || item.status === "resolved" || item.status === "closed"
                                            ? item.status
                                            : "in_progress";
                                          setCsSelectedIncidentId(item.id);
                                          setCsStatusTo(status);
                                        }}
                                      >
                                        {t.csUseIncidentAction}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                {!csLoading && csIncidents.length === 0 ? <p className="fdGlassText">{t.csNoIncidents}</p> : null}
                              </div>
                            </div>

                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{t.csEventsSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {(csSelectedIncident?.events || []).map((eventItem) => (
                                  <div key={eventItem.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{csEventActionLabel(eventItem.action)}</strong>
                                      <span className="fdChip">{eventItem.actorName || "-"}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(eventItem.createdAt)}</p>
                                    {eventItem.note ? <p className="sub" style={{ marginTop: 4 }}>{eventItem.note}</p> : null}
                                  </div>
                                ))}
                                {!csLoading && (csSelectedIncident?.events || []).length === 0 ? <p className="fdGlassText">{t.csNoEvents}</p> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "lead" ? (
                        <div className="fdGlassSubPanel fdInventoryPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{leadUi.title}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{leadUi.sub}</p>
                          {leadError ? <div className="error" style={{ marginTop: 8 }}>{leadError}</div> : null}
                          {leadMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{leadMessage}</p> : null}

                          <div className="fdInventorySummary">
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{leadUi.summaryNew}</div><strong className="fdInventorySummaryValue">{leadNewCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{leadUi.summaryTour}</div><strong className="fdInventorySummaryValue">{leadTourCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{leadUi.summaryConverted}</div><strong className="fdInventorySummaryValue">{leadConvertedCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{leadUi.summaryLost}</div><strong className="fdInventorySummaryValue">{leadLostCount}</strong></div>
                          </div>

                          <div className="fdInventoryFormGrid">
                            <form onSubmit={handleLeadCreate} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{leadUi.createSection}</h5>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField"><span className="kvLabel">{leadUi.nameLabel}</span><input className="input" value={leadName} onChange={(event) => setLeadName(event.target.value)} disabled={leadSubmitting} /></label>
                                <label className="fdInventoryField"><span className="kvLabel">{leadUi.phoneLabel}</span><input className="input" value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} disabled={leadSubmitting} /></label>
                              </div>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{leadUi.sourceLabel}</span>
                                  <select className="input" value={leadSource} onChange={(event) => setLeadSource(event.target.value)} disabled={leadSubmitting}>
                                    <option value="walkin">{lang === "zh" ? "現場" : "Walk-in"}</option>
                                    <option value="phone">{lang === "zh" ? "電話" : "Phone"}</option>
                                    <option value="line">LINE</option>
                                    <option value="ad">{lang === "zh" ? "廣告" : "Ads"}</option>
                                    <option value="referral">{lang === "zh" ? "介紹" : "Referral"}</option>
                                  </select>
                                </label>
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{leadUi.interestLabel}</span>
                                  <select className="input" value={leadInterest} onChange={(event) => setLeadInterest(event.target.value)} disabled={leadSubmitting}>
                                    <option value="membership">{lang === "zh" ? "會籍" : "Membership"}</option>
                                    <option value="pt">{lang === "zh" ? "教練課" : "PT"}</option>
                                    <option value="group_class">{lang === "zh" ? "團課" : "Group Class"}</option>
                                    <option value="other">{lang === "zh" ? "其他" : "Other"}</option>
                                  </select>
                                </label>
                              </div>
                              <label className="fdInventoryField"><span className="kvLabel">{leadUi.noteLabel}</span><textarea className="input" rows={2} value={leadCreateNote} onChange={(event) => setLeadCreateNote(event.target.value)} disabled={leadSubmitting} /></label>
                              <label className="fdInventoryField"><span className="kvLabel">{leadUi.tourAtLabel}</span><input className="input" type="datetime-local" value={leadCreateTourAt} onChange={(event) => setLeadCreateTourAt(event.target.value)} disabled={leadSubmitting} /></label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={leadSubmitting}>{leadSubmitting ? leadUi.creating : leadUi.createAction}</button>
                                <button type="button" className="fdPillBtn" onClick={() => void loadLeadModule()} disabled={leadLoading || leadSubmitting}>{leadUi.reload}</button>
                              </div>
                            </form>

                            <div className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{leadUi.actionSection}</h5>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField">
                                  <span className="kvLabel">{leadUi.statusFilter}</span>
                                  <select className="input" value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value as "all" | LeadStatus)} disabled={leadSubmitting}>
                                    <option value="all">{lang === "zh" ? "全部" : "All"}</option>
                                    <option value="new">{leadStatusLabel("new")}</option>
                                    <option value="tour_scheduled">{leadStatusLabel("tour_scheduled")}</option>
                                    <option value="converted">{leadStatusLabel("converted")}</option>
                                    <option value="lost">{leadStatusLabel("lost")}</option>
                                  </select>
                                </label>
                                <div className="fdInventoryActions" style={{ justifyContent: "flex-start", alignItems: "end" }}>
                                  <button type="button" className="fdPillBtn" onClick={() => void loadLeadModule()} disabled={leadLoading || leadSubmitting}>{leadUi.reload}</button>
                                </div>
                              </div>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{leadUi.selectLead}</span>
                                <select className="input" value={leadSelectedId} onChange={(event) => setLeadSelectedId(event.target.value)} disabled={leadSubmitting}>
                                  {leadItems.map((item) => (<option key={item.id} value={item.id}>{item.name} | {leadStatusLabel(item.status)}</option>))}
                                </select>
                              </label>

                              <form onSubmit={handleLeadScheduleTour}>
                                <h6 className="kvLabel">{leadUi.scheduleTitle}</h6>
                                <div className="fdInventoryGrid2">
                                  <label className="fdInventoryField"><input className="input" type="datetime-local" value={leadScheduleTourAt} onChange={(event) => setLeadScheduleTourAt(event.target.value)} disabled={leadSubmitting} /></label>
                                  <label className="fdInventoryField"><input className="input" value={leadScheduleNote} onChange={(event) => setLeadScheduleNote(event.target.value)} placeholder={leadUi.noteLabel} disabled={leadSubmitting} /></label>
                                </div>
                                <div className="fdInventoryActions"><button type="submit" className="fdPillBtn" disabled={leadSubmitting || leadItems.length === 0}>{leadUi.scheduleAction}</button></div>
                              </form>

                              <form onSubmit={handleLeadFollowup} style={{ marginTop: 10 }}>
                                <h6 className="kvLabel">{leadUi.followupTitle}</h6>
                                <label className="fdInventoryField"><textarea className="input" rows={2} value={leadFollowupNote} onChange={(event) => setLeadFollowupNote(event.target.value)} disabled={leadSubmitting} /></label>
                                <div className="fdInventoryActions"><button type="submit" className="fdPillBtn" disabled={leadSubmitting || leadItems.length === 0}>{leadUi.followupAction}</button></div>
                              </form>

                              <form onSubmit={handleLeadConvert} style={{ marginTop: 10 }}>
                                <h6 className="kvLabel">{leadUi.convertTitle}</h6>
                                <label className="fdInventoryField"><input className="input" value={leadConvertMemberId} onChange={(event) => setLeadConvertMemberId(event.target.value)} placeholder={t.posMemberIdOptional} disabled={leadSubmitting} /></label>
                                <label className="fdInventoryField"><input className="input" value={leadConvertNote} onChange={(event) => setLeadConvertNote(event.target.value)} placeholder={leadUi.noteLabel} disabled={leadSubmitting} /></label>
                                <p className="sub">{leadUi.convertHint}</p>
                                <div className="fdInventoryActions"><button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={leadSubmitting || leadItems.length === 0}>{leadUi.convertAction}</button></div>
                              </form>

                              <form onSubmit={handleLeadMarkLost} style={{ marginTop: 10 }}>
                                <h6 className="kvLabel">{leadUi.lostTitle}</h6>
                                <div className="fdInventoryGrid2">
                                  <label className="fdInventoryField"><input className="input" value={leadLostReason} onChange={(event) => setLeadLostReason(event.target.value)} placeholder={leadUi.reasonLabel} disabled={leadSubmitting} /></label>
                                  <label className="fdInventoryField"><input className="input" value={leadLostNote} onChange={(event) => setLeadLostNote(event.target.value)} placeholder={leadUi.noteLabel} disabled={leadSubmitting} /></label>
                                </div>
                                <div className="fdInventoryActions"><button type="submit" className="fdPillBtn" disabled={leadSubmitting || leadItems.length === 0}>{leadUi.lostAction}</button></div>
                              </form>
                            </div>
                          </div>

                          <div className="fdInventoryListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{leadUi.listSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {leadItems.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10, borderColor: leadSelectedId === item.id ? "rgba(34,184,166,.45)" : undefined }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.name}</strong>
                                      <span className="fdChip" style={leadStatusStyle(item.status)}>{leadStatusLabel(item.status)}</span>
                                    </div>
                                    {item.phone ? <p className="sub" style={{ marginTop: 4 }}>{item.phone}</p> : null}
                                    <p className="sub" style={{ marginTop: 4 }}>{item.source || "-"} | {item.interest || "-"}</p>
                                    {item.tourAt ? <p className="sub" style={{ marginTop: 4 }}>Tour: {fmtDateTime(item.tourAt)}</p> : null}
                                    <p className="sub" style={{ marginTop: 4 }}>{leadUi.updatedAt}: {fmtDateTime(item.updatedAt)}</p>
                                    <div className="fdInventoryCardActions"><button type="button" className="fdPillBtn" onClick={() => setLeadSelectedId(item.id)}>{leadUi.useLead}</button></div>
                                  </div>
                                ))}
                                {!leadLoading && leadItems.length === 0 ? <p className="fdGlassText">{leadUi.noItems}</p> : null}
                              </div>
                            </div>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{leadUi.timelineSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {(selectedLead?.events || []).map((eventItem) => (
                                  <div key={eventItem.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{leadEventActionLabel(eventItem.action)}</strong>
                                      <span className="fdChip">{fmtDateTime(eventItem.createdAt)}</span>
                                    </div>
                                    {eventItem.reason ? <p className="sub" style={{ marginTop: 4 }}>{eventItem.reason}</p> : null}
                                  </div>
                                ))}
                                {!leadLoading && (selectedLead?.events || []).length === 0 ? <p className="fdGlassText">{leadUi.noEvents}</p> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "chain" ? (
                        <div className="fdGlassSubPanel fdInventoryPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{chainUi.title}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{chainUi.sub}</p>
                          {chainError ? <div className="error" style={{ marginTop: 8 }}>{chainError}</div> : null}
                          {chainMessage ? <p className="sub" style={{ marginTop: 8, color: "var(--brand)" }}>{chainMessage}</p> : null}

                          <div className="fdInventorySummary">
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{chainUi.activeCount}</div>
                              <strong className="fdInventorySummaryValue">{chainActiveBlacklistCount}</strong>
                            </div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem">
                              <div className="kvLabel">{chainUi.updatedAt}</div>
                              <strong className="fdInventorySummaryValue" style={{ fontSize: 14 }}>{chainRule.updatedAt ? fmtDateTime(chainRule.updatedAt) : "-"}</strong>
                            </div>
                          </div>

                          <div className="fdInventoryFormGrid">
                            <form onSubmit={handleChainSaveRule} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{chainUi.settingsSection}</h5>
                              <label className="fdInventoryField" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" checked={chainRule.allowCrossBranch} onChange={(event) => setChainRule((prev) => ({ ...prev, allowCrossBranch: event.target.checked }))} disabled={chainSubmitting} />
                                <span className="sub" style={{ marginTop: 0 }}>{chainUi.allowCrossBranch}</span>
                              </label>
                              <label className="fdInventoryField" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" checked={chainRule.requireManagerApproval} onChange={(event) => setChainRule((prev) => ({ ...prev, requireManagerApproval: event.target.checked }))} disabled={chainSubmitting} />
                                <span className="sub" style={{ marginTop: 0 }}>{chainUi.requireManagerApproval}</span>
                              </label>
                              <label className="fdInventoryField" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" checked={chainRule.suspensionSync} onChange={(event) => setChainRule((prev) => ({ ...prev, suspensionSync: event.target.checked }))} disabled={chainSubmitting} />
                                <span className="sub" style={{ marginTop: 0 }}>{chainUi.suspensionSync}</span>
                              </label>
                              <label className="fdInventoryField" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <input type="checkbox" checked={chainRule.guestPassEnabled} onChange={(event) => setChainRule((prev) => ({ ...prev, guestPassEnabled: event.target.checked }))} disabled={chainSubmitting} />
                                <span className="sub" style={{ marginTop: 0 }}>{chainUi.guestPass}</span>
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{chainUi.maxEntryPerDay}</span>
                                <input className="input" inputMode="numeric" value={chainMaxEntryPerDayText} onChange={(event) => setChainMaxEntryPerDayText(event.target.value)} disabled={chainSubmitting} />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{chainUi.allowedBranches}</span>
                                <input className="input" value={chainAllowedBranchText} onChange={(event) => setChainAllowedBranchText(event.target.value)} disabled={chainSubmitting} />
                              </label>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{chainUi.ruleNote}</span>
                                <textarea className="input" rows={2} value={chainRuleNote} onChange={(event) => setChainRuleNote(event.target.value)} disabled={chainSubmitting} />
                              </label>
                              <div className="fdInventoryActions">
                                <button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={chainSubmitting}>{chainSubmitting ? chainUi.saving : chainUi.saveAction}</button>
                                <button type="button" className="fdPillBtn" onClick={() => void loadChainModule()} disabled={chainLoading || chainSubmitting}>{chainUi.reload}</button>
                              </div>
                            </form>

                            <form onSubmit={handleChainAddBlacklist} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{chainUi.addBlacklistSection}</h5>
                              <label className="fdInventoryField"><span className="kvLabel">{chainUi.blacklistName}</span><input className="input" value={chainBlacklistName} onChange={(event) => setChainBlacklistName(event.target.value)} disabled={chainSubmitting} /></label>
                              <div className="fdInventoryGrid2">
                                <label className="fdInventoryField"><span className="kvLabel">{chainUi.blacklistMemberCode}</span><input className="input" value={chainBlacklistMemberCode} onChange={(event) => setChainBlacklistMemberCode(event.target.value)} disabled={chainSubmitting} /></label>
                                <label className="fdInventoryField"><span className="kvLabel">{chainUi.blacklistPhone}</span><input className="input" value={chainBlacklistPhone} onChange={(event) => setChainBlacklistPhone(event.target.value)} disabled={chainSubmitting} /></label>
                              </div>
                              <label className="fdInventoryField"><span className="kvLabel">{chainUi.blacklistReason}</span><input className="input" value={chainBlacklistReason} onChange={(event) => setChainBlacklistReason(event.target.value)} disabled={chainSubmitting} /></label>
                              <label className="fdInventoryField"><span className="kvLabel">{chainUi.blacklistExpiresAt}</span><input className="input" type="datetime-local" value={chainBlacklistExpiresAt} onChange={(event) => setChainBlacklistExpiresAt(event.target.value)} disabled={chainSubmitting} /></label>
                              <div className="fdInventoryActions"><button type="submit" className="fdPillBtn fdPillBtnPrimary" disabled={chainSubmitting}>{chainUi.addBlacklistSection}</button></div>
                            </form>

                            <form onSubmit={handleChainRemoveBlacklist} className="fdGlassSubPanel fdInventoryFormBlock">
                              <h5 className="sectionTitle" style={{ margin: 0 }}>{chainUi.blacklistSection}</h5>
                              <label className="fdInventoryField">
                                <span className="kvLabel">{chainUi.blacklistSection}</span>
                                <select className="input" value={chainRemoveTargetId} onChange={(event) => setChainRemoveTargetId(event.target.value)} disabled={chainSubmitting}>
                                  {chainBlacklistItems.map((item) => (<option key={item.id} value={item.id}>{item.name} | {item.reason || "-"}</option>))}
                                </select>
                              </label>
                              <label className="fdInventoryField"><span className="kvLabel">{chainUi.ruleNote}</span><input className="input" value={chainRemoveReason} onChange={(event) => setChainRemoveReason(event.target.value)} disabled={chainSubmitting} /></label>
                              <div className="fdInventoryActions"><button type="submit" className="fdPillBtn" disabled={chainSubmitting || chainBlacklistItems.length === 0}>{chainUi.removeAction}</button></div>
                            </form>
                          </div>

                          <div className="fdInventoryListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{chainUi.blacklistSection}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {chainBlacklistItems.map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{item.name}</strong>
                                      <span className="fdChip">{item.memberCode || "-"}</span>
                                    </div>
                                    {item.phone ? <p className="sub" style={{ marginTop: 4 }}>{item.phone}</p> : null}
                                    {item.reason ? <p className="sub" style={{ marginTop: 4 }}>{item.reason}</p> : null}
                                    {item.expiresAt ? <p className="sub" style={{ marginTop: 4 }}>EXP: {fmtDateTime(item.expiresAt)}</p> : null}
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.createdAt)}</p>
                                  </div>
                                ))}
                                {!chainLoading && chainBlacklistItems.length === 0 ? <p className="fdGlassText">{chainUi.noBlacklist}</p> : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {selectedCapability.id === "report" ? (
                        <div className="fdGlassSubPanel fdInventoryPanel" style={{ marginTop: 12, padding: 10 }}>
                          <h4 className="sectionTitle" style={{ margin: 0 }}>{reportUi.title}</h4>
                          <p className="fdGlassText" style={{ marginTop: 6 }}>{reportUi.sub}</p>
                          {reportError ? <div className="error" style={{ marginTop: 8 }}>{reportError}</div> : null}

                          <div className="fdInventorySummary">
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.shiftState}</div><strong className="fdInventorySummaryValue">{t.statusOpenValue}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{t.orders}</div><strong className="fdInventorySummaryValue">{ordersToday}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{t.paid}</div><strong className="fdInventorySummaryValue">{paidToday}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{t.revenue}</div><strong className="fdInventorySummaryValue">{revenueToday}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.pendingApprovals}</div><strong className="fdInventorySummaryValue">{reportPendingApprovalCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.overdueOrders}</div><strong className="fdInventorySummaryValue">{reportOverdueOrderCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.upcomingBookings}</div><strong className="fdInventorySummaryValue">{reportUpcomingCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.unresolvedIncidents}</div><strong className="fdInventorySummaryValue">{reportUnresolvedIncidentCount}</strong></div>
                            <div className="fdGlassSubPanel fdInventorySummaryItem"><div className="kvLabel">{reportUi.convertedLeads}</div><strong className="fdInventorySummaryValue">{leadConvertedCount}</strong></div>
                          </div>

                          <div className="fdInventoryActions" style={{ marginTop: 10 }}>
                            <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => void loadReportModule()} disabled={reportLoading}>
                              {reportUi.reload}
                            </button>
                          </div>

                          <div className="fdInventoryListGrid">
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{reportUi.todoTitle}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {reportTodos.map((item) => (
                                  <div key={item} className="card" style={{ padding: 10 }}>
                                    <p className="sub" style={{ marginTop: 0 }}>{item}</p>
                                  </div>
                                ))}
                                {reportTodos.length === 0 ? <p className="fdGlassText">{reportUi.todoNone}</p> : null}
                              </div>
                            </div>
                            <div className="fdGlassSubPanel" style={{ padding: 10 }}>
                              <div className="kvLabel">{reportUi.auditTitle}</div>
                              <div className="fdListStack" style={{ marginTop: 8 }}>
                                {posApprovals.filter((item) => item.status === "pending").slice(0, 6).map((item) => (
                                  <div key={item.id} className="card" style={{ padding: 10 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                      <strong>{posRiskActionLabel(item.action)}</strong>
                                      <span className="fdChip" style={posApprovalStatusStyle(item.status)}>{posApprovalStatusLabel(item.status)}</span>
                                    </div>
                                    <p className="sub" style={{ marginTop: 4 }}>{item.reason || "-"}</p>
                                    <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                  </div>
                                ))}
                                {posApprovals.filter((item) => item.status === "pending").length === 0 ? (
                                  <p className="fdGlassText">{lang === "zh" ? "目前沒有待審核送單。" : "No pending approvals."}</p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : modalType === "handover" ? (
                <form onSubmit={handleCloseShift} className="fdHandoverForm">
                  <div className="fdHandoverSection">
                    <p className="fdGlassText" style={{ marginTop: 0, marginBottom: 10 }}>{t.handoverHint}</p>
                    {activeShift?.opened_at ? (
                      <div className="fdChip" style={{ marginBottom: 12, display: "inline-flex" }}>
                        {t.openedAt}: {fmtDateTime(activeShift.opened_at)}
                      </div>
                    ) : null}
                    <div className="fdHandoverGrid">
                      <label className="fdHandoverField">
                        <span className="kvLabel">{t.closeCashTotal}</span>
                        <div className="fdAmountInputWrap">
                          <span className="fdAmountPrefix">NT$</span>
                          <input
                            className="input fdAmountInput"
                            inputMode="decimal"
                            value={closeCashTotal}
                            onChange={(e) => setCloseCashTotal(e.target.value)}
                            disabled={closingShift}
                          />
                        </div>
                      </label>
                      <label className="fdHandoverField">
                        <span className="kvLabel">{t.closeCardTotal}</span>
                        <div className="fdAmountInputWrap">
                          <span className="fdAmountPrefix">NT$</span>
                          <input
                            className="input fdAmountInput"
                            inputMode="decimal"
                            value={closeCardTotal}
                            onChange={(e) => setCloseCardTotal(e.target.value)}
                            disabled={closingShift}
                          />
                        </div>
                      </label>
                      <label className="fdHandoverField">
                        <span className="kvLabel">{t.closeTransferTotal}</span>
                        <div className="fdAmountInputWrap">
                          <span className="fdAmountPrefix">NT$</span>
                          <input
                            className="input fdAmountInput"
                            inputMode="decimal"
                            value={closeTransferTotal}
                            onChange={(e) => setCloseTransferTotal(e.target.value)}
                            disabled={closingShift}
                          />
                        </div>
                      </label>
                    </div>
                  </div>
                  <div className="fdHandoverSection">
                    <label className="fdHandoverField fdHandoverNote">
                      <span className="kvLabel">{t.closeNote}</span>
                      <textarea
                        className="input fdHandoverTextarea"
                        rows={3}
                        value={closeNote}
                        onChange={(e) => setCloseNote(e.target.value)}
                        disabled={closingShift}
                        placeholder={t.openingNotePlaceholder}
                      />
                    </label>
                  </div>
                  <div className="fdHandoverFooter">
                    <button type="button" className="fdHandoverBtn fdHandoverBtnGhost" onClick={() => setCapabilityOpen(false)}>
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      className="fdHandoverBtn fdHandoverBtnPrimary"
                      disabled={closingShift}
                      style={closingShift ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
                    >
                      {closingShift ? t.closingShiftAction : t.closeShiftAction}
                    </button>
                  </div>
                </form>
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
