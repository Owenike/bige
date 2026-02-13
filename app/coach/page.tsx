"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

interface BookingItem {
  id: string;
  member_id: string;
  coach_id: string | null;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
}

interface MemberItem {
  id: string;
  full_name: string;
  phone: string | null;
}

interface PassItem {
  id: string;
  pass_type: "single" | "punch";
  remaining: number;
  expires_at: string | null;
}

interface CoachMemberOverviewResponse {
  member: {
    id: string;
    fullName: string;
    phoneLast4: string | null;
    photoUrl: string | null;
    note: string | null;
  };
  subscription: {
    expiresAt: string | null;
    isActive: boolean | null;
  };
  passes: Array<{
    id: string;
    passType: string | null;
    remaining: number | null;
    expiresAt: string | null;
    status: string | null;
  }>;
  recentCheckin: null | {
    checkedAt: string;
    result: string | null;
    reason: string | null;
  };
  recentRedemption: null | {
    redeemedAt: string;
    kind: string | null;
    quantity: number;
  };
  recentBooking: null | {
    startsAt: string;
    endsAt: string;
    serviceName: string | null;
    status: string | null;
    note: string | null;
  };
}

type CoachBookingStatus = "checked_in" | "completed" | "no_show";
type DateFilterPreset = "all" | "today" | "week" | "custom";
type ScheduleStatusFilter = "all" | "booked" | "checked_in" | "completed" | "cancelled" | "no_show";

function toDatetimeLocalValue(input: Date) {
  const value = new Date(input.getTime() - input.getTimezoneOffset() * 60 * 1000);
  return value.toISOString().slice(0, 16);
}

function startOfDay(input: Date) {
  const copy = new Date(input);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(input: Date) {
  const copy = new Date(input);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function endOfWeek(input: Date) {
  const copy = endOfDay(input);
  const day = copy.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function localDatetimeToIso(value: string) {
  return value ? new Date(value).toISOString() : "";
}

function translateApiError(input: string, zh: boolean) {
  const map: Record<string, string> = zh
    ? {
        reason_required: "\u8acb\u8f38\u5165\u539f\u56e0",
        booking_not_found: "\u627e\u4e0d\u5230\u9810\u7d04",
        booking_not_modifiable: "\u9019\u7b46\u9810\u7d04\u7121\u6cd5\u4fee\u6539",
        booking_locked_for_modification: "\u9810\u7d04\u5df2\u9396\u5b9a\uff0c\u7121\u6cd5\u4fee\u6539",
        reschedule_time_required: "\u6539\u671f\u9700\u8981\u958b\u59cb\u8207\u7d50\u675f\u6642\u9593",
        invalid_reschedule_range: "\u6539\u671f\u6642\u9593\u7bc4\u570d\u7121\u6548",
        reschedule_must_be_future: "\u6539\u671f\u6642\u9593\u5fc5\u9808\u662f\u672a\u4f86",
        booking_time_overlap: "\u8a72\u6642\u6bb5\u8207\u5176\u4ed6\u9810\u7d04\u885d\u7a81",
        invalid_redemption_input: "\u6838\u92b7\u53c3\u6578\u7121\u6548",
        invalid_redeemed_kind: "\u6838\u92b7\u985e\u578b\u7121\u6548",
        pass_id_required: "\u7968\u5238\u6838\u92b7\u9700\u8981\u7968\u5238\u7de8\u865f",
        pass_not_found: "\u627e\u4e0d\u5230\u7968\u5238",
        insufficient_remaining_sessions: "\u5269\u9918\u5802\u6578\u4e0d\u8db3",
        "Booking already redeemed": "\u9019\u7b46\u9810\u7d04\u5df2\u6838\u92b7",
        Forbidden: "\u7121\u6b0a\u9650",
        Unauthorized: "\u672a\u6388\u6b0a",
      }
    : {
        reason_required: "Please enter a reason",
        booking_not_found: "Booking not found",
        booking_not_modifiable: "Booking cannot be modified",
        booking_locked_for_modification: "Booking is locked for modification",
        reschedule_time_required: "Reschedule needs startsAt and endsAt",
        invalid_reschedule_range: "Invalid reschedule time range",
        reschedule_must_be_future: "Reschedule time must be in the future",
        booking_time_overlap: "Booking time overlaps with another booking",
        invalid_redemption_input: "Invalid redemption input",
        invalid_redeemed_kind: "Invalid redemption kind",
        pass_id_required: "Pass redemption requires passId",
        pass_not_found: "Pass not found",
        insufficient_remaining_sessions: "Insufficient remaining sessions",
        "Booking already redeemed": "Booking already redeemed",
        Forbidden: "Forbidden",
        Unauthorized: "Unauthorized",
      };
  return map[input] || input;
}

function statusColor(status: string) {
  if (status === "completed") return "text-green-700";
  if (status === "checked_in") return "text-blue-700";
  if (status === "no_show") return "text-red-700";
  return "text-gray-700";
}

function CoachPortalContent() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const now = new Date();
  const initialTodayStart = toDatetimeLocalValue(startOfDay(now));
  const initialTodayEnd = toDatetimeLocalValue(endOfDay(now));

  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<ScheduleStatusFilter>("all");
  const [dateFilterPreset, setDateFilterPreset] = useState<DateFilterPreset>("today");
  const [fromLocal, setFromLocal] = useState(initialTodayStart);
  const [toLocal, setToLocal] = useState(initialTodayEnd);
  const [queryHydrated, setQueryHydrated] = useState(false);

  const [updateBookingId, setUpdateBookingId] = useState("");
  const [updateStatus, setUpdateStatus] = useState<CoachBookingStatus>("checked_in");
  const [updateNote, setUpdateNote] = useState("");
  const [updateReason, setUpdateReason] = useState("");

  const [memberId, setMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<MemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [redeemedKind, setRedeemedKind] = useState<"monthly" | "pass">("monthly");
  const [redeemableOnly, setRedeemableOnly] = useState(true);
  const [passId, setPassId] = useState("");
  const [passOptions, setPassOptions] = useState<PassItem[]>([]);
  const [passesLoading, setPassesLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [redeemNote, setRedeemNote] = useState("");

  const [memberOverviewOpenByBookingId, setMemberOverviewOpenByBookingId] = useState<Record<string, boolean>>({});
  const [memberOverviewLoadingByBookingId, setMemberOverviewLoadingByBookingId] = useState<Record<string, boolean>>({});
  const [memberOverviewErrorByBookingId, setMemberOverviewErrorByBookingId] = useState<Record<string, string | null>>(
    {},
  );
  const [memberOverviewByBookingId, setMemberOverviewByBookingId] = useState<Record<string, CoachMemberOverviewResponse | null>>(
    {},
  );

  function bookingStatusLabel(status: string) {
    if (!zh) return status;
    if (status === "booked") return "\u5df2\u9810\u7d04";
    if (status === "checked_in") return "\u5df2\u5831\u5230";
    if (status === "completed") return "\u5df2\u5b8c\u6210";
    if (status === "cancelled") return "\u5df2\u53d6\u6d88";
    if (status === "no_show") return "\u672a\u51fa\u5e2d";
    return status;
  }

  function passTypeLabel(passType: string | null) {
    if (!zh) return passType || "pass";
    if (!passType) return "\u7968\u5238";
    if (passType === "single") return "\u55ae\u6b21\u7968";
    if (passType === "punch") return "\u6b21\u6578\u7968";
    if (passType === "pass") return "\u7968\u5238";
    return passType;
  }

  const activeCount = useMemo(
    () => bookings.filter((item) => item.status === "booked" || item.status === "checked_in").length,
    [bookings],
  );
  const visibleBookings = useMemo(() => {
    const q = scheduleQuery.trim().toLowerCase();
    return bookings.filter((item) => {
      if (scheduleStatusFilter !== "all" && item.status !== scheduleStatusFilter) return false;
      if (!q) return true;
      return (
        item.member_id.toLowerCase().includes(q) ||
        item.service_name.toLowerCase().includes(q) ||
        (item.note || "").toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [bookings, scheduleQuery, scheduleStatusFilter]);
  const memberBookingOptions = useMemo(() => {
    const filtered = bookings.filter((item) => {
      if (memberId && item.member_id !== memberId) return false;
      if (redeemableOnly && item.status !== "booked" && item.status !== "checked_in") return false;
      return true;
    });
    return [...filtered].sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [bookings, memberId, redeemableOnly]);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const from = localDatetimeToIso(fromLocal);
      const to = localDatetimeToIso(toLocal);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString();
      const res = await fetch(query ? `/api/bookings?${query}` : "/api/bookings");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u9810\u7d04\u5931\u6557" : "Failed to load bookings"));
      setBookings((payload.items || []) as BookingItem[]);
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u9810\u7d04\u5931\u6557" : "Failed to load bookings", zh));
    } finally {
      setLoading(false);
    }
  }, [fromLocal, toLocal, zh]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    const presetFromQuery = searchParams.get("preset");
    const fromFromQuery = searchParams.get("fromLocal");
    const toFromQuery = searchParams.get("toLocal");
    const statusFromQuery = searchParams.get("scheduleStatus");
    const queryFromQuery = searchParams.get("scheduleQuery");
    const redeemableOnlyFromQuery = searchParams.get("redeemableOnly");
    const memberQueryFromUrl = searchParams.get("memberQuery");
    const memberIdFromUrl = searchParams.get("memberId");
    const bookingIdFromUrl = searchParams.get("bookingId");
    const redeemedKindFromUrl = searchParams.get("redeemedKind");
    const passIdFromUrl = searchParams.get("passId");
    const quantityFromUrl = searchParams.get("quantity");

    if (presetFromQuery === "all" || presetFromQuery === "today" || presetFromQuery === "week" || presetFromQuery === "custom") {
      setDateFilterPreset(presetFromQuery);
    }
    if (fromFromQuery !== null) setFromLocal(fromFromQuery);
    if (toFromQuery !== null) setToLocal(toFromQuery);
    if (
      statusFromQuery === "all" ||
      statusFromQuery === "booked" ||
      statusFromQuery === "checked_in" ||
      statusFromQuery === "completed" ||
      statusFromQuery === "cancelled" ||
      statusFromQuery === "no_show"
    ) {
      setScheduleStatusFilter(statusFromQuery);
    }
    if (queryFromQuery !== null) setScheduleQuery(queryFromQuery);
    if (redeemableOnlyFromQuery === "0" || redeemableOnlyFromQuery === "1") {
      setRedeemableOnly(redeemableOnlyFromQuery === "1");
    }
    if (memberQueryFromUrl !== null) setMemberQuery(memberQueryFromUrl);
    if (memberIdFromUrl !== null) setMemberId(memberIdFromUrl);
    if (bookingIdFromUrl !== null) setBookingId(bookingIdFromUrl);
    if (redeemedKindFromUrl === "monthly" || redeemedKindFromUrl === "pass") setRedeemedKind(redeemedKindFromUrl);
    if (passIdFromUrl !== null) setPassId(passIdFromUrl);
    if (quantityFromUrl !== null) {
      const parsed = Number(quantityFromUrl);
      if (Number.isFinite(parsed) && parsed >= 1) setQuantity(Math.floor(parsed));
    }

    setQueryHydrated(true);
  }, [searchParams]);

  useEffect(() => {
    if (!queryHydrated) return;

    const params = new URLSearchParams();
    if (dateFilterPreset !== "today") params.set("preset", dateFilterPreset);
    // Avoid writing the default "today" range into the URL on initial load.
    // Unnecessary replaces can trigger navigation loops / repeated fetching in some setups.
    if (dateFilterPreset !== "today") {
      if (fromLocal) params.set("fromLocal", fromLocal);
      if (toLocal) params.set("toLocal", toLocal);
    } else {
      // Keep URL clean for the default view.
      // If user switches back from week/custom, `preset` and range params will be removed.
    }
    if (scheduleStatusFilter !== "all") params.set("scheduleStatus", scheduleStatusFilter);
    if (scheduleQuery.trim()) params.set("scheduleQuery", scheduleQuery.trim());
    if (!redeemableOnly) params.set("redeemableOnly", "0");
    if (memberQuery.trim()) params.set("memberQuery", memberQuery.trim());
    if (memberId) params.set("memberId", memberId);
    if (bookingId) params.set("bookingId", bookingId);
    if (redeemedKind !== "monthly") params.set("redeemedKind", redeemedKind);
    if (passId) params.set("passId", passId);
    if (quantity > 1) params.set("quantity", String(quantity));

    const query = params.toString();
    const currentQuery = searchParams.toString();
    if (query === currentQuery) return;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    dateFilterPreset,
    fromLocal,
    toLocal,
    scheduleStatusFilter,
    scheduleQuery,
    redeemableOnly,
    memberQuery,
    memberId,
    bookingId,
    redeemedKind,
    passId,
    quantity,
    pathname,
    queryHydrated,
    router,
    searchParams
  ]);

  const searchMembers = useCallback(async (query: string) => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/members?q=${encodeURIComponent(query)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u641c\u5c0b\u6703\u54e1\u5931\u6557" : "Member search failed"));
      setMemberOptions((payload.items || []) as MemberItem[]);
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : zh ? "\u641c\u5c0b\u6703\u54e1\u5931\u6557" : "Member search failed", zh));
    } finally {
      setMembersLoading(false);
    }
  }, [zh]);

  const loadPasses = useCallback(async (targetMemberId: string) => {
    if (!targetMemberId) {
      setPassOptions([]);
      setPassId("");
      return;
    }

    setPassesLoading(true);
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(targetMemberId)}/passes`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u7968\u5238\u5931\u6557" : "Load passes failed"));
      const items = (payload.items || []) as PassItem[];
      setPassOptions(items);
      if (!items.some((item) => item.id === passId)) {
        setPassId(items[0]?.id || "");
      }
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u7968\u5238\u5931\u6557" : "Load passes failed", zh));
      setPassOptions([]);
      setPassId("");
    } finally {
      setPassesLoading(false);
    }
  }, [passId, zh]);

  useEffect(() => {
    void searchMembers("");
  }, [searchMembers]);

  useEffect(() => {
    if (redeemedKind !== "pass") {
      setPassOptions([]);
      setPassId("");
      return;
    }
    void loadPasses(memberId);
  }, [loadPasses, memberId, redeemedKind]);

  useEffect(() => {
    if (!bookingId) return;
    if (!memberBookingOptions.some((item) => item.id === bookingId)) {
      setBookingId("");
    }
  }, [bookingId, memberBookingOptions]);

  function applyPreset(preset: DateFilterPreset) {
    const current = new Date();
    setDateFilterPreset(preset);

    if (preset === "all") {
      setFromLocal("");
      setToLocal("");
      return;
    }
    if (preset === "today") {
      setFromLocal(toDatetimeLocalValue(startOfDay(current)));
      setToLocal(toDatetimeLocalValue(endOfDay(current)));
      return;
    }
    if (preset === "week") {
      setFromLocal(toDatetimeLocalValue(startOfDay(current)));
      setToLocal(toDatetimeLocalValue(endOfWeek(current)));
      return;
    }
  }

  function bindBooking(item: BookingItem) {
    setUpdateBookingId(item.id);
    setBookingId(item.id);
    setMemberId(item.member_id);
    setMemberQuery(item.member_id);
    setUpdateNote(item.note || "");
  }

  async function toggleMemberOverview(item: BookingItem) {
    const nextOpen = !memberOverviewOpenByBookingId[item.id];
    setMemberOverviewOpenByBookingId((prev) => ({ ...prev, [item.id]: nextOpen }));
    if (!nextOpen) return;

    // If already loaded, don't refetch unless user refreshes the page.
    if (memberOverviewByBookingId[item.id]) return;

    setMemberOverviewLoadingByBookingId((prev) => ({ ...prev, [item.id]: true }));
    setMemberOverviewErrorByBookingId((prev) => ({ ...prev, [item.id]: null }));
    try {
      const res = await fetch(`/api/coach/members/${encodeURIComponent(item.member_id)}/overview`);
      const payload = (await res.json()) as any;
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u8f09\u5165\u6703\u54e1\u72c0\u614b\u5931\u6557" : "Failed to load member overview"));
      setMemberOverviewByBookingId((prev) => ({ ...prev, [item.id]: payload as CoachMemberOverviewResponse }));
    } catch (err) {
      setMemberOverviewErrorByBookingId((prev) => ({
        ...prev,
        [item.id]: translateApiError(err instanceof Error ? err.message : zh ? "\u8f09\u5165\u6703\u54e1\u72c0\u614b\u5931\u6557" : "Failed to load member overview", zh),
      }));
      setMemberOverviewByBookingId((prev) => ({ ...prev, [item.id]: null }));
    } finally {
      setMemberOverviewLoadingByBookingId((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function updateBooking(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(updateBookingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: updateStatus,
          note: updateNote || null,
          reason: updateReason,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u66f4\u65b0\u9810\u7d04\u5931\u6557" : "Update booking failed"));
      setMessage(
        zh
          ? `\u9810\u7d04 ${updateBookingId} \u5df2\u66f4\u65b0\u70ba ${updateStatus}\u3002`
          : `Booking ${updateBookingId} updated to ${updateStatus}.`,
      );
      setUpdateReason("");
      await loadBookings();
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : zh ? "\u66f4\u65b0\u9810\u7d04\u5931\u6557" : "Update booking failed", zh));
    }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/session-redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          bookingId: bookingId || null,
          redeemedKind,
          passId: redeemedKind === "pass" ? passId || null : null,
          quantity,
          note: redeemNote || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || (zh ? "\u6838\u92b7\u5931\u6557" : "Redemption failed"));
      setMessage(zh ? `\u6703\u54e1 ${memberId} \u6838\u92b7\u5b8c\u6210\u3002` : `Session redeemed for member ${memberId}.`);
      setRedeemNote("");
      if (redeemedKind === "pass") {
        setPassId("");
        setQuantity(1);
      }
      await loadBookings();
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : zh ? "\u6838\u92b7\u5931\u6557" : "Redemption failed", zh));
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">{zh ? "\u6559\u7df4\u5de5\u4f5c\u53f0" : "Coach Portal"}</h1>
      <p className="mt-1 text-sm text-gray-600">
        {zh ? "\u6211\u7684\u9810\u7d04" : "My bookings"}: {bookings.length} | {zh ? "\u9032\u884c\u4e2d\u5834\u6b21" : "Active sessions"}: {activeCount}
      </p>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}

      <section className="card mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{zh ? "\u6211\u7684\u8ab2\u8868" : "My Schedule"}</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "today" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("today")}
            >
              {zh ? "\u4eca\u5929" : "Today"}
            </button>
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "week" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("week")}
            >
              {zh ? "\u672c\u9031" : "This Week"}
            </button>
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "all" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("all")}
            >
              {zh ? "\u5168\u90e8" : "All"}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => void loadBookings()}
              disabled={loading}
            >
              {loading ? (zh ? "\u8f09\u5165\u4e2d..." : "Loading...") : zh ? "\u91cd\u65b0\u6574\u7406" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <input
            type="datetime-local"
            value={fromLocal}
            onChange={(e) => {
              setDateFilterPreset("custom");
              setFromLocal(e.target.value);
            }}
            className="rounded border px-3 py-2"
          />
          <input
            type="datetime-local"
            value={toLocal}
            onChange={(e) => {
              setDateFilterPreset("custom");
              setToLocal(e.target.value);
            }}
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input
            value={scheduleQuery}
            onChange={(e) => setScheduleQuery(e.target.value)}
            placeholder={zh ? "\u641c\u5c0b\u670d\u52d9/\u6703\u54e1\u7de8\u865f/\u5099\u8a3b/\u9810\u7d04\u7de8\u865f" : "Search service/memberId/note/bookingId"}
            className="rounded border px-3 py-2 text-sm"
          />
          <select
            value={scheduleStatusFilter}
            onChange={(e) => setScheduleStatusFilter(e.target.value as ScheduleStatusFilter)}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="all">{zh ? "\u5168\u90e8\u72c0\u614b" : "all status"}</option>
            <option value="booked">{bookingStatusLabel("booked")}</option>
            <option value="checked_in">{bookingStatusLabel("checked_in")}</option>
            <option value="completed">{bookingStatusLabel("completed")}</option>
            <option value="cancelled">{bookingStatusLabel("cancelled")}</option>
            <option value="no_show">{bookingStatusLabel("no_show")}</option>
          </select>
        </div>

        <ul className="mt-3 space-y-2 text-sm">
          {visibleBookings.map((item) => {
            const open = !!memberOverviewOpenByBookingId[item.id];
            const overview = memberOverviewByBookingId[item.id];
            const overviewLoading = !!memberOverviewLoadingByBookingId[item.id];
            const overviewError = memberOverviewErrorByBookingId[item.id] || null;

            return (
            <li key={item.id} className="rounded border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">     
                <p>
                  <span className="font-medium">{new Date(item.starts_at).toLocaleString()}</span>
                  {" - "}
                  {new Date(item.ends_at).toLocaleTimeString()}
                </p>
                <span className={statusColor(item.status)}>{bookingStatusLabel(item.status)}</span>       
              </div>
              <p className="mt-1">
                {item.service_name} | {zh ? "\u6703\u54e1" : "member"}: <code>{item.member_id}</code>
              </p>
              <p className="mt-1 text-gray-600">{zh ? "\u5099\u8a3b" : "note"}: {item.note || "-"}</p>
              <p className="mt-2">
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded bg-black px-3 py-1 text-white"
                    onClick={() => bindBooking(item)}
                  >
                    {zh ? "\u5e36\u5165\u8868\u55ae" : "Use in forms"}
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-1"
                    onClick={() => void toggleMemberOverview(item)}
                  >
                    {open ? (zh ? "\u96b1\u85cf\u6703\u54e1\u72c0\u614b" : "Hide member status") : zh ? "\u6703\u54e1\u72c0\u614b" : "Member status"}
                  </button>
                </span>
              </p>

              {open ? (
                <div className="mt-3 rounded border bg-gray-50 p-3">
                  {overviewLoading ? (
                    <p className="text-xs text-gray-600">{zh ? "\u8f09\u5165\u6703\u54e1\u72c0\u614b\u4e2d..." : "Loading member status..."}</p>
                  ) : overviewError ? (
                    <p className="text-xs text-red-600">{overviewError}</p>
                  ) : overview ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u6703\u54e1" : "Member"}</p>
                        <div className="mt-2 flex items-start gap-3">
                          {overview.member.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={overview.member.photoUrl}
                              alt={zh ? "\u6703\u54e1\u5927\u982d\u7167" : "member photo"}
                              className="h-12 w-12 rounded object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded bg-gray-200" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {overview.member.fullName || (zh ? "\uff08\u672a\u547d\u540d\uff09" : "(no name)")}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              {zh ? "\u96fb\u8a71\u5f8c\u56db\u78bc" : "phone last4"}: {overview.member.phoneLast4 || "-"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              {zh ? "\u6703\u54e1\u7de8\u865f" : "memberId"}: <code>{overview.member.id}</code>
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u6703\u54e1\u65b9\u6848" : "Plan"}</p>
                        <p className="mt-2 text-sm">
                          {zh ? "\u6708\u6703\u54e1" : "monthly"}:{" "}
                          {overview.subscription.expiresAt
                            ? new Date(overview.subscription.expiresAt).toLocaleDateString()
                            : "-"}
                          {" | "}
                          {overview.subscription.isActive === null
                            ? zh ? "\u672a\u77e5" : "unknown"
                            : overview.subscription.isActive
                              ? zh ? "\u555f\u7528\u4e2d" : "active"
                              : zh ? "\u672a\u555f\u7528" : "inactive"}
                        </p>
                        <p className="mt-2 text-xs text-gray-600">{zh ? "\u7968\u5238\u6578\u91cf" : "passes"}: {overview.passes.length}</p>
                        {overview.passes.length ? (
                          <ul className="mt-2 space-y-1 text-xs text-gray-700">
                            {overview.passes.slice(0, 5).map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1">
                                <span className="truncate">
                                  {passTypeLabel(p.passType)} | {zh ? "\u5269\u9918\u5802\u6578" : "remain"} {p.remaining ?? "-"}
                                </span>
                                <span className="text-gray-600">
                                  {zh ? "\u5230\u671f" : "exp"} {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : "-"}
                                </span>
                              </li>
                            ))}
                            {overview.passes.length > 5 ? (
                              <li className="text-gray-500">(+{overview.passes.length - 5} {zh ? "\u7b46" : "more"})</li>
                            ) : null}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">{zh ? "\u7121\u7968\u5238\u8cc7\u6599\u3002" : "No passes."}</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3 md:col-span-2">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u5099\u8a3b" : "Notes"}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                          {overview.member.note || "-"}
                        </p>
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u6700\u8fd1\u5831\u5230" : "Recent check-in"}</p>
                        {overview.recentCheckin ? (
                          <>
                            <p className="mt-2 text-sm">
                              {new Date(overview.recentCheckin.checkedAt).toLocaleString()} | {overview.recentCheckin.result || "-"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              {zh ? "\u539f\u56e0" : "reason"}: {overview.recentCheckin.reason || "-"}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">{zh ? "\u7121\u5831\u5230\u8cc7\u6599\u3002" : "No check-ins."}</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u6700\u8fd1\u6838\u92b7" : "Recent redemption"}</p>
                        {overview.recentRedemption ? (
                          <>
                            <p className="mt-2 text-sm">
                              {new Date(overview.recentRedemption.redeemedAt).toLocaleString()} |{" "}
                              {overview.recentRedemption.kind || "-"}
                              {zh ? " | \u6578\u91cf " : " | qty "}
                              {overview.recentRedemption.quantity}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">{zh ? "\u7121\u6838\u92b7\u8cc7\u6599\u3002" : "No redemptions."}</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3 md:col-span-2">
                        <p className="text-xs font-semibold text-gray-700">{zh ? "\u6700\u8fd1\u9810\u7d04" : "Recent booking"}</p>
                        {overview.recentBooking ? (
                          <p className="mt-2 text-sm">
                            {new Date(overview.recentBooking.startsAt).toLocaleString()} |{" "}
                            {overview.recentBooking.serviceName || "-"} | {bookingStatusLabel(overview.recentBooking.status || "-")}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">{zh ? "\u7121\u9810\u7d04\u8cc7\u6599\u3002" : "No bookings."}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">{zh ? "\u7121\u8cc7\u6599\u3002" : "No data."}</p>
                  )}
                </div>
              ) : null}
            </li>
            );
          })}
          {!visibleBookings.length && !loading ? <li className="text-gray-500">{zh ? "\u7121\u9810\u7d04\u8cc7\u6599\u3002" : "No bookings."}</li> : null}
        </ul>
      </section>

      <section className="card mt-6 grid gap-4 lg:grid-cols-2 p-4">
        <form className="rounded-lg border p-4" onSubmit={updateBooking}>
          <h2 className="text-lg font-semibold">{zh ? "\u8ab2\u5802\u72c0\u614b\u8207\u5099\u8a3b" : "Class Status & Notes"}</h2>
          <p className="mt-2">
            <input
              value={updateBookingId}
              onChange={(e) => setUpdateBookingId(e.target.value)}
              placeholder={zh ? "\u9810\u7d04\u7de8\u865f" : "bookingId"}
              className="w-full rounded border px-3 py-2 font-mono text-sm"
              required
            />
          </p>
          <p className="mt-2">
            <select
              value={updateStatus}
              onChange={(e) => setUpdateStatus(e.target.value as CoachBookingStatus)}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="checked_in">{bookingStatusLabel("checked_in")}</option>
              <option value="completed">{bookingStatusLabel("completed")}</option>
              <option value="no_show">{bookingStatusLabel("no_show")}</option>
            </select>
          </p>
          <p className="mt-2">
            <input
              value={updateNote}
              onChange={(e) => setUpdateNote(e.target.value)}
              placeholder={zh ? "\u6559\u7df4\u5099\u8a3b" : "coach note"}
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </p>
          <p className="mt-2">
            <input
              value={updateReason}
              onChange={(e) => setUpdateReason(e.target.value)}
              placeholder={zh ? "\u539f\u56e0\uff08\u5fc5\u586b\uff09" : "reason (required)"}
              className="w-full rounded border px-3 py-2 text-sm"
              required
            />
          </p>
          <button type="submit" className="mt-3 rounded bg-black px-4 py-2 text-sm text-white">
            {zh ? "\u66f4\u65b0\u9810\u7d04" : "Update Booking"}
          </button>
        </form>

        <form className="rounded-lg border p-4" onSubmit={redeem}>
          <h2 className="text-lg font-semibold">{zh ? "\u5802\u6578/\u6708\u8cbb\u6838\u92b7" : "Session Redemption"}</h2>
          <p className="mt-2 text-xs text-gray-600">{zh ? "\u641c\u5c0b\u6703\u54e1" : "Search member"}</p>
          <p className="mt-1">
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder={zh ? "\u59d3\u540d / \u96fb\u8a71" : "name / phone"}
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </p>
          <p className="mt-2">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => void searchMembers(memberQuery)}
              disabled={membersLoading}
            >
              {membersLoading ? (zh ? "\u641c\u5c0b\u4e2d..." : "Searching...") : zh ? "\u641c\u5c0b\u6703\u54e1" : "Search Members"}
            </button>
          </p>
          <p className="mt-2">
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              required
            >
              <option value="">{zh ? "\u9078\u64c7\u6703\u54e1" : "Select member"}</option>
              {memberOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name} | {item.phone || "-"} | {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </p>
          <p className="mt-1 text-xs text-gray-600">{zh ? "\u6703\u54e1\u7de8\u865f" : "memberId"}: {memberId || "-"}</p>
          <p className="mt-2">
            <select
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">{zh ? "\u4e0d\u7d81\u5b9a\u9810\u7d04\uff08\u9078\u586b\uff09" : "No booking link (optional)"}</option>
              {memberBookingOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.starts_at).toLocaleString()} | {item.service_name} | {bookingStatusLabel(item.status)}
                </option>
              ))}
            </select>
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-gray-700">
            <input
              id="redeemableOnly"
              type="checkbox"
              checked={redeemableOnly}
              onChange={(e) => setRedeemableOnly(e.target.checked)}
            />
            <label htmlFor="redeemableOnly">
              {zh ? "\u50c5\u986f\u793a\u53ef\u6838\u92b7\u9810\u7d04\uff08\u5df2\u9810\u7d04 / \u5df2\u5831\u5230\uff09" : "Only show redeemable bookings (booked / checked_in)"}
            </label>
          </p>
          <p className="mt-1 text-xs text-gray-600">{zh ? "\u9810\u7d04\u7de8\u865f" : "bookingId"}: {bookingId || "-"}</p>
          <p className="mt-2">
            <select
              value={redeemedKind}
              onChange={(e) => setRedeemedKind(e.target.value as "monthly" | "pass")}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="monthly">{zh ? "\u6708\u6703\u54e1" : "monthly"}</option>
              <option value="pass">{zh ? "\u7968\u5238" : "pass"}</option>
            </select>
          </p>
          {redeemedKind === "pass" ? (
            <>
              <p className="mt-2">
                <select
                  value={passId}
                  onChange={(e) => setPassId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                  required
                  disabled={!memberId || passesLoading}
                >
                  <option value="">
                    {passesLoading ? (zh ? "\u8f09\u5165\u7968\u5238\u4e2d..." : "Loading passes...") : passOptions.length ? (zh ? "\u9078\u64c7\u7968\u5238" : "Select pass") : zh ? "\u7121\u53ef\u7528\u7968\u5238" : "No active pass"}
                  </option>
                  {passOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {passTypeLabel(item.pass_type)} | {zh ? "\u5269\u9918\u5802\u6578" : "remain"} {item.remaining} | {zh ? "\u5230\u671f" : "exp"}{" "}
                      {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : "-"}
                    </option>
                  ))}
                </select>
              </p>
              <p className="mt-2">
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded border px-3 py-2 text-sm"
                  required
                />
              </p>
            </>
          ) : null}
          <p className="mt-2">
            <input
              value={redeemNote}
              onChange={(e) => setRedeemNote(e.target.value)}
              placeholder={zh ? "\u8ab2\u5802\u5099\u8a3b" : "class note"}
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </p>
          <button type="submit" className="mt-3 rounded bg-black px-4 py-2 text-sm text-white">
            {zh ? "\u6838\u92b7" : "Redeem Session"}
          </button>
        </form>
      </section>
    </main>
  );
}

export default function CoachPortalPage() {
  const { locale } = useI18n();
  const zh = locale !== "en";
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-6xl p-6 text-sm text-gray-600">
          {zh ? "\u8f09\u5165\u6559\u7df4\u5de5\u4f5c\u53f0\u4e2d..." : "Loading coach portal..."}
        </main>
      }
    >
      <CoachPortalContent />
    </Suspense>
  );
}

