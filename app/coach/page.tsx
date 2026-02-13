"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

function translateApiError(input: string) {
  const map: Record<string, string> = {
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
    Unauthorized: "Unauthorized"
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
      if (!res.ok) throw new Error(payload?.error || "Failed to load bookings");
      setBookings((payload.items || []) as BookingItem[]);
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : "Failed to load bookings"));
    } finally {
      setLoading(false);
    }
  }, [fromLocal, toLocal]);

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
      if (!res.ok) throw new Error(payload?.error || "Member search failed");
      setMemberOptions((payload.items || []) as MemberItem[]);
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : "Member search failed"));
    } finally {
      setMembersLoading(false);
    }
  }, []);

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
      if (!res.ok) throw new Error(payload?.error || "Load passes failed");
      const items = (payload.items || []) as PassItem[];
      setPassOptions(items);
      if (!items.some((item) => item.id === passId)) {
        setPassId(items[0]?.id || "");
      }
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : "Load passes failed"));
      setPassOptions([]);
      setPassId("");
    } finally {
      setPassesLoading(false);
    }
  }, [passId]);

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
      if (!res.ok) throw new Error(payload?.error || "Failed to load member overview");
      setMemberOverviewByBookingId((prev) => ({ ...prev, [item.id]: payload as CoachMemberOverviewResponse }));
    } catch (err) {
      setMemberOverviewErrorByBookingId((prev) => ({
        ...prev,
        [item.id]: translateApiError(err instanceof Error ? err.message : "Failed to load member overview"),
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
      if (!res.ok) throw new Error(payload?.error || "Update booking failed");
      setMessage(`Booking ${updateBookingId} updated to ${updateStatus}.`);
      setUpdateReason("");
      await loadBookings();
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : "Update booking failed"));
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
      if (!res.ok) throw new Error(payload?.error || "Redemption failed");
      setMessage(`Session redeemed for member ${memberId}.`);
      setRedeemNote("");
      if (redeemedKind === "pass") {
        setPassId("");
        setQuantity(1);
      }
      await loadBookings();
    } catch (err) {
      setError(translateApiError(err instanceof Error ? err.message : "Redemption failed"));
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold">Coach Portal</h1>
      <p className="mt-1 text-sm text-gray-600">
        My bookings: {bookings.length} | Active sessions: {activeCount}
      </p>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}

      <section className="card mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">My Schedule</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "today" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("today")}
            >
              Today
            </button>
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "week" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("week")}
            >
              This Week
            </button>
            <button
              type="button"
              className={`rounded border px-3 py-1 text-sm ${dateFilterPreset === "all" ? "bg-black text-white" : ""}`}
              onClick={() => applyPreset("all")}
            >
              All
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => void loadBookings()}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
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
            placeholder="Search service/memberId/note/bookingId"
            className="rounded border px-3 py-2 text-sm"
          />
          <select
            value={scheduleStatusFilter}
            onChange={(e) => setScheduleStatusFilter(e.target.value as ScheduleStatusFilter)}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="all">all status</option>
            <option value="booked">booked</option>
            <option value="checked_in">checked_in</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
            <option value="no_show">no_show</option>
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
                <span className={statusColor(item.status)}>{item.status}</span>       
              </div>
              <p className="mt-1">
                {item.service_name} | member: <code>{item.member_id}</code>
              </p>
              <p className="mt-1 text-gray-600">note: {item.note || "-"}</p>
              <p className="mt-2">
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded bg-black px-3 py-1 text-white"
                    onClick={() => bindBooking(item)}
                  >
                    Use in forms
                  </button>
                  <button
                    type="button"
                    className="rounded border px-3 py-1"
                    onClick={() => void toggleMemberOverview(item)}
                  >
                    {open ? "Hide member status" : "Member status"}
                  </button>
                </span>
              </p>

              {open ? (
                <div className="mt-3 rounded border bg-gray-50 p-3">
                  {overviewLoading ? (
                    <p className="text-xs text-gray-600">Loading member status...</p>
                  ) : overviewError ? (
                    <p className="text-xs text-red-600">{overviewError}</p>
                  ) : overview ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">Member</p>
                        <div className="mt-2 flex items-start gap-3">
                          {overview.member.photoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={overview.member.photoUrl}
                              alt="member photo"
                              className="h-12 w-12 rounded object-cover"
                            />
                          ) : (
                            <div className="h-12 w-12 rounded bg-gray-200" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {overview.member.fullName || "(no name)"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              phone last4: {overview.member.phoneLast4 || "-"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              memberId: <code>{overview.member.id}</code>
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">Plan</p>
                        <p className="mt-2 text-sm">
                          monthly:{" "}
                          {overview.subscription.expiresAt
                            ? new Date(overview.subscription.expiresAt).toLocaleDateString()
                            : "-"}
                          {" | "}
                          {overview.subscription.isActive === null
                            ? "unknown"
                            : overview.subscription.isActive
                              ? "active"
                              : "inactive"}
                        </p>
                        <p className="mt-2 text-xs text-gray-600">passes: {overview.passes.length}</p>
                        {overview.passes.length ? (
                          <ul className="mt-2 space-y-1 text-xs text-gray-700">
                            {overview.passes.slice(0, 5).map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1">
                                <span className="truncate">
                                  {p.passType || "pass"} | remain {p.remaining ?? "-"}
                                </span>
                                <span className="text-gray-600">
                                  exp {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString() : "-"}
                                </span>
                              </li>
                            ))}
                            {overview.passes.length > 5 ? (
                              <li className="text-gray-500">(+{overview.passes.length - 5} more)</li>
                            ) : null}
                          </ul>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">No passes.</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3 md:col-span-2">
                        <p className="text-xs font-semibold text-gray-700">Notes</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                          {overview.member.note || "-"}
                        </p>
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">Recent check-in</p>
                        {overview.recentCheckin ? (
                          <>
                            <p className="mt-2 text-sm">
                              {new Date(overview.recentCheckin.checkedAt).toLocaleString()} | {overview.recentCheckin.result || "-"}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              reason: {overview.recentCheckin.reason || "-"}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">No check-ins.</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3">
                        <p className="text-xs font-semibold text-gray-700">Recent redemption</p>
                        {overview.recentRedemption ? (
                          <>
                            <p className="mt-2 text-sm">
                              {new Date(overview.recentRedemption.redeemedAt).toLocaleString()} |{" "}
                              {overview.recentRedemption.kind || "-"}
                              {" | qty "}
                              {overview.recentRedemption.quantity}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">No redemptions.</p>
                        )}
                      </div>

                      <div className="rounded border bg-white p-3 md:col-span-2">
                        <p className="text-xs font-semibold text-gray-700">Recent booking</p>
                        {overview.recentBooking ? (
                          <p className="mt-2 text-sm">
                            {new Date(overview.recentBooking.startsAt).toLocaleString()} |{" "}
                            {overview.recentBooking.serviceName || "-"} | {overview.recentBooking.status || "-"}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">No bookings.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">No data.</p>
                  )}
                </div>
              ) : null}
            </li>
            );
          })}
          {!visibleBookings.length && !loading ? <li className="text-gray-500">No bookings.</li> : null}
        </ul>
      </section>

      <section className="card mt-6 grid gap-4 lg:grid-cols-2 p-4">
        <form className="rounded-lg border p-4" onSubmit={updateBooking}>
          <h2 className="text-lg font-semibold">Class Status & Notes</h2>
          <p className="mt-2">
            <input
              value={updateBookingId}
              onChange={(e) => setUpdateBookingId(e.target.value)}
              placeholder="bookingId"
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
              <option value="checked_in">checked_in</option>
              <option value="completed">completed</option>
              <option value="no_show">no_show</option>
            </select>
          </p>
          <p className="mt-2">
            <input
              value={updateNote}
              onChange={(e) => setUpdateNote(e.target.value)}
              placeholder="coach note"
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </p>
          <p className="mt-2">
            <input
              value={updateReason}
              onChange={(e) => setUpdateReason(e.target.value)}
              placeholder="reason (required)"
              className="w-full rounded border px-3 py-2 text-sm"
              required
            />
          </p>
          <button type="submit" className="mt-3 rounded bg-black px-4 py-2 text-sm text-white">
            Update Booking
          </button>
        </form>

        <form className="rounded-lg border p-4" onSubmit={redeem}>
          <h2 className="text-lg font-semibold">Session Redemption</h2>
          <p className="mt-2 text-xs text-gray-600">Search member</p>
          <p className="mt-1">
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="name / phone"
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
              {membersLoading ? "Searching..." : "Search Members"}
            </button>
          </p>
          <p className="mt-2">
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
              required
            >
              <option value="">Select member</option>
              {memberOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name} | {item.phone || "-"} | {item.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </p>
          <p className="mt-1 text-xs text-gray-600">memberId: {memberId || "-"}</p>
          <p className="mt-2">
            <select
              value={bookingId}
              onChange={(e) => setBookingId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">No booking link (optional)</option>
              {memberBookingOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.starts_at).toLocaleString()} | {item.service_name} | {item.status}
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
            <label htmlFor="redeemableOnly">Only show redeemable bookings (booked / checked_in)</label>
          </p>
          <p className="mt-1 text-xs text-gray-600">bookingId: {bookingId || "-"}</p>
          <p className="mt-2">
            <select
              value={redeemedKind}
              onChange={(e) => setRedeemedKind(e.target.value as "monthly" | "pass")}
              className="w-full rounded border px-3 py-2 text-sm"
            >
              <option value="monthly">monthly</option>
              <option value="pass">pass</option>
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
                    {passesLoading ? "Loading passes..." : passOptions.length ? "Select pass" : "No active pass"}
                  </option>
                  {passOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.pass_type} | remain {item.remaining} | exp{" "}
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
              placeholder="class note"
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </p>
          <button type="submit" className="mt-3 rounded bg-black px-4 py-2 text-sm text-white">
            Redeem Session
          </button>
        </form>
      </section>
    </main>
  );
}

export default function CoachPortalPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-6xl p-6 text-sm text-gray-600">Loading coach portal...</main>}>
      <CoachPortalContent />
    </Suspense>
  );
}

