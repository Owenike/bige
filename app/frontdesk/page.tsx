"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function isMemberCode(value: string) {
  if (!/^\d{1,4}$/.test(value)) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 9999;
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

function minutesUntil(value: string) {
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor((ts - Date.now()) / 60000);
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

  const capabilityCards = useMemo(
    (): CapabilityCard[] =>
      lang === "zh"
        ? [
            { id: "entry", title: "A. 入場 / 放行", desc: "掃碼、人工放行、取消誤刷、原因碼與稽核。", detail: "支援會員卡 / QR / 人工例外放行，並要求原因碼與備註，完整寫入稽核。", area: "ENTRY", status: "building" },
            { id: "member", title: "B. 會員查詢 / 建檔", desc: "防重複建檔、自訂欄位、快速下一步。", detail: "支援電話/姓名搜尋、防重複建立、補資料與自訂欄位，櫃檯可直接接續收款與預約。", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. 收銀 / POS / 發票", desc: "訂單收款、退費/作廢送審、結帳流程。", detail: "包含櫃檯收款、多付款方式、退費與作廢送審流程，並保留稽核軌跡。", area: "POS", status: "ready" },
            { id: "booking", title: "D. 預約 / 課務", desc: "建立即時預約與課務調整。", detail: "可建立、改期、取消課務預約，支援現場快速調整時段。", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. 置物櫃 / 租借", desc: "置物櫃租借登記、歸還與押金管理。", detail: "可直接登記租借與歸還，包含押金、到期時間與備註，並保留完整操作軌跡。", area: "LOCKER", status: "ready" },
            { id: "inventory", title: "F. 商品 / 庫存 / 銷售", desc: "前台銷售、庫存調整、低庫存提醒。", detail: "可直接在櫃檯完成商品銷售入帳、庫存扣減與補貨/盤損調整，並保留異動紀錄。", area: "INVENTORY", status: "ready" },
            { id: "cs", title: "G. 客服 / 事件紀錄", desc: "客訴與事件工單（含附件與追蹤）。", detail: "規劃中：客訴工單、現場事件與後續追蹤，支援附件紀錄。", area: "CS", status: "planned" },
            { id: "lead", title: "H. 線索 / 參觀導覽", desc: "Lead 建檔、轉會員、追蹤轉換。", detail: "規劃中：潛在客建檔、導覽排程與轉會員流程。", area: "LEAD", status: "planned" },
            { id: "chain", title: "I. 跨店規則", desc: "跨店可用範圍、停權/黑名單同步。", detail: "建置中：跨店入場規則、停權同步、可用店範圍控制。", area: "CHAIN", status: "building" },
            { id: "report", title: "J. 報表 / 即時監控", desc: "今日營收、到期、欠費、No-show、待辦。", detail: "建置中：櫃檯今日營運看板與交接待辦彙總。", area: "REPORT", status: "building" },
            { id: "audit", title: "K. 權限 / 稽核", desc: "高風險送審、角色權限、完整稽核軌跡。", detail: "已上線：高風險動作送審、管理者核准/駁回、完整 Audit Log。", area: "AUDIT", status: "ready" },
          ]
        : [
            { id: "entry", title: "A. Entry / Allow", desc: "Scan, exception pass, undo, reason code with audit.", detail: "Supports card/QR/manual exception pass with reason code and full audit trail.", area: "ENTRY", status: "building" },
            { id: "member", title: "B. Member Search / Create", desc: "Duplicate prevention, custom fields, quick actions.", detail: "Search/create with duplicate prevention and configurable custom fields.", area: "MEMBER", status: "ready" },
            { id: "pos", title: "C. POS / Invoice", desc: "Order payment, refund/void approval flow.", detail: "Desk payment, multi-method checkout, and approved high-risk refund/void flow.", area: "POS", status: "ready" },
            { id: "booking", title: "D. Booking / Classes", desc: "Booking creation and class schedule handling.", detail: "Create, reschedule, and cancel class bookings from desk operations.", area: "BOOKING", status: "ready" },
            { id: "locker", title: "E. Locker / Rental", desc: "Locker rent/return with deposit handling.", detail: "Register rental and return with deposit, due time, and operation audit trail.", area: "LOCKER", status: "ready" },
            { id: "inventory", title: "F. Product / Inventory", desc: "Desk sales, stock adjustments, low-stock alerts.", detail: "Complete product sales posting, stock deduction, restock/adjustment, and movement history in frontdesk.", area: "INVENTORY", status: "ready" },
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

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "locker") return;
    void loadLockerRentals();
  }, [capabilityOpen, loadLockerRentals, modalType, selectedCapabilityId]);

  useEffect(() => {
    if (!capabilityOpen || modalType !== "capability" || selectedCapabilityId !== "inventory") return;
    void loadInventoryModule();
  }, [capabilityOpen, loadInventoryModule, modalType, selectedCapabilityId]);

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

  const lockerAutoDueAt = useMemo(
    () => (lockerRentalTerm === "custom" ? null : calcLockerDueAtByTerm(lockerRentalTerm)),
    [lockerRentalTerm],
  );

  return (
    <main ref={sceneRef} className={`fdGlassScene ${capabilityOpen ? "fdSceneBlurred" : ""}`}>
      <section className="fdGlassBackdrop fdEnter">
        {error ? <div className="error">{error}</div> : null}
        {shiftActionError ? <div className="error" style={{ marginTop: error ? 10 : 0 }}>{shiftActionError}</div> : null}

        <div className="fdGlassTop">
          <article className="fdGlassPanel">
            <div className="fdChipRow">
              <span className={`fdChip ${shiftState === "closed" ? "fdChipActive" : ""}`}>{t.modeClosed}</span>
              <span className={`fdChip ${shiftState === "open" ? "fdChipActive" : ""}`}>{t.modeOpen}</span>
              {!shiftResolved ? <span className="fdChip fdChipActive">{t.loadingState}</span> : null}
            </div>
            {!shiftResolved ? (
              <>
                <h2 className="fdGlassTitle" style={{ marginTop: 16 }}>
                  {lang === "zh" ? "櫃檯作業" : "Frontdesk Ops"}
                </h2>
                <p className="fdGlassText">{t.loadingState}...</p>
              </>
            ) : !shiftOpen ? (
              <>
                <h2 className="fdGlassTitle" style={{ marginTop: 16 }}>{t.startShiftTitle}</h2>
                <p className="fdGlassText">{t.openShiftDisabledHint}</p>
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
                    rows={3}
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
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <h2 className="fdGlassTitle" style={{ marginTop: 16 }}>
                    {lang === "zh" ? "櫃檯作業" : "Frontdesk Ops"}
                  </h2>
                  <div style={{ display: "grid", justifyItems: "end", gap: 6, marginTop: 10 }}>
                    {activeShift?.opened_at ? (
                      <span className="fdChip">{t.openedAt}: {fmtDateTime(activeShift.opened_at)}</span>
                    ) : null}
                    {activeShift?.opened_by_name || activeShift?.opened_by ? (
                      <span className="fdChip">{t.shiftOperator}: {activeShift.opened_by_name || activeShift.opened_by}</span>
                    ) : null}
                    <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => {
                      setModalType("handover");
                      setCapabilityOpen(true);
                    }}>
                      {t.handoverAction}
                    </button>
                  </div>
                </div>
                <p className="fdGlassText">{t.statusTip}</p>
                <div className="fdPillActions">
                  <button type="button" className="fdPillBtn fdPillBtnPrimary" onClick={() => openCapabilityModal("entry", "entry")} disabled={actionsDisabled}>
                    {t.primary}
                  </button>
                  <button type="button" className="fdPillBtn fdPillBtnGhost" onClick={() => openCapabilityModal("member", "member")} disabled={actionsDisabled}>
                    {t.secondary}
                  </button>
                  <button
                    type="button"
                    className="fdPillBtn fdPillBtnGhost"
                    onClick={() => setSoundEnabled((prev) => !prev)}
                    disabled={actionsDisabled}
                  >
                    {soundEnabled ? t.soundOn : t.soundOff}
                  </button>
                </div>
              </>
            )}
          </article>

          <article className="fdGlassPanel">
            <div className="fdChipRow">
              <span className="fdChip fdChipActive">{t.statusOpen}</span>
              <span className="fdChip">{t.statusTasks}</span>
            </div>
            <h2 className="fdGlassTitle">{t.opsTitle}</h2>
            {!shiftResolved ? (
              <p className="fdGlassText" style={{ marginTop: 10 }}>{t.loadingState}...</p>
            ) : shiftOpen ? (
              <>
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
              </>
            ) : (
              <p className="fdGlassText" style={{ marginTop: 10 }}>{t.openShiftFirst}</p>
            )}
          </article>
        </div>

        <section className="fdGlassSubPanel" style={{ marginTop: 14, padding: 14 }}>
          <h2 className="sectionTitle">{t.capabilityTitle}</h2>
          <p className="fdGlassText" style={{ marginTop: 8 }}>{t.capabilitySub}</p>
          <button
            type="button"
            className="fdPillBtn fdPillBtnGhost"
            onClick={() => openCapabilityModal("member", "capability")}
            disabled={actionsDisabled}
            style={actionsDisabled ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
          >
            {t.capabilityOpenBtn}
          </button>
          {shiftResolved && actionsDisabled ? <p className="fdGlassText" style={{ marginTop: 8 }}>{t.openShiftFirst}</p> : null}
        </section>

        <section className="fdTwoCol" style={{ marginTop: 14 }}>
          {shiftResolved && actionsDisabled ? (
            <p className="fdGlassText" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
              {t.openShiftFirst}
            </p>
          ) : null}
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
                    <a
                      className="fdPillBtn"
                      style={actionsDisabled ? { marginTop: 8, display: "inline-flex", opacity: 0.7, pointerEvents: "none" } : { marginTop: 8, display: "inline-flex" }}
                      href={`/frontdesk/orders/new?orderId=${encodeURIComponent(item.id)}`}
                      aria-disabled={actionsDisabled}
                      onClick={(event) => {
                        if (actionsDisabled) event.preventDefault();
                      }}
                    >
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
                    <a
                      className="fdPillBtn"
                      style={actionsDisabled ? { marginTop: 8, display: "inline-flex", opacity: 0.7, pointerEvents: "none" } : { marginTop: 8, display: "inline-flex" }}
                      href="/frontdesk/bookings"
                      aria-disabled={actionsDisabled}
                      onClick={(event) => {
                        if (actionsDisabled) event.preventDefault();
                      }}
                    >
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
                          <div className="fdPillActions" style={{ marginTop: 10 }}>
                            <a
                              className="fdPillBtn fdPillBtnPrimary"
                              href="/frontdesk/orders/new"
                              style={actionsDisabled ? { opacity: 0.7, pointerEvents: "none" } : undefined}
                              aria-disabled={actionsDisabled}
                              onClick={(event) => {
                                if (actionsDisabled) event.preventDefault();
                              }}
                            >
                              {t.openPosPage}
                            </a>
                          </div>
                          <div className="kvLabel" style={{ marginTop: 8 }}>{t.posPendingTitle}</div>
                          <div className="fdListStack" style={{ marginTop: 8 }}>
                            {unpaidOrderList.slice(0, 4).map((item) => (
                              <div key={item.id} className="card" style={{ padding: 10 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                  <strong>{item.id.slice(0, 8)}</strong>
                                  <span className="fdChip">{item.status}</span>
                                </div>
                                <p className="sub" style={{ marginTop: 4 }}>NT${item.amount}</p>
                                <p className="sub" style={{ marginTop: 4 }}>{fmtDateTime(item.created_at)}</p>
                                <a
                                  className="fdPillBtn"
                                  style={actionsDisabled ? { marginTop: 8, display: "inline-flex", opacity: 0.7, pointerEvents: "none" } : { marginTop: 8, display: "inline-flex" }}
                                  href={`/frontdesk/orders/new?orderId=${encodeURIComponent(item.id)}`}
                                  aria-disabled={actionsDisabled}
                                  onClick={(event) => {
                                    if (actionsDisabled) event.preventDefault();
                                  }}
                                >
                                  {t.collectAction}
                                </a>
                              </div>
                            ))}
                            {!loading && unpaidOrderList.length === 0 ? <p className="fdGlassText">{t.posNoPending}</p> : null}
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
