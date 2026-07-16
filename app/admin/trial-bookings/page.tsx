"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentMethod = "cash_on_site" | "online_payment";
type PaymentStatus = "pending_cash" | "pending_payment" | "paid" | "failed" | "cancelled";
type BookingStatus = "new" | "contacted" | "scheduled" | "completed" | "cancelled" | "no_show";
type WaitlistStatus = "pending" | "contacted" | "booked" | "cancelled";
type BookingSource = "website" | "official_line" | "walk_in";
type LineNotificationStatus = "not_sent" | "sent" | "failed";

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
  updated_at: string | null;
};

type TrialBookingStats = {
  total: number;
  website: number;
  officialLine: number;
  walkIn: number;
};

type TrialBookingResponse = {
  ok?: boolean;
  bookings?: TrialBookingRow[];
  stats?: TrialBookingStats;
  error?: string;
};

type TrialBookingMutationResponse = {
  ok?: boolean;
  booking?: TrialBookingRow;
  lineNotification?: "sent" | "failed" | "not_sent";
  message?: string;
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

type ScheduleFormData = {
  appointmentDate: string;
  appointmentTime: string;
  service: string;
  name: string;
  phone: string;
  bookingCoach: string;
  executingCoach: string;
  source: BookingSource;
  note: string;
};

const serviceLabels: Record<string, string> = {
  weight_training: "重量訓練",
  boxing_fitness: "拳擊體能訓練",
  pilates: "器械皮拉提斯",
  sports_massage: "運動按摩",
};

const serviceOptions = [
  { value: "weight_training", label: "重量訓練" },
  { value: "boxing_fitness", label: "拳擊體能訓練" },
  { value: "pilates", label: "器械皮拉提斯" },
  { value: "sports_massage", label: "運動按摩" },
];

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
  paid: "線上付款已付款",
  failed: "付款失敗",
  cancelled: "已取消",
};

const bookingStatusLabels: Record<BookingStatus, string> = {
  new: "待聯絡",
  contacted: "已聯繫",
  scheduled: "已安排",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "未到場",
};

const bookingStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "new", label: "待聯絡" },
  { value: "contacted", label: "已聯繫" },
  { value: "scheduled", label: "已安排" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "no_show", label: "未到場" },
];

const unscheduledStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "new", label: "待聯絡" },
  { value: "contacted", label: "已聯繫" },
  { value: "cancelled", label: "已取消" },
];

const scheduledStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "scheduled", label: "已安排" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "no_show", label: "未到場" },
];

const sourceLabels: Record<BookingSource, string> = {
  website: "網站",
  official_line: "官方 LINE",
  walk_in: "現場",
};

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

const emptyStats: TrialBookingStats = {
  total: 0,
  website: 0,
  officialLine: 0,
  walkIn: 0,
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
    executingCoach: "",
    source: "official_line",
    note: "",
  };
}

function formFromBooking(booking: TrialBookingRow): ScheduleFormData {
  return {
    appointmentDate: booking.appointment_date || todayDateInputValue(),
    appointmentTime: booking.appointment_time || "16:00",
    service: booking.service || "pilates",
    name: booking.name || "",
    phone: booking.phone || "",
    bookingCoach: booking.booking_coach || "",
    executingCoach: booking.executing_coach || "",
    source: "website",
    note: booking.note || "",
  };
}

function normalizeSource(value: TrialBookingRow["source"] | undefined): BookingSource {
  if (value === "official_line" || value === "walk_in") return value;
  return "website";
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
  const [bookingStatus, setBookingStatus] = useState("");
  const [source, setSource] = useState("");
  const [statsFrom, setStatsFrom] = useState(defaultStatsFrom);
  const [statsTo, setStatsTo] = useState(todayDateInputValue);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessState, setAccessState] = useState<TrialAdminAccessState>("checking");
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);
  const [isWaitlistLoading, setIsWaitlistLoading] = useState(true);
  const [waitlistError, setWaitlistError] = useState("");
  const [updatingWaitlistId, setUpdatingWaitlistId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [waitlistRowMessages, setWaitlistRowMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [modalMode, setModalMode] = useState<"create" | "schedule" | null>(null);
  const [activeBooking, setActiveBooking] = useState<TrialBookingRow | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormData>(initialScheduleForm);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [modalError, setModalError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set("q", trimmedSearch.slice(0, 80));
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    if (bookingStatus) params.set("bookingStatus", bookingStatus);
    if (source) params.set("source", source);
    if (statsFrom) params.set("statsFrom", statsFrom);
    if (statsTo) params.set("statsTo", statsTo);
    return params.toString();
  }, [bookingStatus, paymentMethod, paymentStatus, search, source, statsFrom, statsTo]);

  const loadBookings = useCallback(async () => {
    setIsLoading(true);
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
          router.replace("/login?tab=staff&returnTo=/admin/trial-bookings");
        } else if (response.status === 403) {
          setAccessState("forbidden");
          setError("此頁面僅限管理者查看。");
        } else {
          setAccessState("allowed");
          setError(payload?.error || "無法讀取首次體驗預約資料。");
        }
        setBookings([]);
        setStats(emptyStats);
        return;
      }

      setAccessState("allowed");
      setBookings(payload.bookings || []);
      setStats(payload.stats || emptyStats);
    } catch {
      setError("讀取資料時發生錯誤，請稍後再試。");
      setBookings([]);
      setStats(emptyStats);
    } finally {
      setIsLoading(false);
    }
  }, [queryString, router]);

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
    void loadWaitlist();
  }, [loadBookings, loadWaitlist]);

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
    if (!current || current.booking_status === nextStatus || updatingBookingId) return;
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

      setBookings((currentBookings) =>
        currentBookings.map((booking) =>
          booking.id === bookingId ? { ...booking, booking_status: payload.booking!.booking_status } : booking,
        ),
      );
      setRowMessages((messages) => ({ ...messages, [bookingId]: { type: "success", text: "已更新" } }));
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

  function openCreateModal() {
    setModalMode("create");
    setActiveBooking(null);
    setScheduleForm(initialScheduleForm());
    setModalError("");
  }

  function openScheduleModal(booking: TrialBookingRow) {
    setModalMode("schedule");
    setActiveBooking(booking);
    setScheduleForm(formFromBooking(booking));
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

  function validateScheduleForm() {
    if (!scheduleForm.appointmentDate || !scheduleForm.appointmentTime || !scheduleForm.service) return false;
    if (!scheduleForm.name.trim() || !scheduleForm.phone.trim()) return false;
    if (!scheduleForm.bookingCoach.trim() || !scheduleForm.executingCoach.trim()) return false;
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
          executingCoach: scheduleForm.executingCoach,
          source: scheduleForm.source,
          note: scheduleForm.note,
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
        {message ? (
          <span className={`trialAdminInlineMessage is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        ) : null}
      </div>
    );
  }

  function renderActions(booking: TrialBookingRow) {
    const isUpdating = updatingBookingId === booking.id;
    const status = lineStatus(booking);
    return (
      <div className="trialAdminActions">
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
            <p>查看官網首次體驗預約、安排體驗時段，並統計網站、官方 LINE 與現場來源。</p>
          </div>
          <div className="trialAdminHeaderActions">
            <button className="trialAdminButton" type="button" onClick={openCreateModal}>
              新增體驗預約
            </button>
            <button
              className="trialAdminButton"
              type="button"
              onClick={() => {
                void loadBookings();
                void loadWaitlist();
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
              <span>開始日期</span>
              <input type="date" value={statsFrom} onChange={(event) => setStatsFrom(event.target.value)} />
            </label>
            <label className="trialAdminField">
              <span>結束日期</span>
              <input type="date" value={statsTo} onChange={(event) => setStatsTo(event.target.value)} />
            </label>
          </div>
          <div className="trialAdminStatsGrid">
            <article>
              <span>總預約筆數</span>
              <strong>{stats.total}</strong>
            </article>
            <article>
              <span>網站</span>
              <strong>{stats.website}</strong>
            </article>
            <article>
              <span>官方 LINE</span>
              <strong>{stats.officialLine}</strong>
            </article>
            <article>
              <span>現場</span>
              <strong>{stats.walkIn}</strong>
            </article>
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
              <option value="">全部</option>
              <option value="pending_cash">現場付款待確認</option>
              <option value="pending_payment">線上付款待付款</option>
              <option value="paid">線上付款已付款</option>
              <option value="failed">付款失敗</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <label className="trialAdminField">
            <span>預約狀態</span>
            <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value)}>
              <option value="">全部</option>
              {bookingStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {error ? <div className="trialAdminError">{error}</div> : null}

        {accessState === "unauthorized" ? (
          <section className="trialAdminAuthNotice">
            <h2>請先登入</h2>
            <p>請先登入後再查看首次體驗預約。</p>
            <a className="trialAdminLoginHint" href="/login?tab=staff&returnTo=/admin/trial-bookings">
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
              <table className="trialAdminTable">
                <thead>
                  <tr>
                    <th>建立時間</th>
                    <th>預約時間</th>
                    <th>姓名</th>
                    <th>電話</th>
                    <th>體驗項目</th>
                    <th>來源</th>
                    <th>教練</th>
                    <th>付款</th>
                    <th>預約狀態</th>
                    <th>LINE</th>
                    <th>備註</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => {
                    const bookingSource = normalizeSource(booking.source);
                    return (
                      <tr key={booking.id}>
                        <td>{formatDateTime(booking.created_at)}</td>
                        <td>
                          <div className="trialAdminCompactStack">
                            <strong>{formatDate(booking.appointment_date)}</strong>
                            <span>{booking.appointment_time || "-"}</span>
                            <span>方便時段：{labelOrFallback(preferredTimeLabels, booking.preferred_time)}</span>
                          </div>
                        </td>
                        <td>{booking.name || "-"}</td>
                        <td>{booking.phone || "-"}</td>
                        <td>{labelOrFallback(serviceLabels, booking.service)}</td>
                        <td>{sourceLabels[bookingSource]}</td>
                        <td>
                          <div className="trialAdminCompactStack">
                            <span>預約：{booking.booking_coach || "-"}</span>
                            <span>執行：{booking.executing_coach || "-"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="trialAdminCompactStack">
                            <span>{labelOrFallback(paymentMethodLabels, booking.payment_method)}</span>
                            <span className={`trialAdminBadge is-${booking.payment_status}`}>
                              {labelOrFallback(paymentStatusLabels, booking.payment_status)}
                            </span>
                            {renderPaymentDetails(booking)}
                          </div>
                        </td>
                        <td>{renderStatusControl(booking)}</td>
                        <td>
                          <div className="trialAdminCompactStack">
                            <span className={`trialAdminBadge is-line-${lineStatus(booking)}`}>{lineStatusLabels[lineStatus(booking)]}</span>
                            <span>{formatDateTime(booking.line_notified_at)}</span>
                          </div>
                        </td>
                        <td>
                          <pre className="trialAdminNoteText">{booking.note || "-"}</pre>
                        </td>
                        <td>{renderActions(booking)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="trialAdminMobileList">
              {bookings.map((booking) => {
                const bookingSource = normalizeSource(booking.source);
                return (
                  <article className="trialAdminMobileCard" key={booking.id}>
                    <div className="trialAdminMobileCardHeader">
                      <div>
                        <strong>{booking.name || "-"}</strong>
                        <span>{formatDateTime(booking.created_at)}</span>
                      </div>
                      {renderStatusControl(booking)}
                    </div>
                    <dl>
                      <div>
                        <dt>電話</dt>
                        <dd>{booking.phone || "-"}</dd>
                      </div>
                      <div>
                        <dt>來源</dt>
                        <dd>{sourceLabels[bookingSource]}</dd>
                      </div>
                      <div>
                        <dt>預約時間</dt>
                        <dd>
                          {formatDate(booking.appointment_date)} {booking.appointment_time || ""}
                        </dd>
                      </div>
                      <div>
                        <dt>體驗項目</dt>
                        <dd>{labelOrFallback(serviceLabels, booking.service)}</dd>
                      </div>
                      <div>
                        <dt>預約教練</dt>
                        <dd>{booking.booking_coach || "-"}</dd>
                      </div>
                      <div>
                        <dt>執行教練</dt>
                        <dd>{booking.executing_coach || "-"}</dd>
                      </div>
                      <div>
                        <dt>LINE</dt>
                        <dd>{lineStatusLabels[lineStatus(booking)]}</dd>
                      </div>
                      <div className="trialAdminMobilePayment">
                        <dt>付款資訊</dt>
                        <dd>{renderPaymentDetails(booking)}</dd>
                      </div>
                      <div className="trialAdminMobileNote">
                        <dt>備註</dt>
                        <dd>
                          <pre className="trialAdminNoteText">{booking.note || "-"}</pre>
                        </dd>
                      </div>
                      <div className="trialAdminMobileNote">
                        <dt>操作</dt>
                        <dd>{renderActions(booking)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {accessState === "unauthorized" || accessState === "forbidden" ? null : (
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
                <input type="time" value={scheduleForm.appointmentTime} onChange={(event) => updateScheduleField("appointmentTime", event.target.value)} />
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
                <input value={scheduleForm.bookingCoach} onChange={(event) => updateScheduleField("bookingCoach", event.target.value)} maxLength={50} />
              </label>
              <label className="trialAdminField">
                <span>執行教練</span>
                <input value={scheduleForm.executingCoach} onChange={(event) => updateScheduleField("executingCoach", event.target.value)} maxLength={50} />
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
                  </select>
                )}
              </label>
              <label className="trialAdminField trialAdminModalNote">
                <span>備註</span>
                <textarea value={scheduleForm.note} onChange={(event) => updateScheduleField("note", event.target.value)} maxLength={500} />
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
    </main>
  );
}
