"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  paymentMatchesStatusFilter,
} from "../../../lib/trial-booking-filters";
import { trialBookingAssigneeOptions } from "../../../lib/trial-booking-coaches";
import {
  matchesTrialFaHistorySearch,
  type TrialFaHistoryItem,
} from "../../../lib/trial-booking-fa-history";
import {
  normalizeTrialBookingSource,
  trialBookingSourceLabels,
  type TrialBookingSource,
} from "../../../lib/trial-booking-sources";

type PaymentMethod = "cash_on_site" | "online_payment";
type PaymentStatus = "pending_cash" | "pending_payment" | "paid" | "failed" | "cancelled";
type BookingStatus = "new" | "contacted" | "scheduled" | "completed" | "cancelled" | "no_show";
type WaitlistStatus = "pending" | "contacted" | "booked" | "cancelled";
type BookingSource = TrialBookingSource;
type LineNotificationStatus = "not_sent" | "sent" | "failed";

type TrialBookingContactLog = {
  id: string;
  note: string;
  contacted_at: string;
  contacted_by: string | null;
  operator_label: string;
};

type TrialBookingRow = {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  birthday: string | null;
  line_name: string | null;
  service: string;
  preferred_time: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  amount: number | string | null;
  currency: string | null;
  merchant_trade_no: string | null;
  acpay_trade_no: string | null;
  paid_at: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  booking_coach: string | null;
  executing_coach: string | null;
  source: BookingSource | "website_trial_booking" | string | null;
  booking_status: BookingStatus;
  line_notification_status: LineNotificationStatus | string | null;
  line_notified_at: string | null;
  line_notification_error: string | null;
  note: string | null;
  schedule_note: string | null;
  staff_note: string | null;
  staff_note_updated_at: string | null;
  staff_note_updated_by: string | null;
  updated_at: string | null;
  contact_history: TrialBookingContactLog[];
};

type TrialBookingStats = {
  total: number;
  website: number;
  websiteScheduled: number;
  websiteRegistration: number;
  officialLine: number;
  walkIn: number;
  phoneBooking: number;
  br: number;
};

type TrialBookingResponse = {
  ok?: boolean;
  bookings?: TrialBookingRow[];
  stats?: TrialBookingStats;
  coaches?: CoachOption[];
  error?: string;
};

type TrialBookingMutationResponse = {
  ok?: boolean;
  booking?: TrialBookingRow;
  lineNotification?: "sent" | "failed" | "not_sent";
  message?: string;
  error?: string;
};

type TrialFaHistoryResponse = {
  ok?: boolean;
  items?: TrialFaHistoryItem[];
  error?: string;
};

type TrialAdminAccessState = "checking" | "allowed" | "unauthorized" | "forbidden";

type TrialBookingStatusUpdateResponse = {
  ok?: boolean;
  booking?: {
    id: string;
    booking_status: BookingStatus;
    updated_at: string;
  };
  error?: string;
};

type TrialBookingStaffNoteUpdateResponse = {
  ok?: boolean;
  booking?: Pick<
    TrialBookingRow,
    "id" | "staff_note" | "staff_note_updated_at" | "staff_note_updated_by" | "updated_at"
  >;
  error?: string;
};

type BookingWaitlistRow = {
  id: string;
  createdAt: string;
  contactName: string | null;
  contactPhone: string | null;
  note: string | null;
  status: WaitlistStatus;
};

type BookingWaitlistResponse = {
  ok?: boolean;
  items?: BookingWaitlistRow[];
  item?: BookingWaitlistRow;
  error?: string;
  message?: string;
};

type CoachOption = {
  id: string;
  label: string;
  branchId: string | null;
};

type ScheduleFormData = {
  appointmentDate: string;
  appointmentTime: string;
  service: string;
  name: string;
  phone: string;
  bookingCoach: string;
  executingCoachId: string;
  executingCoach: string;
  source: BookingSource;
  note: string;
};

const serviceLabels: Record<string, string> = {
  weight_training: "重量訓練",
  relaxation: "放鬆",
  boxing_fitness: "拳擊體能訓練",
  pilates: "器械皮拉提斯",
  reformer_pilates: "器械皮拉提斯",
  sports_massage: "運動按摩",
  sports_cupping: "運動拔罐",
  fascia_knife: "筋膜刀",
  onsite_assessment: "現場評估",
};

const serviceOptions = [
  { value: "weight_training", label: "重量訓練" },
  { value: "boxing_fitness", label: "拳擊體能訓練" },
  { value: "pilates", label: "器械皮拉提斯" },
  { value: "sports_massage", label: "運動按摩" },
  { value: "onsite_assessment", label: "現場評估" },
];

const appointmentTimeOptions = Array.from({ length: 27 }, (_, index) => {
  const totalMinutes = 9 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});
const appointmentTimeSet = new Set(appointmentTimeOptions);

const preferredTimeLabels: Record<string, string> = {
  weekday_morning: "平日上午",
  weekday_afternoon: "平日下午",
  weekday_evening: "平日晚上",
  weekend_morning: "假日上午",
  weekend_afternoon: "假日下午",
  weekend_evening: "假日晚上",
  other: "其他",
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash_on_site: "當天付現",
  online_payment: "線上付款",
};

const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending_cash: "現場付款待確認",
  pending_payment: "線上付款待付款",
  paid: "已付款",
  failed: "付款失敗",
  cancelled: "付款已取消",
};

const bookingStatusLabels: Record<BookingStatus, string> = {
  new: "待聯絡",
  contacted: "已聯繫",
  scheduled: "已安排",
  completed: "已完成",
  cancelled: "已隱藏",
  no_show: "未到場",
};

const bookingStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "new", label: "待聯絡" },
  { value: "contacted", label: "已聯繫" },
  { value: "scheduled", label: "已安排" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已隱藏" },
  { value: "no_show", label: "未到場" },
];

const unscheduledStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "new", label: "待聯絡" },
  { value: "contacted", label: "已聯繫" },
  { value: "cancelled", label: "已隱藏" },
];

const scheduledStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "scheduled", label: "已安排" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已隱藏" },
  { value: "no_show", label: "未到場" },
];

const sourceLabels = trialBookingSourceLabels;

const lineStatusLabels: Record<LineNotificationStatus, string> = {
  not_sent: "未發送",
  sent: "已發送",
  failed: "發送失敗",
};

const waitlistStatusLabels: Record<WaitlistStatus, string> = {
  pending: "待聯繫",
  contacted: "已聯繫",
  booked: "已預約",
  cancelled: "已取消",
};

const waitlistStatusOptions: Array<{ value: WaitlistStatus; label: string }> = [
  { value: "pending", label: "待聯繫" },
  { value: "contacted", label: "已聯繫" },
  { value: "booked", label: "已預約" },
  { value: "cancelled", label: "已取消" },
];

// Legacy public-request test area. Keep its code and data available, but do not
// show it or fetch it in the production admin workflow.
const SHOW_PUBLIC_BOOKING_REQUESTS = false;

const emptyStats: TrialBookingStats = {
  total: 0,
  website: 0,
  websiteScheduled: 0,
  websiteRegistration: 0,
  officialLine: 0,
  walkIn: 0,
  phoneBooking: 0,
  br: 0,
};

function todayDateInputValue() {
  const now = new Date();
  const taipei = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return taipei;
}

function defaultStatsFrom() {
  const now = new Date();
  const date = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function initialScheduleForm(): ScheduleFormData {
  return {
    appointmentDate: todayDateInputValue(),
    appointmentTime: "16:00",
    service: "pilates",
    name: "",
    phone: "",
    bookingCoach: "",
    executingCoachId: "",
    executingCoach: "",
    source: "official_line",
    note: "",
  };
}

function coachIdFromLabel(coaches: CoachOption[], value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("en") || "";
  if (!normalized) return "";
  return coaches.find((coach) => coach.label.trim().toLocaleLowerCase("en") === normalized)?.id || "";
}

function formFromBooking(booking: TrialBookingRow, coaches: CoachOption[]): ScheduleFormData {
  return {
    appointmentDate: booking.appointment_date || todayDateInputValue(),
    appointmentTime: booking.appointment_time && appointmentTimeSet.has(booking.appointment_time) ? booking.appointment_time : "09:00",
    service: booking.service || "pilates",
    name: booking.name || "",
    phone: booking.phone || "",
    bookingCoach: booking.booking_coach || "",
    executingCoachId: coachIdFromLabel(coaches, booking.executing_coach),
    executingCoach: booking.executing_coach || "",
    source: "website",
    note: booking.schedule_note || "",
  };
}

function normalizeSource(value: TrialBookingRow["source"] | undefined): BookingSource {
  return normalizeTrialBookingSource(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3]}`;
}

function formatAppointmentPeriod(startsAt: string, endsAt: string) {
  return `${formatDateTime(startsAt)} ～ ${formatDateTime(endsAt)}`;
}

function labelOrFallback(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return "-";
  return labels[value] || value;
}

function formatMoney(amount: TrialBookingRow["amount"], currency: string | null) {
  if (amount === null || amount === undefined || amount === "") return "-";
  return `${currency || "TWD"} ${amount}`;
}

function paymentPaidAtLabel(booking: TrialBookingRow) {
  if (booking.paid_at) return formatDateTime(booking.paid_at);
  if (booking.payment_status === "pending_payment") return "尚未付款";
  return "-";
}

function renderPaymentDetails(booking: TrialBookingRow) {
  return (
    <dl className="trialAdminPaymentDetails">
      <div>
        <dt>金額</dt>
        <dd>{formatMoney(booking.amount, booking.currency)}</dd>
      </div>
      <div>
        <dt>商店訂單編號</dt>
        <dd>{booking.merchant_trade_no || "-"}</dd>
      </div>
      <div>
        <dt>ACPay 交易序號</dt>
        <dd>{booking.acpay_trade_no || "-"}</dd>
      </div>
      <div>
        <dt>付款時間</dt>
        <dd>{paymentPaidAtLabel(booking)}</dd>
      </div>
    </dl>
  );
}

function lineStatus(booking: TrialBookingRow): LineNotificationStatus {
  if (booking.line_notification_status === "sent" || booking.line_notification_status === "failed") {
    return booking.line_notification_status;
  }
  return "not_sent";
}

function statusOptionsForBooking(booking: TrialBookingRow) {
  const baseOptions = booking.booking_status === "scheduled" || booking.appointment_date ? scheduledStatusOptions : unscheduledStatusOptions;
  if (baseOptions.some((option) => option.value === booking.booking_status)) return baseOptions;
  return [{ value: booking.booking_status, label: labelOrFallback(bookingStatusLabels, booking.booking_status) }, ...baseOptions];
}

export default function TrialBookingsAdminPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<TrialBookingRow[]>([]);
  const [waitlistItems, setWaitlistItems] = useState<BookingWaitlistRow[]>([]);
  const [stats, setStats] = useState<TrialBookingStats>(emptyStats);
  const [search, setSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [workflowGroup, setWorkflowGroup] = useState<"follow_up" | "processed" | "marketing_report">("follow_up");
  const [source, setSource] = useState("");
  const [statsFrom, setStatsFrom] = useState(defaultStatsFrom);
  const [statsTo, setStatsTo] = useState(todayDateInputValue);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessState, setAccessState] = useState<TrialAdminAccessState>("checking");
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);
  const [isWaitlistLoading, setIsWaitlistLoading] = useState(SHOW_PUBLIC_BOOKING_REQUESTS);
  const [waitlistError, setWaitlistError] = useState("");
  const [updatingWaitlistId, setUpdatingWaitlistId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [waitlistRowMessages, setWaitlistRowMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [modalMode, setModalMode] = useState<"create" | "schedule" | null>(null);
  const [activeBooking, setActiveBooking] = useState<TrialBookingRow | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormData>(initialScheduleForm);
  const [coachOptions, setCoachOptions] = useState<CoachOption[]>([]);
  const [isLoadingCoaches, setIsLoadingCoaches] = useState(true);
  const [coachOptionsError, setCoachOptionsError] = useState("");
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [modalError, setModalError] = useState("");
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [contactModalBooking, setContactModalBooking] = useState<TrialBookingRow | null>(null);
  const [contactNote, setContactNote] = useState("");
  const [contactModalError, setContactModalError] = useState("");
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [staffNoteModalBooking, setStaffNoteModalBooking] = useState<TrialBookingRow | null>(null);
  const [staffNote, setStaffNote] = useState("");
  const [staffNoteModalError, setStaffNoteModalError] = useState("");
  const [isSavingStaffNote, setIsSavingStaffNote] = useState(false);
  const [isFaHistoryOpen, setIsFaHistoryOpen] = useState(false);
  const [faHistoryItems, setFaHistoryItems] = useState<TrialFaHistoryItem[]>([]);
  const [faHistorySearch, setFaHistorySearch] = useState("");
  const [faHistoryError, setFaHistoryError] = useState("");
  const [isFaHistoryLoading, setIsFaHistoryLoading] = useState(false);

  const filteredFaHistoryItems = useMemo(
    () => faHistoryItems.filter((item) => matchesTrialFaHistorySearch(item, faHistorySearch)),
    [faHistoryItems, faHistorySearch],
  );

  const bookingCoachOptions = useMemo(
    () => trialBookingAssigneeOptions(coachOptions.map((coach) => coach.label)),
    [coachOptions],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set("q", trimmedSearch.slice(0, 80));
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    params.set("workflowGroup", workflowGroup);
    if (source) params.set("source", source);
    if (statsFrom) params.set("statsFrom", statsFrom);
    if (statsTo) params.set("statsTo", statsTo);
    return params.toString();
  }, [paymentMethod, paymentStatus, search, source, statsFrom, statsTo, workflowGroup]);

  const loadBookings = useCallback(async () => {
    setIsLoading(true);
    setIsLoadingCoaches(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/trial-bookings${queryString ? `?${queryString}` : ""}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingResponse | null;

      if (!response.ok || !payload?.ok) {
        if (response.status === 401) {
          setAccessState("unauthorized");
          setError("請先登入後再查看首次體驗預約。");
          router.replace("/login/staff?returnTo=/admin/trial-bookings");
        } else if (response.status === 403) {
          setAccessState("forbidden");
          setError("此頁面僅限管理者查看。");
        } else {
          setAccessState("allowed");
          setError(payload?.error || "無法讀取首次體驗預約資料。");
        }
        setBookings([]);
        setStats(emptyStats);
        setCoachOptions([]);
        setCoachOptionsError(payload?.error || "無法讀取教練名單。");
        return;
      }

      setAccessState("allowed");
      setBookings(payload.bookings || []);
      setStats(payload.stats || emptyStats);
      setCoachOptions(payload.coaches || []);
      setCoachOptionsError(payload.coaches?.length ? "" : "目前沒有可用的教練帳號。");
    } catch {
      setError("讀取資料時發生錯誤，請稍後再試。");
      setBookings([]);
      setStats(emptyStats);
      setCoachOptions([]);
      setCoachOptionsError("讀取教練名單時發生錯誤。");
    } finally {
      setIsLoading(false);
      setIsLoadingCoaches(false);
    }
  }, [queryString, router]);

  const loadFaHistory = useCallback(async () => {
    setIsFaHistoryLoading(true);
    setFaHistoryError("");

    try {
      const response = await fetch("/api/admin/trial-bookings/not-converted-history", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as TrialFaHistoryResponse | null;

      if (!response.ok || !payload?.ok) {
        if (response.status === 401) {
          router.replace("/login/staff?returnTo=/admin/trial-bookings");
        }
        throw new Error(payload?.error || "讀取未成交 FA 歷程失敗。");
      }

      setFaHistoryItems(payload.items || []);
    } catch (caught) {
      setFaHistoryItems([]);
      setFaHistoryError(caught instanceof Error ? caught.message : "讀取未成交 FA 歷程失敗。");
    } finally {
      setIsFaHistoryLoading(false);
    }
  }, [router]);

  function openFaHistory() {
    setIsFaHistoryOpen(true);
    setFaHistorySearch("");
    void loadFaHistory();
  }

  function closeFaHistory() {
    setIsFaHistoryOpen(false);
    setFaHistoryError("");
  }

  const loadWaitlist = useCallback(async () => {
    setIsWaitlistLoading(true);
    setWaitlistError("");

    try {
      const response = await fetch("/api/admin/booking-waitlist", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as BookingWaitlistResponse | null;

      if (!response.ok || !payload?.ok) {
        setWaitlistError(payload?.message || payload?.error || "無法讀取公開預約需求。");
        setWaitlistItems([]);
        return;
      }

      setWaitlistItems(payload.items || []);
    } catch {
      setWaitlistError("讀取公開預約需求時發生錯誤，請稍後再試。");
      setWaitlistItems([]);
    } finally {
      setIsWaitlistLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
    if (SHOW_PUBLIC_BOOKING_REQUESTS) void loadWaitlist();
  }, [loadBookings, loadWaitlist]);

  useEffect(() => {
    if (!coachOptions.length) return;
    setScheduleForm((current) => {
      if (current.executingCoachId || !current.executingCoach.trim()) return current;
      const matchedId = coachIdFromLabel(coachOptions, current.executingCoach);
      if (!matchedId) return current;
      const matchedCoach = coachOptions.find((coach) => coach.id === matchedId);
      return {
        ...current,
        executingCoachId: matchedId,
        executingCoach: matchedCoach?.label || current.executingCoach,
      };
    });
  }, [coachOptions]);

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("登出失敗，請稍後再試。");
      router.replace("/login");
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "登出失敗，請稍後再試。");
      setIsLoggingOut(false);
    }
  }

  function upsertBooking(updated: TrialBookingRow) {
    setBookings((current) => {
      const exists = current.some((booking) => booking.id === updated.id);
      if (!exists) return [updated, ...current];
      return current.map((booking) => (booking.id === updated.id ? updated : booking));
    });
  }

  async function updateBookingStatus(bookingId: string, nextStatus: BookingStatus) {
    const current = bookings.find((booking) => booking.id === bookingId);
    if (!current || updatingBookingId) return;
    if (nextStatus === "contacted") {
      openContactModal(current);
      return;
    }
    if (current.booking_status === nextStatus) return;
    if (nextStatus === "scheduled") {
      openScheduleModal(current);
      return;
    }

    setUpdatingBookingId(bookingId);
    setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "更新中..." } }));

    try {
      const response = await fetch(`/api/admin/trial-bookings/${bookingId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingStatus: nextStatus }),
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingStatusUpdateResponse | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        setRowMessages((messages) => ({
          ...messages,
          [bookingId]: { type: "error", text: payload?.error || "更新預約狀態失敗。" },
        }));
        return;
      }

      setBookings((currentBookings) => currentBookings.map((booking) =>
        booking.id === bookingId ? { ...booking, booking_status: payload.booking!.booking_status } : booking,
      ));
      setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "已更新" } }));
      void loadBookings();
    } catch {
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "error", text: "更新預約狀態時發生錯誤。" },
      }));
    } finally {
      setUpdatingBookingId(null);
    }
  }

  async function updateWaitlistStatus(itemId: string, nextStatus: WaitlistStatus) {
    const current = waitlistItems.find((item) => item.id === itemId);
    if (!current || current.status === nextStatus || updatingWaitlistId) return;

    setUpdatingWaitlistId(itemId);
    setWaitlistRowMessages((messages) => ({ ...messages, [itemId]: { type: "success", text: "更新中..." } }));

    try {
      const response = await fetch("/api/admin/booking-waitlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, status: nextStatus }),
      });
      const payload = (await response.json().catch(() => null)) as BookingWaitlistResponse | null;

      if (!response.ok || !payload?.ok || !payload.item) {
        setWaitlistRowMessages((messages) => ({
          ...messages,
          [itemId]: { type: "error", text: payload?.message || payload?.error || "更新公開預約需求狀態失敗。" },
        }));
        return;
      }

      setWaitlistItems((items) => items.map((item) => (item.id === itemId ? { ...item, status: payload.item!.status } : item)));
      setWaitlistRowMessages((messages) => ({ ...messages, [itemId]: { type: "success", text: "已更新" } }));
    } catch {
      setWaitlistRowMessages((messages) => ({
        ...messages,
        [itemId]: { type: "error", text: "更新公開預約需求狀態時發生錯誤。" },
      }));
    } finally {
      setUpdatingWaitlistId(null);
    }
  }

  function openContactModal(booking: TrialBookingRow) {
    if (isSavingContact || updatingBookingId) return;
    setContactModalBooking(booking);
    setContactNote("");
    setContactModalError("");
  }

  function closeContactModal() {
    if (isSavingContact) return;
    setContactModalBooking(null);
    setContactNote("");
    setContactModalError("");
  }

  async function submitContactNote() {
    if (!contactModalBooking || isSavingContact) return;
    const normalizedNote = contactNote.trim();
    if (!normalizedNote) {
      setContactModalError("請填寫本次聯繫內容。");
      return;
    }

    const bookingId = contactModalBooking.id;
    setIsSavingContact(true);
    setUpdatingBookingId(bookingId);
    setContactModalError("");
    setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "儲存聯繫紀錄中..." } }));

    try {
      const response = await fetch(`/api/admin/trial-bookings/${bookingId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingStatus: "contacted", contactNote: normalizedNote }),
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingStatusUpdateResponse | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        setContactModalError(payload?.error || "儲存聯繫備註失敗。");
        setRowMessages((messages) => ({
          ...messages,
          [bookingId]: { type: "error", text: payload?.error || "儲存聯繫備註失敗。" },
        }));
        return;
      }

      setContactModalBooking(null);
      setContactNote("");
      setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "聯繫紀錄已儲存" } }));
      await loadBookings();
    } catch {
      setContactModalError("儲存聯繫備註時發生錯誤，請稍後再試。");
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "error", text: "儲存聯繫備註時發生錯誤。" },
      }));
    } finally {
      setIsSavingContact(false);
      setUpdatingBookingId(null);
    }
  }

  function openStaffNoteModal(booking: TrialBookingRow) {
    if (isSavingStaffNote || updatingBookingId) return;
    setStaffNoteModalBooking(booking);
    setStaffNote(booking.staff_note || "");
    setStaffNoteModalError("");
  }

  function closeStaffNoteModal() {
    if (isSavingStaffNote) return;
    setStaffNoteModalBooking(null);
    setStaffNote("");
    setStaffNoteModalError("");
  }

  async function submitStaffNote() {
    if (!staffNoteModalBooking || isSavingStaffNote) return;

    const bookingId = staffNoteModalBooking.id;
    setIsSavingStaffNote(true);
    setUpdatingBookingId(bookingId);
    setStaffNoteModalError("");
    setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "儲存名單備註中..." } }));

    try {
      const response = await fetch(`/api/admin/trial-bookings/${bookingId}/note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: staffNote }),
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingStaffNoteUpdateResponse | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        const message = payload?.error || "儲存名單備註失敗。";
        setStaffNoteModalError(message);
        setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "error", text: message } }));
        return;
      }

      const updated = payload.booking;
      setBookings((currentBookings) => currentBookings.map((booking) =>
        booking.id === bookingId ? { ...booking, ...updated } : booking,
      ));
      setStaffNoteModalBooking(null);
      setStaffNote("");
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "success", text: "備註已儲存，名單仍保留在原處理分類。" },
      }));
    } catch {
      setStaffNoteModalError("儲存名單備註時發生錯誤，請稍後再試。");
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "error", text: "儲存名單備註時發生錯誤。" },
      }));
    } finally {
      setIsSavingStaffNote(false);
      setUpdatingBookingId(null);
    }
  }

  function openCreateModal() {
    setModalMode("create");
    setActiveBooking(null);
    setScheduleForm(initialScheduleForm());
    setModalError("");
  }

  function openScheduleModal(booking: TrialBookingRow) {
    setModalMode("schedule");
    setActiveBooking(booking);
    setScheduleForm(formFromBooking(booking, coachOptions));
    setModalError("");
  }

  function closeModal() {
    if (isSavingSchedule) return;
    setModalMode(null);
    setActiveBooking(null);
    setModalError("");
  }

  function updateScheduleField<K extends keyof ScheduleFormData>(field: K, value: ScheduleFormData[K]) {
    setScheduleForm((current) => ({ ...current, [field]: value }));
    setModalError("");
  }

  function updateExecutingCoach(coachId: string) {
    const coach = coachOptions.find((option) => option.id === coachId);
    setScheduleForm((current) => ({
      ...current,
      executingCoachId: coach?.id || "",
      executingCoach: coach?.label || "",
    }));
    setModalError("");
  }

  function validateScheduleForm() {
    if (!scheduleForm.appointmentDate || !scheduleForm.appointmentTime || !scheduleForm.service) return false;
    if (!scheduleForm.name.trim() || !scheduleForm.phone.trim()) return false;
    if (!scheduleForm.bookingCoach.trim() || !scheduleForm.executingCoachId || !scheduleForm.executingCoach.trim()) return false;
    if (modalMode === "create" && !scheduleForm.source) return false;
    return true;
  }

  async function submitSchedule() {
    if (isSavingSchedule || !modalMode) return;
    if (!validateScheduleForm()) {
      setModalError("請填寫預約日期、時間、項目、姓名、電話、預約教練與執行教練。");
      return;
    }

    setIsSavingSchedule(true);
    setModalError("");

    try {
      const endpoint =
        modalMode === "create"
          ? "/api/admin/trial-bookings"
          : `/api/admin/trial-bookings/${activeBooking?.id}/schedule`;
      const response = await fetch(endpoint, {
        method: modalMode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentDate: scheduleForm.appointmentDate,
          appointmentTime: scheduleForm.appointmentTime,
          service: scheduleForm.service,
          name: scheduleForm.name,
          phone: scheduleForm.phone,
          bookingCoach: scheduleForm.bookingCoach,
          executingCoachId: scheduleForm.executingCoachId,
          executingCoach: scheduleForm.executingCoach,
          source: scheduleForm.source,
          ...(modalMode === "create"
            ? { note: scheduleForm.note }
            : { scheduleNote: scheduleForm.note }),
        }),
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingMutationResponse | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        setModalError(payload?.error || "儲存體驗預約失敗。");
        return;
      }

      upsertBooking(payload.booking);
      setRowMessages((messages) => ({
        ...messages,
        [payload.booking!.id]: {
          type: payload.lineNotification === "failed" ? "error" : "success",
          text: payload.message || "已儲存",
        },
      }));
      closeModal();
      void loadBookings();
    } catch {
      setModalError("儲存體驗預約時發生錯誤。");
    } finally {
      setIsSavingSchedule(false);
    }
  }

  async function resendLine(booking: TrialBookingRow) {
    if (updatingBookingId) return;
    setUpdatingBookingId(booking.id);
    setRowMessages((messages) => ({ ...messages, [booking.id]: { type: "success", text: "LINE 發送中..." } }));

    try {
      const response = await fetch(`/api/admin/trial-bookings/${booking.id}/resend-line`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as TrialBookingMutationResponse | null;
      if (!response.ok || !payload?.ok || !payload.booking) {
        setRowMessages((messages) => ({
          ...messages,
          [booking.id]: { type: "error", text: payload?.error || "重新發送 LINE 失敗。" },
        }));
        return;
      }
      upsertBooking(payload.booking);
      setRowMessages((messages) => ({
        ...messages,
        [booking.id]: {
          type: payload.lineNotification === "failed" ? "error" : "success",
          text: payload.message || "LINE 通知已處理。",
        },
      }));
      void loadBookings();
    } catch {
      setRowMessages((messages) => ({
        ...messages,
        [booking.id]: { type: "error", text: "重新發送 LINE 時發生錯誤。" },
      }));
    } finally {
      setUpdatingBookingId(null);
    }
  }

  async function confirmCashPayment(booking: TrialBookingRow) {
    if (updatingBookingId || booking.payment_method !== "cash_on_site" || booking.payment_status !== "pending_cash") return;
    if (!window.confirm(`確認已收到 ${booking.name || "此客戶"} 的現場款項？確認後付款狀態會改為「已付款」。`)) return;

    setUpdatingBookingId(booking.id);
    setRowMessages((messages) => ({ ...messages, [booking.id]: { type: "success", text: "確認收款中..." } }));

    try {
      const response = await fetch(`/api/admin/trial-bookings/${booking.id}/payment-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_cash_paid" }),
      });
      const payload = (await response.json().catch(() => null)) as TrialBookingMutationResponse | null;

      if (!response.ok || !payload?.ok || !payload.booking) {
        setRowMessages((messages) => ({
          ...messages,
          [booking.id]: { type: "error", text: payload?.error || "確認現場收款失敗。" },
        }));
        return;
      }

      setBookings((currentBookings) => {
        if (!paymentMatchesStatusFilter(payload.booking!.payment_status, paymentStatus)) {
          return currentBookings.filter((item) => item.id !== booking.id);
        }
        return currentBookings.map((item) => (item.id === booking.id ? payload.booking! : item));
      });
      setRowMessages((messages) => ({
        ...messages,
        [booking.id]: { type: "success", text: payload.message || "現場收款已確認。" },
      }));
    } catch {
      setRowMessages((messages) => ({
        ...messages,
        [booking.id]: { type: "error", text: "確認現場收款時發生錯誤。" },
      }));
    } finally {
      setUpdatingBookingId(null);
    }
  }

  function renderPaymentManagement(booking: TrialBookingRow) {
    const canConfirmCash =
      booking.booking_status !== "cancelled" &&
      booking.payment_method === "cash_on_site" &&
      booking.payment_status === "pending_cash";
    return (
      <div className="trialAdminPaymentManagement">
        {renderPaymentDetails(booking)}
        {canConfirmCash ? (
          <button
            className="trialAdminButton trialAdminButtonSmall"
            type="button"
            disabled={updatingBookingId !== null}
            onClick={() => void confirmCashPayment(booking)}
          >
            {updatingBookingId === booking.id ? "確認中..." : "確認現場已收款"}
          </button>
        ) : null}
      </div>
    );
  }

  function renderStatusControl(booking: TrialBookingRow) {
    const isUpdating = updatingBookingId === booking.id;
    const message = rowMessages[booking.id];
    const statusOptions = statusOptionsForBooking(booking);

    return (
      <div className={`trialAdminStatusControl${isUpdating ? " trialAdminRowUpdating" : ""}`}>
        <span className={`trialAdminBadge is-${booking.booking_status}`}>
          {labelOrFallback(bookingStatusLabels, booking.booking_status)}
        </span>
        <select
          className="trialAdminStatusSelect"
          value={booking.booking_status}
          disabled={isUpdating}
          onChange={(event) => {
            void updateBookingStatus(booking.id, event.target.value as BookingStatus);
          }}
          aria-label={`${booking.name || "booking"} 預約狀態`}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="trialAdminButton trialAdminButtonSmall"
          type="button"
          disabled={isUpdating}
          onClick={() => openContactModal(booking)}
        >
          {booking.booking_status === "contacted" ? "新增聯繫備註" : "記錄已聯繫"}
        </button>
        {message ? (
          <span className={`trialAdminInlineMessage is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        ) : null}
      </div>
    );
  }

  function renderContactHistory(booking: TrialBookingRow) {
    const history = booking.contact_history || [];
    if (history.length === 0) {
      return <p className="trialAdminContactHistoryEmpty">尚無聯繫紀錄</p>;
    }

    return (
      <ol className="trialAdminContactHistoryList">
        {history.map((record) => (
          <li key={record.id}>
            <div className="trialAdminContactHistoryMeta">
              <time dateTime={record.contacted_at}>{formatDateTime(record.contacted_at)}</time>
              <span>{record.operator_label}</span>
            </div>
            <pre className="trialAdminNoteText">{record.note}</pre>
          </li>
        ))}
      </ol>
    );
  }

  function renderLatestContact(booking: TrialBookingRow) {
    const latestContact = booking.contact_history?.[0];
    if (!latestContact) return null;

    return (
      <div className="trialAdminContactLatest">
        <dt>6. 最新聯繫紀錄</dt>
        <dd>
          <div className="trialAdminLatestContact" title={latestContact.note}>
            <strong>聯繫備註</strong>
            <span>{latestContact.note}</span>
            <small>{formatDateTime(latestContact.contacted_at)} · {latestContact.operator_label}</small>
          </div>
        </dd>
      </div>
    );
  }

  function renderStaffNote(booking: TrialBookingRow) {
    return (
      <div className="trialAdminContactLatest">
        <dt>5. 名單備註</dt>
        <dd>
          {booking.staff_note ? (
            <div className="trialAdminLatestContact" title={booking.staff_note}>
              <strong>內部備註</strong>
              <span>{booking.staff_note}</span>
              <small>{formatDateTime(booking.staff_note_updated_at)}</small>
            </div>
          ) : "-"}
        </dd>
      </div>
    );
  }

  function renderActions(booking: TrialBookingRow) {
    const isUpdating = updatingBookingId === booking.id;
    const status = lineStatus(booking);
    return (
      <div className="trialAdminActions" onClick={(event) => event.stopPropagation()}>
        <button className="trialAdminButton trialAdminButtonSmall" type="button" onClick={() => openStaffNoteModal(booking)} disabled={isUpdating}>
          名單備註
        </button>
        <button className="trialAdminButton trialAdminButtonSmall" type="button" onClick={() => openScheduleModal(booking)} disabled={isUpdating}>
          {booking.booking_status === "scheduled" ? "編輯安排" : "安排預約"}
        </button>
        {booking.booking_status === "scheduled" ? (
          <button className="trialAdminButton trialAdminButtonSmall" type="button" onClick={() => void resendLine(booking)} disabled={isUpdating}>
            {status === "not_sent" ? "發送 LINE" : "重新發送 LINE"}
          </button>
        ) : null}
        <span className={`trialAdminBadge is-line-${status}`}>{lineStatusLabels[status]}</span>
        {booking.line_notification_error ? <span className="trialAdminInlineMessage is-error">{booking.line_notification_error}</span> : null}
      </div>
    );
  }

  function toggleBookingDetails(bookingId: string) {
    setExpandedBookingId((current) => (current === bookingId ? null : bookingId));
  }

  function renderWaitlistStatusControl(item: BookingWaitlistRow) {
    const isUpdating = updatingWaitlistId === item.id;
    const message = waitlistRowMessages[item.id];

    return (
      <div className={`trialAdminStatusControl${isUpdating ? " trialAdminRowUpdating" : ""}`}>
        <select
          className="trialAdminStatusSelect"
          value={item.status}
          disabled={isUpdating}
          onChange={(event) => {
            void updateWaitlistStatus(item.id, event.target.value as WaitlistStatus);
          }}
          aria-label={`${item.contactName || "booking request"} 預約需求狀態`}
        >
          {waitlistStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={`trialAdminBadge is-${item.status}`}>{labelOrFallback(waitlistStatusLabels, item.status)}</span>
        {message ? (
          <span className={`trialAdminInlineMessage is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        ) : null}
      </div>
    );
  }

  const modalTitle = modalMode === "create" ? "新增體驗預約" : "安排體驗預約";

  return (
    <main className="trialAdminPage">
      <section className="trialAdminShell">
        <header className="trialAdminHeader">
          <div>
            <p className="trialAdminEyebrow">BIGE ADMIN</p>
            <h1>首次體驗預約管理</h1>
            <p>查看首次體驗預約、安排體驗時段，並統計各項預約來源。</p>
          </div>
          <div className="trialAdminHeaderActions">
            <button className="trialAdminButton" type="button" onClick={openCreateModal}>
              新增體驗預約
            </button>
            <button className="trialAdminButton" type="button" onClick={openFaHistory}>
              歷程未成交FA
            </button>
            <button
              className="trialAdminButton"
              type="button"
              onClick={() => {
                void loadBookings();
                if (SHOW_PUBLIC_BOOKING_REQUESTS) void loadWaitlist();
              }}
              disabled={isLoading || isWaitlistLoading}
            >
              {isLoading || isWaitlistLoading ? "讀取中" : "重新整理"}
            </button>
            <button className="trialAdminButton trialAdminButtonDanger" type="button" onClick={handleLogout} disabled={isLoggingOut}>
              {isLoggingOut ? "登出中..." : "登出"}
            </button>
          </div>
        </header>

        {logoutError ? <div className="trialAdminError">{logoutError}</div> : null}

        <section className="trialAdminStatsPanel" aria-label="體驗預約來源統計">
          <div className="trialAdminStatsFilters">
            <label className="trialAdminField">
              <span>{workflowGroup === "marketing_report" ? "統計開始日期" : "開始日期"}</span>
              <input type="date" value={statsFrom} onChange={(event) => setStatsFrom(event.target.value)} />
            </label>
            <label className="trialAdminField">
              <span>{workflowGroup === "marketing_report" ? "統計結束日期" : "結束日期"}</span>
              <input type="date" value={statsTo} onChange={(event) => setStatsTo(event.target.value)} />
            </label>
          </div>
          <div className="trialAdminStatsGrid">
            <article>
              <span>總預約筆數</span>
              <strong>{stats.total}</strong>
            </article>
            {workflowGroup !== "marketing_report" ? (
              <article>
                <span>網站</span>
                <strong>{stats.website}</strong>
              </article>
            ) : null}
            {workflowGroup === "marketing_report" ? (
              <article>
                <span>網站已安排</span>
                <strong>{stats.websiteScheduled}</strong>
              </article>
            ) : null}
            <article>
              <span>官方 LINE</span>
              <strong>{stats.officialLine}</strong>
            </article>
            <article className={workflowGroup === "marketing_report" ? "trialAdminStatsSecondRowStart" : undefined}>
              <span>現場</span>
              <strong>{stats.walkIn}</strong>
            </article>
            <article>
              <span>來電預約</span>
              <strong>{stats.phoneBooking}</strong>
            </article>
            <article>
              <span>BR</span>
              <strong>{stats.br}</strong>
            </article>
            {workflowGroup === "marketing_report" ? (
              <article>
                <span>網站登記</span>
                <strong>{stats.websiteRegistration}</strong>
              </article>
            ) : null}
          </div>
        </section>

        <section className="trialAdminFilters" aria-label="首次體驗預約篩選">
          <label className="trialAdminField">
            <span>搜尋</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋姓名 / 電話" maxLength={80} />
          </label>
          <label className="trialAdminField">
            <span>來源</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">全部</option>
              <option value="website">網站</option>
              <option value="official_line">官方 LINE</option>
              <option value="walk_in">現場</option>
              <option value="phone_booking">來電預約</option>
              <option value="br">BR</option>
            </select>
          </label>
          <label className="trialAdminField">
            <span>付款方式</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="">全部</option>
              <option value="cash_on_site">當天付現</option>
              <option value="online_payment">線上付款</option>
            </select>
          </label>
          <label className="trialAdminField">
            <span>付款狀態</span>
            <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
              <option value="">全部付款狀態</option>
              <option value="pending_cash">現場付款待確認</option>
              <option value="pending_payment">線上付款待付款</option>
              <option value="paid">已付款</option>
              <option value="failed">付款失敗</option>
              <option value="cancelled">付款已取消</option>
            </select>
          </label>
          <label className="trialAdminField">
            <span>處理分類</span>
            <select
              value={workflowGroup}
              onChange={(event) => setWorkflowGroup(event.target.value as "follow_up" | "processed" | "marketing_report")}
            >
              <option value="follow_up">待接續聯絡</option>
              <option value="processed">已處理（已安排或已有聯繫備註）</option>
              <option value="marketing_report">行銷統計回報</option>
            </select>
          </label>
        </section>

        {error ? <div className="trialAdminError">{error}</div> : null}

        {accessState === "unauthorized" ? (
          <section className="trialAdminAuthNotice">
            <h2>請先登入</h2>
            <p>請先登入後再查看首次體驗預約。</p>
            <a className="trialAdminLoginHint" href="/login/staff?returnTo=/admin/trial-bookings">
              前往登入
            </a>
          </section>
        ) : null}

        {accessState === "forbidden" ? (
          <section className="trialAdminAuthNotice trialAdminForbidden">
            <h2>無權限</h2>
            <p>此頁面僅限管理者查看。</p>
          </section>
        ) : null}

        {accessState === "unauthorized" || accessState === "forbidden" ? null : isLoading ? (
          <div className="trialAdminEmpty">正在讀取首次體驗預約資料。</div>
        ) : !error && bookings.length === 0 ? (
          <div className="trialAdminEmpty">目前沒有符合條件的首次體驗預約。</div>
        ) : !error ? (
          <>
            <div className="trialAdminTableWrap">
              <table className="trialAdminTable trialAdminRequestTable">
                <colgroup>
                  <col className="trialAdminColService" />
                  <col className="trialAdminColPreferredTime" />
                  <col className="trialAdminColContact" />
                  <col className="trialAdminColAction" />
                </colgroup>
                <thead>
                  <tr>
                    <th><span className="trialAdminColumnNumber">01</span>體驗項目</th>
                    <th><span className="trialAdminColumnNumber">02</span>方便時段</th>
                    <th><span className="trialAdminColumnNumber">03</span>聯絡方式</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => {
                    const bookingSource = normalizeSource(booking.source);
                    const isExpanded = expandedBookingId === booking.id;
                    return (
                      <Fragment key={booking.id}>
                        <tr
                          className={`trialAdminBookingSummaryRow${isExpanded ? " is-expanded" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onClick={() => toggleBookingDetails(booking.id)}
                          onKeyDown={(event) => {
                            if (event.currentTarget !== event.target) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleBookingDetails(booking.id);
                            }
                          }}
                        >
                          <td>
                            <div className="trialAdminRequestValue">
                              <strong>{labelOrFallback(serviceLabels, booking.service)}</strong>
                              <span className="trialAdminExpandHint">
                                {isExpanded ? "收合其他資訊" : "點擊查看其他資訊"}
                                <span className="trialAdminExpandChevron" aria-hidden="true">⌄</span>
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="trialAdminRequestValue">
                              <strong>{labelOrFallback(preferredTimeLabels, booking.preferred_time)}</strong>
                            </div>
                          </td>
                          <td>
                            <dl className="trialAdminContactGrid">
                              <div>
                                <dt>1. 姓名</dt>
                                <dd>{booking.name || "-"}</dd>
                              </div>
                              <div>
                                <dt>2. 電話</dt>
                                <dd>{booking.phone || "-"}</dd>
                              </div>
                              <div>
                                <dt>3. 生日</dt>
                                <dd>{formatDate(booking.birthday)}</dd>
                              </div>
                              <div className="trialAdminContactNote">
                                <dt>4. 備註</dt>
                                <dd><pre className="trialAdminNoteText">{booking.note || "-"}</pre></dd>
                              </div>
                              {renderStaffNote(booking)}
                              {renderLatestContact(booking)}
                            </dl>
                          </td>
                          <td className="trialAdminOperationCell" onClick={(event) => event.stopPropagation()}>
                            {renderActions(booking)}
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="trialAdminDetailsRow">
                            <td className="trialAdminDetailsCell" colSpan={4}>
                              <div className="trialAdminDetailsGrid">
                                <section className="trialAdminDetailPanel">
                                  <h3>預約安排</h3>
                                  <dl>
                                    <div><dt>已安排時間</dt><dd>{formatDate(booking.appointment_date)} {booking.appointment_time || ""}</dd></div>
                                    <div><dt>預約教練</dt><dd>{booking.booking_coach || "-"}</dd></div>
                                    <div><dt>執行教練</dt><dd>{booking.executing_coach || "-"}</dd></div>
                                  </dl>
                                </section>
                                <section className="trialAdminDetailPanel">
                                  <h3>付款資訊</h3>
                                  <div className="trialAdminDetailStatusLine">
                                    <span>{labelOrFallback(paymentMethodLabels, booking.payment_method)}</span>
                                    <span className={`trialAdminBadge is-${booking.payment_status}`}>
                                      {labelOrFallback(paymentStatusLabels, booking.payment_status)}
                                    </span>
                                  </div>
                                  {renderPaymentManagement(booking)}
                                </section>
                                <section className="trialAdminDetailPanel">
                                  <h3>處理狀態</h3>
                                  {renderStatusControl(booking)}
                                </section>
                                <section className="trialAdminDetailPanel">
                                  <h3>其他資訊</h3>
                                  <dl>
                                    <div><dt>來源</dt><dd>{sourceLabels[bookingSource]}</dd></div>
                                    <div><dt>建立時間</dt><dd>{formatDateTime(booking.created_at)}</dd></div>
                                    <div><dt>最後更新</dt><dd>{formatDateTime(booking.updated_at)}</dd></div>
                                    <div><dt>LINE 通知</dt><dd>{lineStatusLabels[lineStatus(booking)]}</dd></div>
                                    <div><dt>LINE 發送時間</dt><dd>{formatDateTime(booking.line_notified_at)}</dd></div>
                                    {booking.line_notification_error ? <div><dt>LINE 錯誤</dt><dd>{booking.line_notification_error}</dd></div> : null}
                                  </dl>
                                </section>
                                {booking.contact_history?.length ? (
                                  <section className="trialAdminDetailPanel trialAdminContactHistoryPanel">
                                    <h3>聯繫紀錄</h3>
                                    {renderContactHistory(booking)}
                                  </section>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="trialAdminMobileList">
              {bookings.map((booking) => {
                const bookingSource = normalizeSource(booking.source);
                const isExpanded = expandedBookingId === booking.id;
                return (
                  <article className="trialAdminMobileCard" key={booking.id}>
                    <div
                      className="trialAdminMobileRequestSummary"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={() => toggleBookingDetails(booking.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleBookingDetails(booking.id);
                        }
                      }}
                    >
                      <div><span>01 體驗項目</span><strong>{labelOrFallback(serviceLabels, booking.service)}</strong></div>
                      <div><span>02 方便時段</span><strong>{labelOrFallback(preferredTimeLabels, booking.preferred_time)}</strong></div>
                      <div className="trialAdminMobileContactSummary">
                        <span>03 聯絡方式</span>
                        <dl className="trialAdminContactGrid">
                          <div><dt>1. 姓名</dt><dd>{booking.name || "-"}</dd></div>
                          <div><dt>2. 電話</dt><dd>{booking.phone || "-"}</dd></div>
                          <div><dt>3. 生日</dt><dd>{formatDate(booking.birthday)}</dd></div>
                          <div className="trialAdminContactNote"><dt>4. 備註</dt><dd><pre className="trialAdminNoteText">{booking.note || "-"}</pre></dd></div>
                          {renderStaffNote(booking)}
                          {renderLatestContact(booking)}
                        </dl>
                      </div>
                      <span className="trialAdminExpandHint">{isExpanded ? "收合其他資訊" : "點擊查看其他資訊"}</span>
                    </div>
                    <div className="trialAdminMobileActions">{renderActions(booking)}</div>
                    {isExpanded ? (
                      <div className="trialAdminMobileDetails">
                        <dl>
                          <div><dt>預約時間</dt><dd>{formatDate(booking.appointment_date)} {booking.appointment_time || ""}</dd></div>
                          <div><dt>預約教練</dt><dd>{booking.booking_coach || "-"}</dd></div>
                          <div><dt>執行教練</dt><dd>{booking.executing_coach || "-"}</dd></div>
                          <div><dt>來源</dt><dd>{sourceLabels[bookingSource]}</dd></div>
                          <div><dt>建立時間</dt><dd>{formatDateTime(booking.created_at)}</dd></div>
                          <div><dt>LINE</dt><dd>{lineStatusLabels[lineStatus(booking)]}</dd></div>
                          <div className="trialAdminMobilePayment"><dt>付款資訊</dt><dd>{renderPaymentManagement(booking)}</dd></div>
                          <div className="trialAdminMobileNote"><dt>處理狀態</dt><dd>{renderStatusControl(booking)}</dd></div>
                          <div className="trialAdminMobileNote"><dt>聯繫紀錄</dt><dd>{renderContactHistory(booking)}</dd></div>
                        </dl>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {!SHOW_PUBLIC_BOOKING_REQUESTS || accessState === "unauthorized" || accessState === "forbidden" ? null : (
          <section className="trialAdminSection">
            <div className="trialAdminSectionHeader">
              <div>
                <h2>公開預約需求</h2>
                <p>顯示未登入訪客送出的預約需求，請由櫃台或管理人員主動聯繫確認實際時間。</p>
              </div>
              <button className="trialAdminButton" type="button" onClick={loadWaitlist} disabled={isWaitlistLoading}>
                {isWaitlistLoading ? "讀取中" : "重新整理需求"}
              </button>
            </div>

            {waitlistError ? <div className="trialAdminError">{waitlistError}</div> : null}

            {isWaitlistLoading ? (
              <div className="trialAdminEmpty">正在讀取公開預約需求。</div>
            ) : !waitlistError && waitlistItems.length === 0 ? (
              <div className="trialAdminEmpty">目前沒有公開預約需求。</div>
            ) : !waitlistError ? (
              <>
                <div className="trialAdminTableWrap">
                  <table className="trialAdminTable">
                    <thead>
                      <tr>
                        <th>送出時間</th>
                        <th>姓名</th>
                        <th>手機</th>
                        <th>狀態</th>
                        <th>備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waitlistItems.map((item) => (
                        <tr key={item.id}>
                          <td>{formatDateTime(item.createdAt)}</td>
                          <td>{item.contactName || "-"}</td>
                          <td>{item.contactPhone || "-"}</td>
                          <td>{renderWaitlistStatusControl(item)}</td>
                          <td>
                            <pre className="trialAdminNoteText">{item.note || "-"}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="trialAdminMobileList">
                  {waitlistItems.map((item) => (
                    <article className="trialAdminMobileCard" key={item.id}>
                      <div className="trialAdminMobileCardHeader">
                        <div>
                          <strong>{item.contactName || "-"}</strong>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                        {renderWaitlistStatusControl(item)}
                      </div>
                      <dl>
                        <div>
                          <dt>手機</dt>
                          <dd>{item.contactPhone || "-"}</dd>
                        </div>
                        <div className="trialAdminMobileNote">
                          <dt>備註</dt>
                          <dd>
                            <pre className="trialAdminNoteText">{item.note || "-"}</pre>
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        )}
      </section>

      {isFaHistoryOpen ? (
        <div className="trialAdminModalBackdrop" role="presentation">
          <section
            className="trialAdminModal trialAdminFaHistoryModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-fa-history-title"
          >
            <header className="trialAdminModalHeader trialAdminFaHistoryHeader">
              <div>
                <p className="trialAdminEyebrow">FA HISTORY</p>
                <h2 id="trial-fa-history-title">歷程未成交 FA</h2>
                <p>
                  資料來自日排課表中已完成，並明確選擇「未成交」的 FA 紀錄。
                </p>
              </div>
              <button className="trialAdminButton trialAdminButtonSmall" type="button" onClick={closeFaHistory}>
                關閉
              </button>
            </header>

            <div className="trialAdminFaHistoryToolbar">
              <label className="trialAdminField">
                <span>搜尋歷程</span>
                <input
                  value={faHistorySearch}
                  onChange={(event) => setFaHistorySearch(event.target.value)}
                  placeholder="姓名、電話、教練或體驗項目"
                  maxLength={80}
                />
              </label>
              <div className="trialAdminFaHistorySummary">
                <span>
                  {faHistorySearch.trim()
                    ? `符合 ${filteredFaHistoryItems.length} 筆／共 ${faHistoryItems.length} 筆`
                    : `共 ${faHistoryItems.length} 筆`}
                </span>
                <button
                  className="trialAdminButton trialAdminButtonSmall"
                  type="button"
                  onClick={() => void loadFaHistory()}
                  disabled={isFaHistoryLoading}
                >
                  {isFaHistoryLoading ? "讀取中" : "重新整理"}
                </button>
              </div>
            </div>

            {faHistoryError ? (
              <div className="trialAdminError" role="alert">{faHistoryError}</div>
            ) : null}

            {isFaHistoryLoading ? (
              <div className="trialAdminEmpty">正在讀取日排課表的未成交 FA 紀錄。</div>
            ) : !faHistoryError && filteredFaHistoryItems.length === 0 ? (
              <div className="trialAdminEmpty">
                {faHistorySearch.trim() ? "沒有符合搜尋條件的未成交 FA。" : "目前沒有已記錄為未成交的 FA。"}
              </div>
            ) : !faHistoryError ? (
              <div className="trialAdminFaHistoryList">
                {filteredFaHistoryItems.map((item) => {
                  const sourceLabel = item.source
                    ? sourceLabels[normalizeTrialBookingSource(item.source)]
                    : "-";
                  const notes = [
                    { label: "客人原始備註", value: item.originalNote },
                    { label: "安排備註", value: item.scheduleNote },
                    { label: "日排課表備註", value: item.operationNote },
                  ].filter((note) => note.value?.trim());

                  return (
                    <article className="trialAdminFaHistoryCard" key={item.id}>
                      <header>
                        <div>
                          <span>體驗日期時間</span>
                          <strong>{formatAppointmentPeriod(item.startsAt, item.endsAt)}</strong>
                        </div>
                        <span className="trialAdminFaHistoryOutcome">未成交</span>
                      </header>

                      <dl className="trialAdminFaHistoryDetails">
                        <div><dt>姓名</dt><dd>{item.name}</dd></div>
                        <div><dt>電話</dt><dd>{item.phone || "-"}</dd></div>
                        <div><dt>生日</dt><dd>{formatDate(item.birthday)}</dd></div>
                        <div><dt>體驗項目</dt><dd>{labelOrFallback(serviceLabels, item.service)}</dd></div>
                        <div><dt>FA 階段</dt><dd>{item.trialStage || "-"}</dd></div>
                        <div><dt>來源</dt><dd>{sourceLabel}</dd></div>
                        <div><dt>預約教練</dt><dd>{item.bookingCoach || "-"}</dd></div>
                        <div><dt>執行教練</dt><dd>{item.executingCoach || "-"}</dd></div>
                        <div><dt>原預約時間</dt><dd>{formatDate(item.originalAppointmentDate)} {item.originalAppointmentTime || ""}</dd></div>
                        <div><dt>記錄未成交時間</dt><dd>{formatDateTime(item.recordedAt)}</dd></div>
                        {item.memberCode ? <div><dt>會員編號</dt><dd>{item.memberCode}</dd></div> : null}
                      </dl>

                      {notes.length > 0 ? (
                        <div className="trialAdminFaHistoryNotes">
                          {notes.map((note) => (
                            <section key={note.label}>
                              <span>{note.label}</span>
                              <pre className="trialAdminNoteText">{note.value}</pre>
                            </section>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {modalMode ? (
        <div className="trialAdminModalBackdrop" role="presentation">
          <section className="trialAdminModal" role="dialog" aria-modal="true" aria-labelledby="trial-admin-modal-title">
            <header className="trialAdminModalHeader">
              <div>
                <p className="trialAdminEyebrow">TRIAL BOOKING</p>
                <h2 id="trial-admin-modal-title">{modalTitle}</h2>
              </div>
              <button className="trialAdminButton trialAdminButtonSmall" type="button" onClick={closeModal} disabled={isSavingSchedule}>
                關閉
              </button>
            </header>

            <div className="trialAdminModalGrid">
              <label className="trialAdminField">
                <span>預約日期</span>
                <input type="date" value={scheduleForm.appointmentDate} onChange={(event) => updateScheduleField("appointmentDate", event.target.value)} />
              </label>
              <label className="trialAdminField">
                <span>預約時間</span>
                <select value={scheduleForm.appointmentTime} onChange={(event) => updateScheduleField("appointmentTime", event.target.value)}>
                  {appointmentTimeOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trialAdminField">
                <span>預約項目</span>
                <select value={scheduleForm.service} onChange={(event) => updateScheduleField("service", event.target.value)}>
                  {serviceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trialAdminField">
                <span>姓名</span>
                <input value={scheduleForm.name} onChange={(event) => updateScheduleField("name", event.target.value)} maxLength={50} />
              </label>
              <label className="trialAdminField">
                <span>電話</span>
                <input value={scheduleForm.phone} onChange={(event) => updateScheduleField("phone", event.target.value)} maxLength={30} />
              </label>
              <label className="trialAdminField">
                <span>預約教練</span>
                <select value={scheduleForm.bookingCoach} onChange={(event) => updateScheduleField("bookingCoach", event.target.value)}>
                  <option value="">請選擇預約教練</option>
                  {scheduleForm.bookingCoach && !bookingCoachOptions.includes(scheduleForm.bookingCoach) ? (
                    <option value={scheduleForm.bookingCoach}>{scheduleForm.bookingCoach}</option>
                  ) : null}
                  {bookingCoachOptions.map((coach) => (
                    <option key={coach} value={coach}>
                      {coach}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trialAdminField">
                <span>執行教練</span>
                <select
                  value={scheduleForm.executingCoachId}
                  disabled={isLoadingCoaches || coachOptions.length === 0}
                  onChange={(event) => updateExecutingCoach(event.target.value)}
                >
                  <option value="">
                    {isLoadingCoaches
                      ? "正在讀取教練名單..."
                      : coachOptionsError
                        ? "教練名單讀取失敗"
                        : "請選擇執行教練"}
                  </option>
                  {coachOptions.map((coach) => (
                    <option key={coach.id} value={coach.id}>
                      {coach.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trialAdminField">
                <span>來源</span>
                {modalMode === "schedule" ? (
                  <input value={sourceLabels[normalizeSource(activeBooking?.source)]} disabled readOnly />
                ) : (
                  <select value={scheduleForm.source} onChange={(event) => updateScheduleField("source", event.target.value as BookingSource)}>
                    <option value="website">網站</option>
                    <option value="official_line">官方 LINE</option>
                    <option value="walk_in">現場</option>
                    <option value="phone_booking">來電預約</option>
                    <option value="br">BR</option>
                  </select>
                )}
              </label>
              {modalMode === "schedule" ? (
                <div className="trialAdminContactOriginalNote trialAdminModalNote">
                  <span>客人原始備註（唯讀，不會被安排資料修改）</span>
                  <pre className="trialAdminNoteText">{activeBooking?.note || "-"}</pre>
                </div>
              ) : null}
              <label className="trialAdminField trialAdminModalNote">
                <span>{modalMode === "schedule" ? "安排備註" : "備註"}</span>
                <textarea
                  value={scheduleForm.note}
                  onChange={(event) => updateScheduleField("note", event.target.value)}
                  maxLength={500}
                  placeholder={modalMode === "schedule" ? "填寫本次安排資訊；不會覆蓋客人原始備註。" : undefined}
                />
              </label>
            </div>

            {modalError ? <div className="trialAdminError">{modalError}</div> : null}

            <footer className="trialAdminModalFooter">
              <button className="trialAdminButton" type="button" onClick={submitSchedule} disabled={isSavingSchedule}>
                {isSavingSchedule ? "儲存中..." : "送出"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {contactModalBooking ? (
        <div className="trialAdminModalBackdrop" role="presentation">
          <section
            className="trialAdminModal trialAdminContactModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-contact-modal-title"
          >
            <header className="trialAdminModalHeader">
              <div>
                <p className="trialAdminEyebrow">CONTACT RECORD</p>
                <h2 id="trial-contact-modal-title">新增聯繫紀錄</h2>
                <p className="trialAdminContactModalCustomer">
                  {contactModalBooking.name || "未填姓名"} · {contactModalBooking.phone || "未填電話"}
                </p>
              </div>
              <button
                className="trialAdminButton trialAdminButtonSmall"
                type="button"
                onClick={closeContactModal}
                disabled={isSavingContact}
              >
                取消
              </button>
            </header>

            <div className="trialAdminContactOriginalNote">
              <span>客人原始備註</span>
              <pre className="trialAdminNoteText">{contactModalBooking.note || "-"}</pre>
            </div>

            <label className="trialAdminField">
              <span>本次聯繫備註（必填）</span>
              <textarea
                value={contactNote}
                onChange={(event) => {
                  setContactNote(event.target.value);
                  setContactModalError("");
                }}
                maxLength={500}
                rows={6}
                autoFocus
                placeholder="例如：已電話聯繫，客人希望週三晚上再確認時間。"
              />
              <small className="trialAdminContactNoteCount">{contactNote.length}/500</small>
            </label>

            {contactModalError ? <div className="trialAdminError" role="alert">{contactModalError}</div> : null}

            <footer className="trialAdminModalFooter">
              <button
                className="trialAdminButton"
                type="button"
                onClick={submitContactNote}
                disabled={isSavingContact || !contactNote.trim()}
              >
                {isSavingContact ? "儲存中..." : "儲存並標示已聯繫"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {staffNoteModalBooking ? (
        <div className="trialAdminModalBackdrop" role="presentation">
          <section
            className="trialAdminModal trialAdminContactModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trial-staff-note-modal-title"
          >
            <header className="trialAdminModalHeader">
              <div>
                <p className="trialAdminEyebrow">INTERNAL NOTE</p>
                <h2 id="trial-staff-note-modal-title">名單備註</h2>
                <p className="trialAdminContactModalCustomer">
                  {staffNoteModalBooking.name || "未填姓名"} · {staffNoteModalBooking.phone || "未填電話"}
                </p>
              </div>
              <button
                className="trialAdminButton trialAdminButtonSmall"
                type="button"
                onClick={closeStaffNoteModal}
                disabled={isSavingStaffNote}
              >
                取消
              </button>
            </header>

            <div className="trialAdminContactOriginalNote">
              <span>客人原始備註</span>
              <pre className="trialAdminNoteText">{staffNoteModalBooking.note || "-"}</pre>
            </div>

            <p className="trialAdminContactModalCustomer">
              此處只儲存內部備註，不會標示已聯繫，也不會把名單移出「待接續聯絡」。
            </p>

            <label className="trialAdminField">
              <span>內部備註（可留空以清除）</span>
              <textarea
                value={staffNote}
                onChange={(event) => {
                  setStaffNote(event.target.value);
                  setStaffNoteModalError("");
                }}
                maxLength={500}
                rows={6}
                autoFocus
                placeholder="例如：偏好晚上聯絡、家人共同決定，後續仍需追蹤。"
              />
              <small className="trialAdminContactNoteCount">{staffNote.length}/500</small>
            </label>

            {staffNoteModalError ? <div className="trialAdminError" role="alert">{staffNoteModalError}</div> : null}

            <footer className="trialAdminModalFooter">
              <button
                className="trialAdminButton"
                type="button"
                onClick={submitStaffNote}
                disabled={isSavingStaffNote}
              >
                {isSavingStaffNote ? "儲存中..." : "儲存備註"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
