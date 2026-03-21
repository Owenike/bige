import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../lib/auth-context";
import {
  createOrReuseBookingDepositPayment,
  loadBookingDepositLiveSmokeEvidenceMap,
} from "../../../lib/booking-deposit-payments";
import {
  BookingCommercialError,
  mapBookingCommercialSnapshot,
  prepareBookingCommercials,
  reservePackageForBooking,
} from "../../../lib/booking-commerce";
import { scheduleBookingNotifications, summarizeBookingNotifications } from "../../../lib/booking-notifications";
import { BOOKING_THERAPIST_ROLES, mapBookingConflictError, validateBookingSchedule } from "../../../lib/therapist-scheduling";
import type { BookingOverviewItem, BookingOverviewResponse, BookingPaymentStatus } from "../../../types/booking-management";

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
  note: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_note?: string | null;
  public_reference?: string | null;
  source?: string | null;
  payment_status?: string | null;
  booking_payment_mode?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_updated_at?: string | null;
  deposit_required_amount?: number | string | null;
  deposit_paid_amount?: number | string | null;
  final_amount?: number | string | null;
  outstanding_amount?: number | string | null;
  entry_pass_id?: string | null;
  member_plan_contract_id?: string | null;
  package_sessions_reserved?: number | string | null;
  package_sessions_consumed?: number | string | null;
  status_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MemberRow = {
  id: string;
  full_name: string;
  phone: string | null;
  store_id: string | null;
};

type StaffRow = {
  id: string;
  display_name: string | null;
  branch_id: string | null;
  role: string;
};

type BranchRow = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
};

type BookingApiContext = {
  tenantId: string | null;
  branchId: string | null;
  role: string;
  userId: string;
};

type BookingApiAuth = {
  supabase: any;
  context: BookingApiContext;
};

function parseRoomFromNote(note: string | null) {
  if (!note) return "";
  const match = note.match(/\[room:([^\]]+)\]/i);
  return match?.[1]?.trim() || "";
}

function stripRoomToken(note: string | null) {
  if (!note) return "";
  return note.replace(/\[room:[^\]]+\]/ig, "").trim();
}

function isMissingBookingColumn(message: string | undefined) {
  if (!message) return false;
  return [
    "customer_name",
    "customer_phone",
    "customer_note",
    "public_reference",
    "source",
    "payment_status",
    "booking_payment_mode",
    "payment_method",
    "payment_reference",
    "payment_updated_at",
    "deposit_required_amount",
    "deposit_paid_amount",
    "final_amount",
    "outstanding_amount",
    "entry_pass_id",
    "member_plan_contract_id",
    "package_sessions_reserved",
    "package_sessions_consumed",
    "status_reason",
  ].some((column) => message.includes(column));
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function shortNote(note: string | null) {
  if (!note) return null;
  const cleaned = stripRoomToken(note);
  if (!cleaned) return null;
  return cleaned.length > 96 ? `${cleaned.slice(0, 93)}...` : cleaned;
}

function summaryStatus(status: string) {
  if (status === "booked" || status === "checked_in" || status === "confirmed") return "confirmed";
  return status;
}

function paymentDepositState(item: Pick<BookingOverviewItem, "depositRequiredAmount" | "depositPaidAmount" | "paymentStatus">) {
  if (item.depositRequiredAmount <= 0) return "none";
  if (item.depositPaidAmount > 0 || item.paymentStatus === "deposit_paid" || item.paymentStatus === "fully_paid") return "paid";
  return "unpaid";
}

async function selectBookingRows(params: {
  auth: BookingApiAuth;
  date: string | null;
  from: string | null;
  to: string | null;
  branchId: string | null;
  coachId: string | null;
  status: string | null;
  noShowOnly: boolean;
}) {
  const { auth } = params;
  const dateFrom = params.date ? `${params.date}T00:00:00.000Z` : params.from;
  const dateTo = params.date ? `${params.date}T23:59:59.999Z` : params.to;

  let query = auth.supabase
    .from("bookings")
    .select(
      "id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, customer_name, customer_phone, customer_note, public_reference, source, payment_status, booking_payment_mode, payment_method, payment_reference, payment_updated_at, deposit_required_amount, deposit_paid_amount, final_amount, outstanding_amount, entry_pass_id, member_plan_contract_id, package_sessions_reserved, package_sessions_consumed, status_reason, created_at, updated_at",
    )
    .eq("tenant_id", auth.context.tenantId)
    .order("starts_at", { ascending: true })
    .limit(300);

  if (dateFrom) query = query.gte("starts_at", dateFrom);
  if (dateTo) query = query.lte("starts_at", dateTo);
  if (params.branchId) query = query.eq("branch_id", params.branchId);
  if (params.coachId) query = query.eq("coach_id", params.coachId);
  if (params.status) query = query.eq("status", params.status);
  if (params.noShowOnly) query = query.eq("status", "no_show");
  if (auth.context.role === "coach") query = query.eq("coach_id", auth.context.userId);
  if (auth.context.branchId) query = query.eq("branch_id", auth.context.branchId);

  const result = await query;
  if (result.error && isMissingBookingColumn(result.error.message)) {
    let fallbackQuery = auth.supabase
      .from("bookings")
      .select("id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, created_at, updated_at")
      .eq("tenant_id", auth.context.tenantId)
      .order("starts_at", { ascending: true })
      .limit(300);

    if (dateFrom) fallbackQuery = fallbackQuery.gte("starts_at", dateFrom);
    if (dateTo) fallbackQuery = fallbackQuery.lte("starts_at", dateTo);
    if (params.branchId) fallbackQuery = fallbackQuery.eq("branch_id", params.branchId);
    if (params.coachId) fallbackQuery = fallbackQuery.eq("coach_id", params.coachId);
    if (params.status) fallbackQuery = fallbackQuery.eq("status", params.status);
    if (params.noShowOnly) fallbackQuery = fallbackQuery.eq("status", "no_show");
    if (auth.context.role === "coach") fallbackQuery = fallbackQuery.eq("coach_id", auth.context.userId);
    if (auth.context.branchId) fallbackQuery = fallbackQuery.eq("branch_id", auth.context.branchId);

    const fallbackResult = await fallbackQuery;
    if (fallbackResult.error) return fallbackResult;
    return {
      data: ((fallbackResult.data || []) as BookingRow[]).map((row) => ({
        ...row,
        customer_name: null,
        customer_phone: null,
        customer_note: null,
        public_reference: null,
        source: "staff",
        payment_status: "unpaid",
        booking_payment_mode: "single",
        payment_method: null,
        payment_reference: null,
        payment_updated_at: null,
        deposit_required_amount: 0,
        deposit_paid_amount: 0,
        final_amount: 0,
        outstanding_amount: 0,
        entry_pass_id: null,
        member_plan_contract_id: null,
        package_sessions_reserved: 0,
        package_sessions_consumed: 0,
        status_reason: null,
      })),
      error: null,
    };
  }

  return {
    data: (result.data || []) as BookingRow[],
    error: result.error,
  };
}

function toOverviewItem(params: {
  row: BookingRow;
  member: MemberRow | null;
  branch: BranchRow | null;
  coach: StaffRow | null;
  packageName: string | null;
}): BookingOverviewItem {
  const commercial = mapBookingCommercialSnapshot({
    booking_payment_mode: params.row.booking_payment_mode,
    payment_status: params.row.payment_status,
    final_amount: params.row.final_amount,
    outstanding_amount: params.row.outstanding_amount,
    deposit_required_amount: params.row.deposit_required_amount,
    deposit_paid_amount: params.row.deposit_paid_amount,
    payment_method: params.row.payment_method,
    payment_reference: params.row.payment_reference,
    payment_updated_at: params.row.payment_updated_at,
    entry_pass_id: params.row.entry_pass_id,
    member_plan_contract_id: params.row.member_plan_contract_id,
    package_sessions_reserved: params.row.package_sessions_reserved,
    package_sessions_consumed: params.row.package_sessions_consumed,
    package_name: params.packageName,
  });
  return {
    id: params.row.id,
    publicReference: params.row.public_reference || null,
    customerName: params.row.customer_name || params.member?.full_name || "Unknown customer",
    customerPhone: params.row.customer_phone || params.member?.phone || null,
    branchId: params.row.branch_id || params.member?.store_id || params.coach?.branch_id || null,
    branchName: params.branch?.name || null,
    therapistId: params.row.coach_id || null,
    therapistName: params.coach?.display_name || null,
    serviceName: params.row.service_name,
    startsAt: params.row.starts_at,
    endsAt: params.row.ends_at,
    status: params.row.status,
    paymentStatus: commercial.paymentStatus as BookingPaymentStatus | string,
    paymentMode: commercial.paymentMode,
    source: params.row.source || "staff",
    noteExcerpt: shortNote(params.row.customer_note || params.row.note || null),
    depositRequiredAmount: commercial.depositRequiredAmount,
    depositPaidAmount: commercial.depositPaidAmount,
    finalAmount: commercial.finalAmount,
    outstandingAmount: commercial.outstandingAmount,
    paymentMethod: commercial.paymentMethod,
    paymentReference: commercial.paymentReference,
    paymentUpdatedAt: commercial.paymentUpdatedAt,
    liveSmokeStatus: "not_recorded",
    liveSmokePerformedAt: null,
    liveSmokeProvider: null,
    liveSmokeReference: null,
    packageName: commercial.packageName,
    entryPassId: commercial.entryPassId,
    contractId: commercial.contractId,
    packageSessionsReserved: commercial.packageSessionsReserved,
    packageSessionsConsumed: commercial.packageSessionsConsumed,
    createdAt: params.row.created_at || null,
    updatedAt: params.row.updated_at || null,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const branchId = searchParams.get("branchId");
  const coachId = searchParams.get("coachId");
  const status = searchParams.get("status");
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const deposit = searchParams.get("deposit");
  const liveSmoke = searchParams.get("liveSmoke");
  const noShowOnly = searchParams.get("noShow") === "1";

  const bookingRowsResult = await selectBookingRows({
    auth: {
      supabase: auth.supabase,
      context: {
        tenantId: auth.context.tenantId,
        branchId: auth.context.branchId,
        role: auth.context.role,
        userId: auth.context.userId,
      },
    },
    date,
    from,
    to,
    branchId,
    coachId,
    status,
    noShowOnly,
  });
  if (bookingRowsResult.error) return apiError(500, "INTERNAL_ERROR", bookingRowsResult.error.message);

  const rows: BookingRow[] = bookingRowsResult.data || [];
  const memberIds = Array.from(new Set(rows.map((item) => item.member_id).filter(Boolean)));
  const coachIds = Array.from(new Set(rows.map((item) => item.coach_id).filter(Boolean))) as string[];
  const branchIds = Array.from(new Set(rows.map((item) => item.branch_id).filter(Boolean))) as string[];
  const entryPassIds = Array.from(new Set(rows.map((item) => item.entry_pass_id).filter(Boolean))) as string[];

  const [memberResult, coachResult, branchResult, filterBranchResult, filterTherapistResult, passesResult] = await Promise.all([
    memberIds.length > 0
      ? auth.supabase
          .from("members")
          .select("id, full_name, phone, store_id")
          .eq("tenant_id", auth.context.tenantId)
          .in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    coachIds.length > 0
      ? auth.supabase
          .from("profiles")
          .select("id, display_name, branch_id, role")
          .eq("tenant_id", auth.context.tenantId)
          .in("id", coachIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length > 0
      ? auth.supabase
          .from("branches")
          .select("id, name, code, address, is_active")
          .eq("tenant_id", auth.context.tenantId)
          .in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
    auth.supabase
      .from("branches")
      .select("id, name, code, address, is_active")
      .eq("tenant_id", auth.context.tenantId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    auth.supabase
      .from("profiles")
      .select("id, display_name, branch_id, role")
      .eq("tenant_id", auth.context.tenantId)
      .eq("is_active", true)
      .in("role", [...BOOKING_THERAPIST_ROLES])
      .order("created_at", { ascending: true }),
    entryPassIds.length
      ? auth.supabase
          .from("entry_passes")
          .select("id, plan_catalog_id")
          .eq("tenant_id", auth.context.tenantId)
          .in("id", entryPassIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (coachResult.error) return apiError(500, "INTERNAL_ERROR", coachResult.error.message);
  if (branchResult.error) return apiError(500, "INTERNAL_ERROR", branchResult.error.message);
  if (filterBranchResult.error) return apiError(500, "INTERNAL_ERROR", filterBranchResult.error.message);
  if (filterTherapistResult.error) return apiError(500, "INTERNAL_ERROR", filterTherapistResult.error.message);
  if (passesResult.error && !isMissingBookingColumn(passesResult.error.message)) {
    return apiError(500, "INTERNAL_ERROR", passesResult.error.message);
  }

  const memberMap = new Map<string, MemberRow>();
  for (const row of (memberResult.data || []) as MemberRow[]) memberMap.set(row.id, row);

  const coachMap = new Map<string, StaffRow>();
  for (const row of (coachResult.data || []) as StaffRow[]) coachMap.set(row.id, row);

  const branchMap = new Map<string, BranchRow>();
  for (const row of (branchResult.data || []) as BranchRow[]) branchMap.set(row.id, row);
  for (const row of (filterBranchResult.data || []) as BranchRow[]) branchMap.set(row.id, row);

  const passPlanMap = new Map<string, string>();
  const passPlanIds = new Set<string>();
  for (const row of (passesResult.data || []) as Array<{ id: string; plan_catalog_id: string | null }>) {
    if (row.plan_catalog_id) {
      passPlanMap.set(row.id, row.plan_catalog_id);
      passPlanIds.add(row.plan_catalog_id);
    }
  }
  const planNameMap = new Map<string, string>();
  if (passPlanIds.size > 0) {
    const plansResult = await auth.supabase
      .from("member_plan_catalog")
      .select("id, name")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", Array.from(passPlanIds));
    if (plansResult.error) return apiError(500, "INTERNAL_ERROR", plansResult.error.message);
    for (const row of (plansResult.data || []) as Array<{ id: string; name: string }>) {
      planNameMap.set(row.id, row.name);
    }
  }

  let items = rows.map((row) =>
    toOverviewItem({
      row,
      member: memberMap.get(row.member_id) || null,
      coach: row.coach_id ? coachMap.get(row.coach_id) || null : null,
      branch: branchMap.get(row.branch_id || memberMap.get(row.member_id)?.store_id || "") || null,
      packageName: row.entry_pass_id ? planNameMap.get(passPlanMap.get(row.entry_pass_id) || "") || null : null,
    }),
  );

  const bookingIds = items.map((item) => item.id);
  if (bookingIds.length > 0) {
    const notificationsResult = await auth.supabase
      .from("notification_deliveries")
      .select("booking_id, status, source_ref_type")
      .eq("tenant_id", auth.context.tenantId)
      .in("booking_id", bookingIds);
    if (notificationsResult.error && !isMissingBookingColumn(notificationsResult.error.message)) {
      return apiError(500, "INTERNAL_ERROR", notificationsResult.error.message);
    }
    const summaryMap = new Map<string, { queued: number; failed: number; depositPendingQueued: boolean }>();
    for (const row of (notificationsResult.data || []) as Array<{ booking_id: string | null; status: string; source_ref_type: string | null }>) {
      if (!row.booking_id) continue;
      const next = summaryMap.get(row.booking_id) || { queued: 0, failed: 0, depositPendingQueued: false };
      const reduced = summarizeBookingNotifications([
        {
          id: "",
          eventType: row.source_ref_type || "booking_notification",
          channel: "",
          status: row.status,
          templateKey: null,
          deliveryMode: null,
          scheduledFor: null,
          sentAt: null,
          cancelledAt: null,
          skippedReason: null,
          failureReason: null,
          recipientName: null,
          recipientPhone: null,
          recipientEmail: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      next.queued += reduced.queued;
      next.failed += reduced.failed;
      next.depositPendingQueued = next.depositPendingQueued || reduced.depositPendingQueued;
      summaryMap.set(row.booking_id, next);
    }
    items = items.map((item) => {
      const summary = summaryMap.get(item.id);
      return summary
        ? {
            ...item,
            notificationQueuedCount: summary.queued,
            notificationFailedCount: summary.failed,
            hasDepositReminderPending: summary.depositPendingQueued,
          }
        : item;
    });
  }

  if (bookingIds.length > 0) {
    const liveSmokeMap = await loadBookingDepositLiveSmokeEvidenceMap({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingIds,
    });
    items = items.map((item) => {
      const liveSmokeEvidence = liveSmokeMap.get(item.id);
      return liveSmokeEvidence
        ? {
            ...item,
            liveSmokeStatus: liveSmokeEvidence.smokeResult,
            liveSmokePerformedAt: liveSmokeEvidence.performedAt,
            liveSmokeProvider: liveSmokeEvidence.provider,
            liveSmokeReference: liveSmokeEvidence.providerReference || liveSmokeEvidence.paymentReference || null,
          }
        : item;
    });
  }

  if (q) {
    items = items.filter((item) =>
      [
        item.customerName,
        item.customerPhone,
        item.publicReference,
        item.serviceName,
        item.packageName,
        item.therapistName,
        item.branchName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }

  if (deposit === "paid") {
    items = items.filter((item) => paymentDepositState(item) === "paid");
  } else if (deposit === "unpaid") {
    items = items.filter((item) => paymentDepositState(item) === "unpaid");
  }

  if (liveSmoke && ["not_recorded", "pass", "partial", "fail"].includes(liveSmoke)) {
    items = items.filter((item) => item.liveSmokeStatus === liveSmoke);
  }

  const filterBranches = ((filterBranchResult.data || []) as BranchRow[])
    .filter((item) => !auth.context.branchId || item.id === auth.context.branchId)
    .map((item) => ({
      id: item.id,
      label: item.name,
      secondaryLabel: item.code || item.address || null,
    }));

  const filterTherapists = ((filterTherapistResult.data || []) as StaffRow[])
    .filter((item) => auth.context.role !== "coach" || item.id === auth.context.userId)
    .filter((item) => !auth.context.branchId || !item.branch_id || item.branch_id === auth.context.branchId)
    .map((item) => ({
      id: item.id,
      label: item.display_name || item.id.slice(0, 8),
      secondaryLabel: item.branch_id ? branchMap.get(item.branch_id)?.name || null : null,
    }));

  const summary = items.reduce<BookingOverviewResponse["summary"]>(
    (acc, item) => {
      acc.total += 1;
      const normalized = summaryStatus(item.status);
      if (normalized === "pending") acc.pending += 1;
      if (normalized === "confirmed") acc.confirmed += 1;
      if (normalized === "completed") acc.completed += 1;
      if (normalized === "cancelled") acc.cancelled += 1;
      if (normalized === "no_show") acc.noShow += 1;
      acc.depositOutstanding += Math.max(0, item.depositRequiredAmount - item.depositPaidAmount);
      acc.packageReserved += item.packageSessionsReserved;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
      depositOutstanding: 0,
      packageReserved: 0,
    },
  );

  return apiSuccess<BookingOverviewResponse>({
    items,
    filters: {
      branches: filterBranches,
      therapists: filterTherapists,
      statuses: [
        { value: "pending", label: "Pending" },
        { value: "booked", label: "Confirmed" },
        { value: "checked_in", label: "Checked In" },
        { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" },
        { value: "no_show", label: "No Show" },
      ],
      liveSmokeStatuses: [
        { value: "", label: "All evidence states" },
        { value: "not_recorded", label: "Not recorded" },
        { value: "pass", label: "Pass" },
        { value: "partial", label: "Partial" },
        { value: "fail", label: "Fail" },
      ],
      branchLocked: Boolean(auth.context.branchId),
      currentBranchId: auth.context.branchId,
    },
    summary,
  });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;
  const paymentMode = typeof body?.paymentMode === "string" ? body.paymentMode : "single";
  const entryPassId = typeof body?.entryPassId === "string" ? body.entryPassId : null;

  if (!memberId || !serviceName || !startsAt || !endsAt) {
    return apiError(400, "FORBIDDEN", "Missing required fields");
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", memberId)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  if (auth.context.branchId && memberResult.data.store_id && memberResult.data.store_id !== auth.context.branchId) {
    return apiError(403, "BRANCH_SCOPE_DENIED", "Forbidden member access for current branch");
  }

  let commercials;
  const bookingBranchId = auth.context.branchId ?? memberResult.data.store_id ?? null;
  try {
    commercials = await prepareBookingCommercials({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      branchId: bookingBranchId,
      memberId,
      serviceName,
      paymentMode,
      entryPassId,
    });
  } catch (error) {
    if (error instanceof BookingCommercialError) {
      return apiError(error.status, error.code as "FORBIDDEN", error.message);
    }
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to prepare booking payment state");
  }

  const scheduleValidation = await validateBookingSchedule({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    branchId: bookingBranchId,
    memberId,
    coachId,
    serviceCode: commercials.service.code,
    serviceName: commercials.service.name,
    startsAt,
    endsAt,
  });
  if (!scheduleValidation.ok) {
    return apiError(409, "FORBIDDEN", scheduleValidation.message);
  }

  const room = parseRoomFromNote(note);
  if (room) {
    const roomCandidates = await auth.supabase
      .from("bookings")
      .select("id, note")
      .eq("tenant_id", auth.context.tenantId)
      .in("status", ["pending", "confirmed", "booked", "checked_in"])
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .limit(200);
    if (roomCandidates.error) return apiError(500, "INTERNAL_ERROR", roomCandidates.error.message);
    const roomConflict = (roomCandidates.data || []).find(
      (item: { note: string | null }) => parseRoomFromNote(item.note || null) === room,
    );
    if (roomConflict) return apiError(400, "FORBIDDEN", "Room time overlaps with another booking");
  }

  const { data, error } = await auth.supabase
    .from("bookings")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: bookingBranchId,
      member_id: memberId,
      coach_id: scheduleValidation.assignedCoachId,
      service_name: commercials.service.name,
      starts_at: startsAt,
      ends_at: endsAt,
      note,
      source: "staff",
      customer_note: note,
      booking_payment_mode: commercials.bookingInsertPatch.booking_payment_mode,
      entry_pass_id: commercials.bookingInsertPatch.entry_pass_id,
      member_plan_contract_id: commercials.bookingInsertPatch.member_plan_contract_id,
      package_sessions_reserved: commercials.bookingInsertPatch.package_sessions_reserved,
      package_sessions_consumed: commercials.bookingInsertPatch.package_sessions_consumed,
      payment_status: commercials.bookingInsertPatch.payment_status,
      deposit_required_amount: commercials.bookingInsertPatch.deposit_required_amount,
      deposit_paid_amount: commercials.bookingInsertPatch.deposit_paid_amount,
      final_amount: commercials.bookingInsertPatch.final_amount,
      outstanding_amount: commercials.bookingInsertPatch.outstanding_amount,
      payment_method: commercials.bookingInsertPatch.payment_method,
      payment_reference: commercials.bookingInsertPatch.payment_reference,
      payment_updated_at: commercials.bookingInsertPatch.payment_updated_at,
      created_by: auth.context.userId,
    })
    .select("id, member_id, status, starts_at, ends_at, booking_payment_mode, entry_pass_id, member_plan_contract_id, payment_status")
    .maybeSingle();

  if (error) {
    const mapped = mapBookingConflictError(error);
    if (mapped) return apiError(409, "FORBIDDEN", mapped.message);
    return apiError(500, "INTERNAL_ERROR", error.message);
  }

  if (data && commercials.packageSelection) {
    try {
      await reservePackageForBooking({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId: String(data.id),
        memberId,
        entryPassId: commercials.packageSelection.entryPassId,
        actorId: auth.context.userId,
        reason: "staff_booking_reserve",
        note,
        idempotencyKey: `booking:${data.id}:reserve`,
      });
    } catch (reserveError) {
      await auth.supabase
        .from("bookings")
        .delete()
        .eq("tenant_id", auth.context.tenantId)
        .eq("id", String(data.id));
      if (reserveError instanceof BookingCommercialError) {
        return apiError(reserveError.status, reserveError.code as "FORBIDDEN", reserveError.message);
      }
      return apiError(500, "INTERNAL_ERROR", reserveError instanceof Error ? reserveError.message : "Package reserve failed");
    }
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_create",
    target_type: "booking",
    target_id: String(data?.id || ""),
    reason: "booking_create",
    payload: {
      memberId,
      coachId,
      serviceName: commercials.service.name,
      startsAt,
      endsAt,
      commercial: {
        paymentMode: commercials.paymentMode,
        entryPassId: commercials.packageSelection?.entryPassId ?? null,
        contractId: commercials.packageSelection?.contractId ?? null,
        paymentStatus: commercials.bookingInsertPatch.payment_status,
        depositRequiredAmount: commercials.bookingInsertPatch.deposit_required_amount,
      },
    },
  });

  if (data?.id) {
    let depositPayment = null as Awaited<ReturnType<typeof createOrReuseBookingDepositPayment>>["depositPayment"] | null;
    if (commercials.bookingInsertPatch.payment_status === "deposit_pending") {
      try {
        const depositResult = await createOrReuseBookingDepositPayment({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId,
          bookingId: String(data.id),
          actorId: auth.context.userId,
          channel: "frontdesk",
        });
        depositPayment = depositResult.depositPayment;
      } catch (paymentError) {
        await auth.supabase
          .from("bookings")
          .delete()
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", String(data.id));
        return apiError(500, "INTERNAL_ERROR", paymentError instanceof Error ? paymentError.message : "Failed to create booking deposit payment");
      }
    }

    try {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId,
        bookingId: String(data.id),
        actorId: auth.context.userId,
        trigger: "created",
      });
    } catch (notificationError) {
      console.error("[bookings] failed to schedule booking notifications", {
        bookingId: String(data.id),
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
    return apiSuccess({ booking: data, commercial: commercials, depositPayment });
  }
  return apiSuccess({ booking: data, commercial: commercials, depositPayment: null });
}
