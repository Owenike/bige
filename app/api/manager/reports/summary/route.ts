import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { listUnreconciledShiftEvents } from "../../../../../lib/shift-reconciliation";
import { summarizeOpportunities, type OpportunityRow } from "../../../../../lib/opportunities";
import type { ManagerReportsResponse } from "../../../../../types/manager-reports";

type BookingRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string;
  coach_id: string | null;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  public_reference: string | null;
  payment_status: string | null;
  booking_payment_mode: string | null;
  final_amount: number | string | null;
  outstanding_amount: number | string | null;
  deposit_paid_amount: number | string | null;
  package_sessions_reserved: number | string | null;
  package_sessions_consumed: number | string | null;
  entry_pass_id: string | null;
};

type MemberRow = { id: string; full_name: string; phone: string | null; store_id: string | null };
type BranchRow = { id: string; name: string; code: string | null; address: string | null; is_active: boolean };
type ProfileRow = { id: string; display_name: string | null; branch_id: string | null; role: string; is_active?: boolean | null };
type ServiceRow = { id: string; branch_id: string | null; name: string; code: string | null; price_amount: number | string | null; is_active: boolean | null };
type PaymentRow = { id: string; order_id: string; status: string; method: string; amount: number | string | null };
type ShiftRow = {
  id: string;
  branch_id: string | null;
  status: string;
  cash_total: number | string | null;
  card_total: number | string | null;
  transfer_total: number | string | null;
  expected_cash: number | string | null;
  counted_cash: number | string | null;
  difference: number | string | null;
  closing_confirmed: boolean | null;
};
type ShiftAdjustmentRow = { shift_id: string; amount: number | string | null };
type RedemptionRow = { id: string; booking_id: string | null };
type NotificationRow = { booking_id: string | null; status: string; source_ref_type: string | null };
type PackageLogRow = { booking_id: string; action: string; sessions_delta: number | string | null };

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return ((lower.includes("does not exist") && lower.includes(target)) || (lower.includes("could not find the table") && lower.includes(target)));
}

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function startOfWeek(date: string) {
  const target = new Date(`${date}T00:00:00.000Z`);
  const day = target.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  target.setUTCDate(target.getUTCDate() + delta);
  return target.toISOString().slice(0, 10);
}

function resolveRange(params: URLSearchParams) {
  const preset = (params.get("preset") || "this_month") as "today" | "this_week" | "this_month" | "custom";
  const fromParam = params.get("date_from") || params.get("from");
  const toParam = params.get("date_to") || params.get("to");
  const today = getTodayDateString();
  if (preset === "today") return { preset, dateFrom: today, dateTo: today, from: `${today}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` };
  if (preset === "this_week") {
    const dateFrom = startOfWeek(today);
    return { preset, dateFrom, dateTo: today, from: `${dateFrom}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` };
  }
  if (preset === "this_month") {
    const dateFrom = startOfMonth(today);
    return { preset, dateFrom, dateTo: today, from: `${dateFrom}T00:00:00.000Z`, to: `${today}T23:59:59.999Z` };
  }
  const dateFrom = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : today;
  const dateTo = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : dateFrom;
  return { preset: "custom" as const, dateFrom, dateTo, from: `${dateFrom}T00:00:00.000Z`, to: `${dateTo}T23:59:59.999Z` };
}

async function selectInChunks<T>(params: { values: string[]; chunkSize?: number; fetcher: (chunk: string[]) => Promise<T[]> }) {
  const items: T[] = [];
  const chunkSize = params.chunkSize || 200;
  for (let index = 0; index < params.values.length; index += chunkSize) {
    const chunk = params.values.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    const result = await params.fetcher(chunk);
    items.push(...result);
  }
  return items;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const params = new URL(request.url).searchParams;
  const range = resolveRange(params);
  const requestedBranchId = params.get("branch_id") || params.get("branchId");
  const requestedTherapistId = params.get("therapist_id") || params.get("coachId");
  const requestedServiceId = params.get("service_id") || params.get("serviceId");
  const requestedBookingStatus = params.get("booking_status") || params.get("status");
  const requestedPaymentMode = params.get("payment_mode") || params.get("paymentMode");
  const requestedPaymentStatus = params.get("payment_status") || params.get("paymentStatus");
  const requestedNotificationStatus = params.get("notification_status") || params.get("notificationStatus");

  const effectiveBranchId = auth.context.branchId || requestedBranchId || null;
  const effectiveTherapistId = auth.context.role === "coach" ? auth.context.userId : requestedTherapistId || null;

  const [branchesResult, therapistsResult, servicesResult] = await Promise.all([
    auth.supabase.from("branches").select("id, name, code, address, is_active").eq("tenant_id", auth.context.tenantId).eq("is_active", true).order("created_at", { ascending: true }),
    auth.supabase.from("profiles").select("id, display_name, branch_id, role, is_active").eq("tenant_id", auth.context.tenantId).eq("is_active", true).in("role", ["coach", "therapist"]).order("created_at", { ascending: true }),
    auth.supabase.from("services").select("id, branch_id, name, code, price_amount, is_active").eq("tenant_id", auth.context.tenantId).eq("is_active", true).order("name", { ascending: true }),
  ]);

  if (branchesResult.error) return apiError(500, "INTERNAL_ERROR", branchesResult.error.message);
  if (therapistsResult.error) return apiError(500, "INTERNAL_ERROR", therapistsResult.error.message);
  if (servicesResult.error) return apiError(500, "INTERNAL_ERROR", servicesResult.error.message);

  const branches = (branchesResult.data || []) as BranchRow[];
  const therapists = (therapistsResult.data || []) as ProfileRow[];
  const services = (servicesResult.data || []) as ServiceRow[];
  const serviceFilter = requestedServiceId ? services.find((item) => item.id === requestedServiceId) || null : null;

  let bookingsQuery = auth.supabase
    .from("bookings")
    .select("id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, customer_name, customer_phone, public_reference, payment_status, booking_payment_mode, final_amount, outstanding_amount, deposit_paid_amount, package_sessions_reserved, package_sessions_consumed, entry_pass_id")
    .eq("tenant_id", auth.context.tenantId)
    .gte("starts_at", range.from)
    .lte("starts_at", range.to)
    .order("starts_at", { ascending: false })
    .limit(5000);

  if (effectiveBranchId) bookingsQuery = bookingsQuery.eq("branch_id", effectiveBranchId);
  if (effectiveTherapistId) bookingsQuery = bookingsQuery.eq("coach_id", effectiveTherapistId);
  if (requestedBookingStatus) bookingsQuery = bookingsQuery.eq("status", requestedBookingStatus);
  if (requestedPaymentMode) bookingsQuery = bookingsQuery.eq("booking_payment_mode", requestedPaymentMode);
  if (requestedPaymentStatus) bookingsQuery = bookingsQuery.eq("payment_status", requestedPaymentStatus);
  if (serviceFilter) bookingsQuery = bookingsQuery.eq("service_name", serviceFilter.name);

  let paymentsQuery = auth.supabase.from("payments").select("id, order_id, status, method, amount").eq("tenant_id", auth.context.tenantId).gte("created_at", range.from).lte("created_at", range.to);
  let checkinsQuery = auth.supabase.from("checkins").select("result").eq("tenant_id", auth.context.tenantId).gte("checked_at", range.from).lte("checked_at", range.to);
  let shiftsQuery = auth.supabase
    .from("frontdesk_shifts")
    .select("id, branch_id, status, cash_total, card_total, transfer_total, expected_cash, counted_cash, difference, closing_confirmed")
    .eq("tenant_id", auth.context.tenantId)
    .gte("opened_at", range.from)
    .lte("opened_at", range.to);
  let redemptionsQuery = auth.supabase.from("session_redemptions").select("id, booking_id").eq("tenant_id", auth.context.tenantId).gte("created_at", range.from).lte("created_at", range.to);
  let adjustmentsQuery = auth.supabase.from("frontdesk_shift_items").select("shift_id, amount").eq("tenant_id", auth.context.tenantId).eq("event_type", "cash_adjustment").gte("created_at", range.from).lte("created_at", range.to);
  let opportunitiesQuery = auth.supabase
    .from("crm_opportunities")
    .select("id, tenant_id, branch_id, type, status, member_id, lead_id, source_ref_type, source_ref_id, owner_staff_id, priority, reason, note, due_at, next_action_at, snoozed_until, won_at, lost_at, last_activity_at, dedupe_key, created_by, updated_by, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .limit(3000);

  if (effectiveBranchId) {
    opportunitiesQuery = opportunitiesQuery.eq("branch_id", effectiveBranchId);
  }
  if (effectiveBranchId) {
    checkinsQuery = checkinsQuery.eq("store_id", effectiveBranchId);
    shiftsQuery = shiftsQuery.eq("branch_id", effectiveBranchId);
  }

  const [bookingsResult, paymentsResult, checkinsResult, shiftsResult, redemptionsResult, invoicesResult, orderRiskResult, adjustmentItemsResult, opportunitiesResult, ordersForPaymentsResult] = await Promise.all([
    bookingsQuery,
    paymentsQuery,
    checkinsQuery,
    shiftsQuery,
    redemptionsQuery,
    auth.supabase.from("audit_logs").select("action, target_id").eq("tenant_id", auth.context.tenantId).eq("target_type", "order").in("action", ["invoice_issue", "invoice_void", "invoice_allowance"]).gte("created_at", range.from).lte("created_at", range.to),
    auth.supabase.from("audit_logs").select("action, target_id").eq("tenant_id", auth.context.tenantId).in("action", ["order_void", "payment_refund"]).gte("created_at", range.from).lte("created_at", range.to),
    adjustmentsQuery,
    opportunitiesQuery,
    effectiveBranchId ? auth.supabase.from("orders").select("id").eq("tenant_id", auth.context.tenantId).eq("branch_id", effectiveBranchId) : Promise.resolve({ data: [], error: null }),
  ]);

  if (bookingsResult.error) return apiError(500, "INTERNAL_ERROR", bookingsResult.error.message);
  if (paymentsResult.error) return apiError(500, "INTERNAL_ERROR", paymentsResult.error.message);
  if (checkinsResult.error) return apiError(500, "INTERNAL_ERROR", checkinsResult.error.message);
  if (shiftsResult.error) return apiError(500, "INTERNAL_ERROR", shiftsResult.error.message);
  if (redemptionsResult.error) return apiError(500, "INTERNAL_ERROR", redemptionsResult.error.message);
  if (invoicesResult.error) return apiError(500, "INTERNAL_ERROR", invoicesResult.error.message);
  if (orderRiskResult.error) return apiError(500, "INTERNAL_ERROR", orderRiskResult.error.message);
  if (adjustmentItemsResult.error) return apiError(500, "INTERNAL_ERROR", adjustmentItemsResult.error.message);
  if (ordersForPaymentsResult.error) return apiError(500, "INTERNAL_ERROR", ordersForPaymentsResult.error.message);
  if (opportunitiesResult.error && !isMissingTableError(opportunitiesResult.error.message, "crm_opportunities")) {
    return apiError(500, "INTERNAL_ERROR", opportunitiesResult.error.message);
  }

  let bookings = (bookingsResult.data || []) as BookingRow[];
  const bookingIds = bookings.map((item) => item.id);
  const memberIds = Array.from(new Set(bookings.map((item) => item.member_id).filter(Boolean)));
  const bookingBranchIds = Array.from(new Set(bookings.map((item) => item.branch_id).filter(Boolean))) as string[];
  const bookingCoachIds = Array.from(new Set(bookings.map((item) => item.coach_id).filter(Boolean))) as string[];

  const [membersResult, bookingBranchesResult, bookingTherapistsResult] = await Promise.all([
    memberIds.length ? auth.supabase.from("members").select("id, full_name, phone, store_id").eq("tenant_id", auth.context.tenantId).in("id", memberIds) : Promise.resolve({ data: [], error: null }),
    bookingBranchIds.length ? auth.supabase.from("branches").select("id, name, code, address, is_active").eq("tenant_id", auth.context.tenantId).in("id", bookingBranchIds) : Promise.resolve({ data: [], error: null }),
    bookingCoachIds.length ? auth.supabase.from("profiles").select("id, display_name, branch_id, role").eq("tenant_id", auth.context.tenantId).in("id", bookingCoachIds) : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error) return apiError(500, "INTERNAL_ERROR", membersResult.error.message);
  if (bookingBranchesResult.error) return apiError(500, "INTERNAL_ERROR", bookingBranchesResult.error.message);
  if (bookingTherapistsResult.error) return apiError(500, "INTERNAL_ERROR", bookingTherapistsResult.error.message);

  const memberMap = new Map<string, MemberRow>();
  for (const row of (membersResult.data || []) as MemberRow[]) memberMap.set(row.id, row);
  const branchMap = new Map<string, BranchRow>();
  for (const row of branches) branchMap.set(row.id, row);
  for (const row of (bookingBranchesResult.data || []) as BranchRow[]) branchMap.set(row.id, row);
  const therapistMap = new Map<string, ProfileRow>();
  for (const row of therapists) therapistMap.set(row.id, row);
  for (const row of (bookingTherapistsResult.data || []) as ProfileRow[]) therapistMap.set(row.id, row);

  const notifications = bookingIds.length
    ? await selectInChunks<NotificationRow>({
        values: bookingIds,
        fetcher: async (chunk) => {
          const result = await auth.supabase.from("notification_deliveries").select("booking_id, status, source_ref_type").eq("tenant_id", auth.context.tenantId).in("booking_id", chunk);
          if (result.error) throw new Error(result.error.message);
          return (result.data || []) as NotificationRow[];
        },
      })
    : [];

  const packageLogs = bookingIds.length
    ? await selectInChunks<PackageLogRow>({
        values: bookingIds,
        fetcher: async (chunk) => {
          const result = await auth.supabase.from("booking_package_logs").select("booking_id, action, sessions_delta").eq("tenant_id", auth.context.tenantId).in("booking_id", chunk);
          if (result.error) {
            if (isMissingTableError(result.error.message, "booking_package_logs")) return [];
            throw new Error(result.error.message);
          }
          return (result.data || []) as PackageLogRow[];
        },
      })
    : [];

  if (requestedNotificationStatus) {
    const allowed = new Set(notifications.filter((item) => item.status === requestedNotificationStatus).map((item) => item.booking_id).filter(Boolean) as string[]);
    bookings = bookings.filter((item) => allowed.has(item.id));
  }

  const activeBookingIds = new Set(bookings.map((item) => item.id));
  const scopedNotifications = notifications.filter((item) => item.booking_id && activeBookingIds.has(item.booking_id));
  const scopedPackageLogs = packageLogs.filter((item) => activeBookingIds.has(item.booking_id));

  const notificationsByBooking = new Map<string, NotificationRow[]>();
  for (const row of scopedNotifications) {
    if (!row.booking_id) continue;
    const list = notificationsByBooking.get(row.booking_id) || [];
    list.push(row);
    notificationsByBooking.set(row.booking_id, list);
  }

  const packageLogsByBooking = new Map<string, PackageLogRow[]>();
  for (const row of scopedPackageLogs) {
    const list = packageLogsByBooking.get(row.booking_id) || [];
    list.push(row);
    packageLogsByBooking.set(row.booking_id, list);
  }

  const completedBookings = bookings.filter((item) => item.status === "completed");
  const memberIdsForMix = Array.from(new Set(completedBookings.map((item) => item.member_id)));
  const earliestCompletedByMember = new Map<string, string>();
  if (memberIdsForMix.length > 0) {
    const earliestRows = await selectInChunks<{ member_id: string; starts_at: string }>({
      values: memberIdsForMix,
      fetcher: async (chunk) => {
        let query = auth.supabase.from("bookings").select("member_id, starts_at").eq("tenant_id", auth.context.tenantId).eq("status", "completed").in("member_id", chunk).order("starts_at", { ascending: true });
        if (effectiveBranchId) query = query.eq("branch_id", effectiveBranchId);
        const result = await query.limit(5000);
        if (result.error) throw new Error(result.error.message);
        return (result.data || []) as Array<{ member_id: string; starts_at: string }>;
      },
    });
    for (const row of earliestRows) {
      if (!earliestCompletedByMember.has(row.member_id)) earliestCompletedByMember.set(row.member_id, row.starts_at);
    }
  }

  const summary = {
    bookingTotal: bookings.length,
    completedCount: bookings.filter((item) => item.status === "completed").length,
    cancelledCount: bookings.filter((item) => item.status === "cancelled").length,
    noShowCount: bookings.filter((item) => item.status === "no_show").length,
    completionRate: 0,
    cancellationRate: 0,
    noShowRate: 0,
    depositPaidTotal: bookings.reduce((sum, item) => sum + toNumber(item.deposit_paid_amount), 0),
    outstandingTotal: bookings.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + toNumber(item.outstanding_amount), 0),
    singleBookingRevenueTotal: bookings.filter((item) => (item.booking_payment_mode || "single") === "single").reduce((sum, item) => sum + toNumber(item.final_amount), 0),
    packageConsumedSessionsCount: bookings.reduce((sum, item) => sum + toNumber(item.package_sessions_consumed), 0),
    packageReservedSessionsCount: bookings.reduce((sum, item) => sum + toNumber(item.package_sessions_reserved), 0),
    newCustomerCount: 0,
    returningCustomerCount: 0,
  };

  if (summary.bookingTotal > 0) {
    summary.completionRate = summary.completedCount / summary.bookingTotal;
    summary.cancellationRate = summary.cancelledCount / summary.bookingTotal;
    summary.noShowRate = summary.noShowCount / summary.bookingTotal;
  }

  const completedMembersSeen = new Set<string>();
  for (const booking of completedBookings) {
    if (completedMembersSeen.has(booking.member_id)) continue;
    completedMembersSeen.add(booking.member_id);
    const earliest = earliestCompletedByMember.get(booking.member_id);
    if (earliest && earliest >= range.from && earliest <= range.to) summary.newCustomerCount += 1;
    else summary.returningCustomerCount += 1;
  }

  const therapistRanking = Array.from(bookings.reduce<Map<string, ManagerReportsResponse["therapistRanking"][number]>>((map, booking) => {
    const key = booking.coach_id || "unassigned";
    const current = map.get(key) || { therapistId: booking.coach_id || null, therapistName: booking.coach_id ? therapistMap.get(booking.coach_id)?.display_name || "Unknown therapist" : "Unassigned", bookingCount: 0, completedCount: 0, cancelledCount: 0, noShowCount: 0, completionRate: 0, singleBookingRevenueTotal: 0, packageConsumedSessionsCount: 0 };
    current.bookingCount += 1;
    if (booking.status === "completed") current.completedCount += 1;
    if (booking.status === "cancelled") current.cancelledCount += 1;
    if (booking.status === "no_show") current.noShowCount += 1;
    if ((booking.booking_payment_mode || "single") === "single") current.singleBookingRevenueTotal += toNumber(booking.final_amount);
    current.packageConsumedSessionsCount += toNumber(booking.package_sessions_consumed);
    map.set(key, current);
    return map;
  }, new Map())).map(([, item]) => ({ ...item, completionRate: item.bookingCount > 0 ? item.completedCount / item.bookingCount : 0 })).sort((left, right) => right.completedCount - left.completedCount || right.bookingCount - left.bookingCount).slice(0, 8);

  const serviceMap = new Map<string, ServiceRow>();
  for (const service of services) serviceMap.set(service.name, service);
  const serviceRanking = Array.from(bookings.reduce<Map<string, ManagerReportsResponse["serviceRanking"][number]>>((map, booking) => {
    const current = map.get(booking.service_name) || { serviceId: serviceMap.get(booking.service_name)?.id || null, serviceName: booking.service_name, bookingCount: 0, completedCount: 0, cancelledCount: 0, averagePrice: 0, minPrice: Number.POSITIVE_INFINITY, maxPrice: 0 };
    const amount = toNumber(booking.final_amount);
    current.bookingCount += 1;
    if (booking.status === "completed") current.completedCount += 1;
    if (booking.status === "cancelled") current.cancelledCount += 1;
    current.averagePrice += amount;
    current.minPrice = Math.min(current.minPrice, amount);
    current.maxPrice = Math.max(current.maxPrice, amount);
    map.set(booking.service_name, current);
    return map;
  }, new Map())).map(([, item]) => ({ ...item, averagePrice: item.bookingCount > 0 ? item.averagePrice / item.bookingCount : 0, minPrice: Number.isFinite(item.minPrice) ? item.minPrice : 0 })).sort((left, right) => right.bookingCount - left.bookingCount || right.completedCount - left.completedCount).slice(0, 8);

  const hotTimeSlots = Array.from(bookings.reduce<Map<number, ManagerReportsResponse["hotTimeSlots"][number]>>((map, booking) => {
    const hour = new Date(booking.starts_at).getUTCHours();
    const current = map.get(hour) || { hour, label: `${String(hour).padStart(2, "0")}:00`, bookingCount: 0, completedCount: 0 };
    current.bookingCount += 1;
    if (booking.status === "completed") current.completedCount += 1;
    map.set(hour, current);
    return map;
  }, new Map())).map(([, item]) => item).sort((left, right) => right.bookingCount - left.bookingCount || left.hour - right.hour).slice(0, 8);

  const paymentSummary = {
    byStatus: bookings.reduce<Record<string, number>>((acc, item) => {
      const key = item.payment_status || "unpaid";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    depositPaidTotal: summary.depositPaidTotal,
    outstandingTotal: summary.outstandingTotal,
    singleBookingRevenueTotal: summary.singleBookingRevenueTotal,
    singleBookingCount: bookings.filter((item) => (item.booking_payment_mode || "single") === "single").length,
    packageBookingCount: bookings.filter((item) => item.booking_payment_mode === "package").length,
  };

  const packageSummary = {
    activePackageBookingCount: bookings.filter((item) => item.booking_payment_mode === "package").length,
    currentReservedSessionsCount: summary.packageReservedSessionsCount,
    currentConsumedSessionsCount: summary.packageConsumedSessionsCount,
    reserveActionCount: scopedPackageLogs.filter((item) => item.action === "reserve").length,
    consumeActionCount: scopedPackageLogs.filter((item) => item.action === "consume").length,
    releaseActionCount: scopedPackageLogs.filter((item) => item.action === "release").length,
  };

  const notificationSummary = scopedNotifications.reduce<ManagerReportsResponse["notificationSummary"]>((acc, row) => {
    acc.byStatus[row.status] = (acc.byStatus[row.status] || 0) + 1;
    const eventType = row.source_ref_type || "booking_notification";
    acc.byEventType[eventType] = (acc.byEventType[eventType] || 0) + 1;
    if (row.status === "pending" || row.status === "retrying") acc.queuedCount += 1;
    if (row.status === "sent") acc.sentCount += 1;
    if (row.status === "failed" || row.status === "dead_letter") acc.failedCount += 1;
    if (row.status === "cancelled") acc.cancelledCount += 1;
    if ((eventType === "booking_reminder_day_before" || eventType === "booking_reminder_1h") && row.status === "sent") acc.reminderSentCount += 1;
    if (eventType === "booking_deposit_pending" && (row.status === "pending" || row.status === "retrying")) acc.depositPendingQueuedCount += 1;
    return acc;
  }, { queuedCount: 0, sentCount: 0, failedCount: 0, cancelledCount: 0, reminderSentCount: 0, depositPendingQueuedCount: 0, byEventType: {}, byStatus: {} });

  const detailRows = bookings.slice(0, 120).map((booking) => {
    const member = memberMap.get(booking.member_id) || null;
    const branch = branchMap.get(booking.branch_id || member?.store_id || "") || null;
    const therapist = booking.coach_id ? therapistMap.get(booking.coach_id) || null : null;
    const bookingNotifications = notificationsByBooking.get(booking.id) || [];
    const bookingPackageLogs = packageLogsByBooking.get(booking.id) || [];
    return {
      bookingId: booking.id,
      publicReference: booking.public_reference || null,
      startsAt: booking.starts_at,
      customerName: booking.customer_name || member?.full_name || "Unknown customer",
      customerPhone: booking.customer_phone || member?.phone || null,
      branchName: branch?.name || null,
      therapistName: therapist?.display_name || null,
      serviceName: booking.service_name,
      status: booking.status,
      paymentMode: booking.booking_payment_mode || "single",
      paymentStatus: booking.payment_status || "unpaid",
      finalAmount: toNumber(booking.final_amount),
      outstandingAmount: toNumber(booking.outstanding_amount),
      depositPaidAmount: toNumber(booking.deposit_paid_amount),
      packageReservedSessions: toNumber(booking.package_sessions_reserved) || bookingPackageLogs.filter((item) => item.action === "reserve").length,
      packageConsumedSessions: toNumber(booking.package_sessions_consumed) || bookingPackageLogs.filter((item) => item.action === "consume").length,
      notificationQueuedCount: bookingNotifications.filter((item) => item.status === "pending" || item.status === "retrying").length,
      notificationFailedCount: bookingNotifications.filter((item) => item.status === "failed" || item.status === "dead_letter").length,
    };
  });

  const allowedOrderIds = new Set(((ordersForPaymentsResult.data || []) as Array<{ id: string }>).map((item) => item.id));
  const payments = ((paymentsResult.data || []) as PaymentRow[]).filter((item) => !effectiveBranchId || allowedOrderIds.has(item.order_id));
  const checkins = (checkinsResult.data || []) as Array<{ result: string }>;
  const shifts = (shiftsResult.data || []) as ShiftRow[];
  const allowedShiftIds = new Set(shifts.map((item) => item.id));
  const redemptions = ((redemptionsResult.data || []) as RedemptionRow[]).filter((item) => !effectiveBranchId || !item.booking_id || activeBookingIds.has(item.booking_id));
  const allowedPaymentIds = new Set(payments.map((item) => item.id));
  const invoiceAudits = ((invoicesResult.data || []) as Array<{ action: string; target_id: string | null }>).filter((item) => !effectiveBranchId || (item.target_id ? allowedOrderIds.has(item.target_id) : false));
  const riskAudits = ((orderRiskResult.data || []) as Array<{ action: string; target_id: string | null }>).filter((item) => {
    if (!effectiveBranchId) return true;
    if (!item.target_id) return false;
    if (item.action === "order_void") return allowedOrderIds.has(item.target_id);
    if (item.action === "payment_refund") return allowedPaymentIds.has(item.target_id);
    return false;
  });
  const adjustments = ((adjustmentItemsResult.data || []) as ShiftAdjustmentRow[]).filter((item) => !effectiveBranchId || allowedShiftIds.has(item.shift_id));
  const opportunities = ((opportunitiesResult.data || []) as OpportunityRow[]) || [];

  const totalPaid = payments.filter((item) => item.status === "paid").reduce((sum, item) => sum + toNumber(item.amount), 0);
  const totalRefunded = payments.filter((item) => item.status === "refunded").reduce((sum, item) => sum + toNumber(item.amount), 0);
  const paidByMethod = {
    cash: payments.filter((item) => item.status === "paid" && item.method === "cash").reduce((sum, item) => sum + toNumber(item.amount), 0),
    card: payments.filter((item) => item.status === "paid" && item.method === "card").reduce((sum, item) => sum + toNumber(item.amount), 0),
    transfer: payments.filter((item) => item.status === "paid" && item.method === "transfer").reduce((sum, item) => sum + toNumber(item.amount), 0),
    newebpay: payments.filter((item) => item.status === "paid" && item.method === "newebpay").reduce((sum, item) => sum + toNumber(item.amount), 0),
    manual: payments.filter((item) => item.status === "paid" && item.method === "manual").reduce((sum, item) => sum + toNumber(item.amount), 0),
  };
  const bookingByStatus = bookings.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const shiftTotals = shifts.reduce((acc, item) => {
    if (item.status === "closed") {
      acc.cash += toNumber(item.cash_total);
      acc.card += toNumber(item.card_total);
      acc.transfer += toNumber(item.transfer_total);
      acc.expectedCash += toNumber(item.expected_cash);
      acc.countedCash += toNumber(item.counted_cash ?? item.cash_total);
      acc.difference += toNumber(item.difference);
    }
    return acc;
  }, { cash: 0, card: 0, transfer: 0, expectedCash: 0, countedCash: 0, difference: 0 });

  const unreconciled = await listUnreconciledShiftEvents({ supabase: auth.supabase, tenantId: auth.context.tenantId, from: range.from, to: range.to, limit: 200 });
  if (!unreconciled.ok) return apiError(500, "INTERNAL_ERROR", unreconciled.error);
  const unreconciledByEventType = unreconciled.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.eventType] = (acc[item.eventType] || 0) + 1;
    return acc;
  }, {});
  const opportunitySummary = summarizeOpportunities(opportunities, new Date());
  const actionableOpportunities = opportunitySummary.open + opportunitySummary.inProgress + opportunitySummary.snoozed;

  return apiSuccess<ManagerReportsResponse>({
    range: { preset: range.preset, dateFrom: range.dateFrom, dateTo: range.dateTo, from: range.dateFrom, to: range.dateTo },
    filters: {
      presets: [{ value: "today", label: "Today" }, { value: "this_week", label: "This Week" }, { value: "this_month", label: "This Month" }, { value: "custom", label: "Custom" }],
      branches: branches.filter((item) => !auth.context.branchId || item.id === auth.context.branchId).map((item) => ({ id: item.id, label: item.name, secondaryLabel: item.code || item.address || null })),
      therapists: therapists.filter((item) => auth.context.role !== "coach" || item.id === auth.context.userId).filter((item) => !effectiveBranchId || !item.branch_id || item.branch_id === effectiveBranchId).map((item) => ({ id: item.id, label: item.display_name || item.id.slice(0, 8), secondaryLabel: item.branch_id ? branchMap.get(item.branch_id)?.name || null : null })),
      services: services.filter((item) => !effectiveBranchId || !item.branch_id || item.branch_id === effectiveBranchId).map((item) => ({ id: item.id, label: item.name, secondaryLabel: item.code || null })),
      statuses: [{ value: "", label: "All Statuses" }, { value: "pending", label: "Pending" }, { value: "booked", label: "Confirmed" }, { value: "checked_in", label: "Checked In" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "no_show", label: "No Show" }],
      paymentModes: [{ value: "", label: "All Payment Modes" }, { value: "single", label: "Single" }, { value: "package", label: "Package" }],
      paymentStatuses: [{ value: "", label: "All Payment Statuses" }, { value: "unpaid", label: "Unpaid" }, { value: "deposit_pending", label: "Deposit Pending" }, { value: "deposit_paid", label: "Deposit Paid" }, { value: "fully_paid", label: "Fully Paid" }, { value: "refunded", label: "Refunded" }, { value: "partially_refunded", label: "Partially Refunded" }],
      notificationStatuses: [{ value: "", label: "All Notification Statuses" }, { value: "pending", label: "Queued" }, { value: "sent", label: "Sent" }, { value: "failed", label: "Failed" }, { value: "cancelled", label: "Cancelled" }],
      branchLocked: Boolean(auth.context.branchId),
      currentBranchId: auth.context.branchId,
    },
    summary,
    therapistRanking,
    serviceRanking,
    hotTimeSlots,
    paymentSummary,
    packageSummary,
    notificationSummary,
    detailRows,
    payments: { totalPaid, totalRefunded, paidCount: payments.filter((item) => item.status === "paid").length, refundedCount: payments.filter((item) => item.status === "refunded").length, byMethod: paidByMethod },
    checkins: { allow: checkins.filter((item) => item.result === "allow").length, deny: checkins.filter((item) => item.result === "deny").length },
    bookings: { total: bookings.length, byStatus: bookingByStatus },
    handover: { openShiftCount: shifts.filter((item) => item.status === "open").length, closedShiftCount: shifts.filter((item) => item.status === "closed").length, differenceShiftCount: shifts.filter((item) => item.status === "closed" && Math.abs(toNumber(item.difference)) >= 0.01).length, unconfirmedCloseCount: shifts.filter((item) => item.status === "closed" && item.closing_confirmed === false).length, closedTotals: { ...shiftTotals, cashAdjustmentNet: adjustments.reduce((sum, item) => sum + toNumber(item.amount), 0) } },
    operations: { invoiceCount: invoiceAudits.length, redemptionCount: redemptions.length, voidCount: riskAudits.filter((item) => item.action === "order_void").length, refundCount: riskAudits.filter((item) => item.action === "payment_refund").length, entryCount: checkins.filter((item) => item.result === "allow").length, unreconciledCount: unreconciled.items.length, unreconciledByEventType },
    opportunities: { total: opportunitySummary.total, actionable: actionableOpportunities, open: opportunitySummary.open, inProgress: opportunitySummary.inProgress, highPriority: opportunitySummary.highPriority, dueSoon: opportunitySummary.dueSoon, overdue: opportunitySummary.overdue, byType: opportunitySummary.byType, byStatus: opportunitySummary.byStatus },
  });
}
