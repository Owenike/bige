"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PaymentMethod = "cash_on_site" | "online_payment";
type PaymentStatus = "pending_cash" | "pending_payment" | "paid" | "failed" | "cancelled";
type BookingStatus = "new" | "contacted" | "scheduled" | "completed" | "cancelled";

type TrialBookingRow = {
  id: string;
  created_at: string;
  name: string;
  phone: string;
  line_name: string | null;
  service: string;
  preferred_time: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  booking_status: BookingStatus;
  note: string | null;
};

type TrialBookingResponse = {
  ok?: boolean;
  bookings?: TrialBookingRow[];
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

const serviceLabels: Record<string, string> = {
  weight_training: "重量訓練",
  boxing_fitness: "拳擊體能訓練",
  pilates: "器械皮拉提斯",
  sports_massage: "運動按摩",
};

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
  pending_payment: "線上付款待處理",
  paid: "已付款",
  failed: "付款失敗",
  cancelled: "已取消",
};

const bookingStatusLabels: Record<BookingStatus, string> = {
  new: "新預約",
  contacted: "已聯繫",
  scheduled: "已安排",
  completed: "已完成",
  cancelled: "已取消",
};

const bookingStatusOptions: Array<{ value: BookingStatus; label: string }> = [
  { value: "new", label: "新預約" },
  { value: "contacted", label: "已聯繫" },
  { value: "scheduled", label: "已安排" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function labelOrFallback(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return "-";
  return labels[value] || value;
}

export default function TrialBookingsAdminPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<TrialBookingRow[]>([]);
  const [search, setSearch] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [bookingStatus, setBookingStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessState, setAccessState] = useState<TrialAdminAccessState>("checking");
  const [updatingBookingId, setUpdatingBookingId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, { type: "success" | "error"; text: string }>>({});
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set("q", trimmedSearch.slice(0, 80));
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (paymentStatus) params.set("paymentStatus", paymentStatus);
    if (bookingStatus) params.set("bookingStatus", bookingStatus);
    return params.toString();
  }, [bookingStatus, paymentMethod, paymentStatus, search]);

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
          router.replace("/login?redirect=/admin/trial-bookings");
        } else if (response.status === 403) {
          setAccessState("forbidden");
          setError("此頁面僅限管理者查看。");
        } else {
          setAccessState("allowed");
          setError(payload?.error || "無法讀取首次體驗預約資料。");
        }
        setBookings([]);
        return;
      }

      setAccessState("allowed");
      setBookings(payload.bookings || []);
    } catch {
      setError("讀取資料時發生錯誤，請稍後再試。");
      setBookings([]);
    } finally {
      setIsLoading(false);
    }
  }, [queryString, router]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("登出失敗，請稍後再試。");
      }

      router.replace("/login");
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "登出失敗，請稍後再試。");
      setIsLoggingOut(false);
    }
  }

  async function updateBookingStatus(bookingId: string, nextStatus: BookingStatus) {
    const current = bookings.find((booking) => booking.id === bookingId);
    if (!current || current.booking_status === nextStatus || updatingBookingId) return;

    setUpdatingBookingId(bookingId);
    setRowMessages((messages) => ({
      ...messages,
      [bookingId]: { type: "success", text: "更新中..." },
    }));

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
          [bookingId]: {
            type: "error",
            text: payload?.error || "更新預約狀態失敗。",
          },
        }));
        return;
      }

      const updatedBooking = payload.booking;
      setBookings((currentBookings) =>
        currentBookings.map((booking) =>
          booking.id === bookingId
            ? {
                ...booking,
                booking_status: updatedBooking.booking_status,
              }
            : booking,
        ),
      );
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "success", text: "已更新" },
      }));
    } catch {
      setRowMessages((messages) => ({
        ...messages,
        [bookingId]: { type: "error", text: "更新預約狀態時發生錯誤。" },
      }));
    } finally {
      setUpdatingBookingId(null);
    }
  }

  function renderStatusControl(booking: TrialBookingRow) {
    const isUpdating = updatingBookingId === booking.id;
    const message = rowMessages[booking.id];

    return (
      <div className={`trialAdminStatusControl${isUpdating ? " trialAdminRowUpdating" : ""}`}>
        <select
          className="trialAdminStatusSelect"
          value={booking.booking_status}
          disabled={isUpdating}
          onChange={(event) => {
            void updateBookingStatus(booking.id, event.target.value as BookingStatus);
          }}
          aria-label={`${booking.name || "booking"} 預約狀態`}
        >
          {bookingStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={`trialAdminBadge is-${booking.booking_status}`}>
          {labelOrFallback(bookingStatusLabels, booking.booking_status)}
        </span>
        {message ? (
          <span className={`trialAdminInlineMessage is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <main className="trialAdminPage">
      <section className="trialAdminShell">
        <header className="trialAdminHeader">
          <div>
            <p className="trialAdminEyebrow">BIGE ADMIN</p>
            <h1>首次體驗預約管理</h1>
            <p>查看官網首次體驗預約進件與付款狀態。</p>
          </div>
          <button className="trialAdminButton" type="button" onClick={loadBookings} disabled={isLoading}>
            {isLoading ? "讀取中" : "重新整理"}
          </button>
          <button
            className="trialAdminButton trialAdminButtonDanger"
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "登出中..." : "登出"}
          </button>
        </header>

        {logoutError ? <div className="trialAdminError">{logoutError}</div> : null}

        <section className="trialAdminFilters" aria-label="首次體驗預約篩選">
          <label className="trialAdminField">
            <span>搜尋</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜尋姓名 / 電話 / LINE 名稱"
              maxLength={80}
            />
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
              <option value="pending_cash">pending_cash</option>
              <option value="pending_payment">pending_payment</option>
              <option value="paid">paid</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
          <label className="trialAdminField">
            <span>預約狀態</span>
            <select value={bookingStatus} onChange={(event) => setBookingStatus(event.target.value)}>
              <option value="">全部</option>
              <option value="new">new</option>
              <option value="contacted">contacted</option>
              <option value="scheduled">scheduled</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
        </section>

        {error ? <div className="trialAdminError">{error}</div> : null}

        {accessState === "unauthorized" ? (
          <section className="trialAdminAuthNotice">
            <h2>請先登入</h2>
            <p>請先登入後再查看首次體驗預約。</p>
            <a className="trialAdminLoginHint" href="/login?redirect=/admin/trial-bookings">
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
                    <th>姓名</th>
                    <th>電話</th>
                    <th>LINE 名稱</th>
                    <th>體驗項目</th>
                    <th>方便時段</th>
                    <th>付款方式</th>
                    <th>付款狀態</th>
                    <th>預約狀態</th>
                    <th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((booking) => (
                    <tr key={booking.id}>
                      <td>{formatDateTime(booking.created_at)}</td>
                      <td>{booking.name || "-"}</td>
                      <td>{booking.phone || "-"}</td>
                      <td>{booking.line_name || "-"}</td>
                      <td>{labelOrFallback(serviceLabels, booking.service)}</td>
                      <td>{labelOrFallback(preferredTimeLabels, booking.preferred_time)}</td>
                      <td>{labelOrFallback(paymentMethodLabels, booking.payment_method)}</td>
                      <td>
                        <span className={`trialAdminBadge is-${booking.payment_status}`}>
                          {labelOrFallback(paymentStatusLabels, booking.payment_status)}
                        </span>
                      </td>
                      <td>
                        {renderStatusControl(booking)}
                      </td>
                      <td>{booking.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="trialAdminMobileList">
              {bookings.map((booking) => (
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
                      <dt>LINE 名稱</dt>
                      <dd>{booking.line_name || "-"}</dd>
                    </div>
                    <div>
                      <dt>體驗項目</dt>
                      <dd>{labelOrFallback(serviceLabels, booking.service)}</dd>
                    </div>
                    <div>
                      <dt>方便時段</dt>
                      <dd>{labelOrFallback(preferredTimeLabels, booking.preferred_time)}</dd>
                    </div>
                    <div>
                      <dt>付款方式</dt>
                      <dd>{labelOrFallback(paymentMethodLabels, booking.payment_method)}</dd>
                    </div>
                    <div>
                      <dt>付款狀態</dt>
                      <dd>{labelOrFallback(paymentStatusLabels, booking.payment_status)}</dd>
                    </div>
                    <div className="trialAdminMobileNote">
                      <dt>備註</dt>
                      <dd>{booking.note || "-"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
