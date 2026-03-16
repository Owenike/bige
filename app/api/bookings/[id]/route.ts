import { apiError, apiSuccess, requireOpenShift, requireProfile } from "../../../../lib/auth-context";
import {
  getBookingDepositPaymentSummary,
  getBookingDepositReadiness,
  getBookingDepositTimeline,
  isMissingColumn as isMissingPaymentColumn,
  listBookingDepositLiveSmokeEvidence,
} from "../../../../lib/booking-deposit-payments";
import {
  BookingCommercialError,
  consumePackageForBooking,
  fetchBookingPackageLogs,
  mapBookingCommercialSnapshot,
  releasePackageForBooking,
} from "../../../../lib/booking-commerce";
import { listBookingNotificationSummary, scheduleBookingNotifications, summarizeBookingNotifications } from "../../../../lib/booking-notifications";
import { mapBookingConflictError, validateBookingSchedule } from "../../../../lib/therapist-scheduling";
import type { BookingDetailResponse, BookingOverviewItem, BookingStatusLogItem } from "../../../../types/booking-management";

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
  deposit_paid_at?: string | null;
  status_reason?: string | null;
  confirmed_at?: string | null;
  cancelled_at?: string | null;
  completed_at?: string | null;
  rescheduled_from_booking_id?: string | null;
  rescheduled_to_booking_id?: string | null;
  created_by?: string | null;
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
  role?: string | null;
};

type BranchRow = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
};

type ServiceRow = {
  id: string;
  name: string;
  price_amount?: number | string | null;
  duration_minutes?: number | null;
};

type StatusLogRow = {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  reason: string | null;
  note: string | null;
  created_at: string;
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

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function isMissingColumn(message: string | undefined, targets: string[]) {
  if (!message) return false;
  return targets.some((column) => message.includes(column));
}

async function getScopedBooking(params: {
  auth: BookingApiAuth;
  id: string;
}) {
  let query = params.auth.supabase
    .from("bookings")
    .select(
      "id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, customer_name, customer_phone, customer_note, public_reference, source, payment_status, booking_payment_mode, payment_method, payment_reference, payment_updated_at, deposit_required_amount, deposit_paid_amount, final_amount, outstanding_amount, entry_pass_id, member_plan_contract_id, package_sessions_reserved, package_sessions_consumed, deposit_paid_at, status_reason, confirmed_at, cancelled_at, completed_at, rescheduled_from_booking_id, rescheduled_to_booking_id, created_by, created_at, updated_at",
    )
    .eq("id", params.id)
    .eq("tenant_id", params.auth.context.tenantId);

  if (params.auth.context.role === "coach") query = query.eq("coach_id", params.auth.context.userId);
  if (params.auth.context.branchId) query = query.eq("branch_id", params.auth.context.branchId);

  const result = await query.maybeSingle();
  if (
    result.error &&
    isMissingColumn(result.error.message, [
      "customer_name",
      "public_reference",
      "payment_status",
      "booking_payment_mode",
      "payment_reference",
      "final_amount",
      "outstanding_amount",
      "entry_pass_id",
      "package_sessions_reserved",
      "package_sessions_consumed",
      "deposit_required_amount",
    ])
  ) {
    let fallbackQuery = params.auth.supabase
      .from("bookings")
      .select("id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, created_by, created_at, updated_at")
      .eq("id", params.id)
      .eq("tenant_id", params.auth.context.tenantId);

    if (params.auth.context.role === "coach") fallbackQuery = fallbackQuery.eq("coach_id", params.auth.context.userId);
    if (params.auth.context.branchId) fallbackQuery = fallbackQuery.eq("branch_id", params.auth.context.branchId);

    const fallbackResult = await fallbackQuery.maybeSingle();
    if (fallbackResult.error || !fallbackResult.data) return fallbackResult;
    return {
      data: {
        ...(fallbackResult.data as BookingRow),
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
        deposit_paid_at: null,
        status_reason: null,
        confirmed_at: null,
        cancelled_at: null,
        completed_at: null,
        rescheduled_from_booking_id: null,
        rescheduled_to_booking_id: null,
      } satisfies BookingRow,
      error: null,
    };
  }
  return {
    data: (result.data as BookingRow | null) ?? null,
    error: result.error,
  };
}

function toOverviewItem(params: {
  booking: BookingRow;
  member: MemberRow | null;
  coach: StaffRow | null;
  branch: BranchRow | null;
  packageName: string | null;
}): BookingOverviewItem {
  const commercial = mapBookingCommercialSnapshot({
    booking_payment_mode: params.booking.booking_payment_mode,
    payment_status: params.booking.payment_status,
    final_amount: params.booking.final_amount,
    outstanding_amount: params.booking.outstanding_amount,
    deposit_required_amount: params.booking.deposit_required_amount,
    deposit_paid_amount: params.booking.deposit_paid_amount,
    payment_method: params.booking.payment_method,
    payment_reference: params.booking.payment_reference,
    payment_updated_at: params.booking.payment_updated_at,
    entry_pass_id: params.booking.entry_pass_id,
    member_plan_contract_id: params.booking.member_plan_contract_id,
    package_sessions_reserved: params.booking.package_sessions_reserved,
    package_sessions_consumed: params.booking.package_sessions_consumed,
    package_name: params.packageName,
  });
  return {
    id: params.booking.id,
    publicReference: params.booking.public_reference || null,
    customerName: params.booking.customer_name || params.member?.full_name || "Unknown customer",
    customerPhone: params.booking.customer_phone || params.member?.phone || null,
    branchId: params.booking.branch_id || params.member?.store_id || params.coach?.branch_id || null,
    branchName: params.branch?.name || null,
    therapistId: params.booking.coach_id || null,
    therapistName: params.coach?.display_name || null,
    serviceName: params.booking.service_name,
    startsAt: params.booking.starts_at,
    endsAt: params.booking.ends_at,
    status: params.booking.status,
    paymentStatus: commercial.paymentStatus,
    paymentMode: commercial.paymentMode,
    source: params.booking.source || "staff",
    noteExcerpt: stripRoomToken(params.booking.customer_note || params.booking.note || null) || null,
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
    createdAt: params.booking.created_at || null,
    updatedAt: params.booking.updated_at || null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const { id } = await context.params;
  const bookingResult = await getScopedBooking({
    auth: {
      supabase: auth.supabase,
      context: {
        tenantId: auth.context.tenantId,
        branchId: auth.context.branchId,
        role: auth.context.role,
        userId: auth.context.userId,
      },
    },
    id,
  });

  if (bookingResult.error) return apiError(500, "INTERNAL_ERROR", bookingResult.error.message);
  if (!bookingResult.data) return apiError(404, "FORBIDDEN", "Booking not found");

  const booking = bookingResult.data;

  const [memberResult, coachResult, branchResult, serviceResult, logsResult, fallbackAuditResult, passResult] = await Promise.all([
    auth.supabase
      .from("members")
      .select("id, full_name, phone, store_id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", booking.member_id)
      .maybeSingle(),
    booking.coach_id
      ? auth.supabase
          .from("profiles")
          .select("id, display_name, branch_id, role")
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", booking.coach_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    auth.supabase
      .from("branches")
      .select("id, name, code, address")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", booking.branch_id || "")
      .maybeSingle(),
    auth.supabase
      .from("services")
      .select("id, name, price_amount, duration_minutes")
      .eq("tenant_id", auth.context.tenantId)
      .eq("name", booking.service_name)
      .limit(1)
      .maybeSingle(),
    auth.supabase
      .from("booking_status_logs")
      .select("id, from_status, to_status, actor_id, reason, note, created_at")
      .eq("tenant_id", auth.context.tenantId)
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false })
      .limit(12),
    auth.supabase
      .from("audit_logs")
      .select("id, actor_id, reason, payload, created_at")
      .eq("tenant_id", auth.context.tenantId)
      .eq("target_type", "booking")
      .eq("target_id", booking.id)
      .in("action", ["booking_create", "booking_update"])
      .order("created_at", { ascending: false })
      .limit(12),
    booking.entry_pass_id
      ? auth.supabase
          .from("entry_passes")
          .select("id, plan_catalog_id")
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", booking.entry_pass_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (coachResult.error) return apiError(500, "INTERNAL_ERROR", coachResult.error.message);
  if (branchResult.error && booking.branch_id) return apiError(500, "INTERNAL_ERROR", branchResult.error.message);
  if (serviceResult.error && !isMissingColumn(serviceResult.error.message, ["price_amount"])) {
    return apiError(500, "INTERNAL_ERROR", serviceResult.error.message);
  }
  if (logsResult.error && !isMissingColumn(logsResult.error.message, ["booking_status_logs"])) {
    return apiError(500, "INTERNAL_ERROR", logsResult.error.message);
  }
  if (fallbackAuditResult.error) return apiError(500, "INTERNAL_ERROR", fallbackAuditResult.error.message);
  if (passResult.error && !isMissingColumn(passResult.error.message, ["plan_catalog_id"])) {
    return apiError(500, "INTERNAL_ERROR", passResult.error.message);
  }

  const member = (memberResult.data as MemberRow | null) ?? null;
  const coach = (coachResult.data as StaffRow | null) ?? null;
  const branch = (branchResult.data as BranchRow | null) ?? null;
  const service = (serviceResult.data as ServiceRow | null) ?? null;

  let packageName: string | null = null;
  if (passResult.data?.plan_catalog_id) {
    const planResult = await auth.supabase
      .from("member_plan_catalog")
      .select("id, name")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", passResult.data.plan_catalog_id)
      .maybeSingle();
    if (planResult.error) return apiError(500, "INTERNAL_ERROR", planResult.error.message);
    packageName = planResult.data?.name || null;
  }

  const overview = toOverviewItem({
    booking,
    member,
    coach,
    branch,
    packageName,
  });

  const logRows = ((logsResult.data || []) as StatusLogRow[]).length
    ? ((logsResult.data || []) as StatusLogRow[]).map((item) => ({
        id: item.id,
        fromStatus: item.from_status,
        toStatus: item.to_status,
        reason: item.reason,
        note: item.note,
        actorId: item.actor_id,
        createdAt: item.created_at,
      }))
    : ((fallbackAuditResult.data || []) as Array<{
        id: string;
        actor_id: string | null;
        reason: string | null;
        payload: { status?: string; status_reason?: string } | null;
        created_at: string;
      }>).map((item) => ({
        id: item.id,
        fromStatus: null,
        toStatus: typeof item.payload?.status === "string" ? item.payload.status : booking.status,
        reason: item.reason,
        note: null,
        actorId: item.actor_id,
        createdAt: item.created_at,
      }));

  const actorIds = Array.from(new Set(logRows.map((item) => item.actorId).filter(Boolean))) as string[];
  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const actorResult = await auth.supabase
      .from("profiles")
      .select("id, display_name")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", actorIds);
    if (actorResult.error) return apiError(500, "INTERNAL_ERROR", actorResult.error.message);
    for (const row of (actorResult.data || []) as Array<{ id: string; display_name: string | null }>) {
      actorMap.set(row.id, row.display_name || row.id);
    }
  }

  let rescheduledFromReference: string | null = null;
  let rescheduledToReference: string | null = null;
  if (booking.rescheduled_from_booking_id || booking.rescheduled_to_booking_id) {
    const relatedIds = [booking.rescheduled_from_booking_id, booking.rescheduled_to_booking_id].filter(Boolean) as string[];
    const relatedResult = await auth.supabase
      .from("bookings")
      .select("id, public_reference")
      .eq("tenant_id", auth.context.tenantId)
      .in("id", relatedIds);
    if (relatedResult.error && !isMissingColumn(relatedResult.error.message, ["public_reference"])) {
      return apiError(500, "INTERNAL_ERROR", relatedResult.error.message);
    }
    const relatedRows = (relatedResult.data || []) as Array<{ id: string; public_reference: string | null }>;
    rescheduledFromReference =
      relatedRows.find((item) => item.id === booking.rescheduled_from_booking_id)?.public_reference || null;
    rescheduledToReference =
      relatedRows.find((item) => item.id === booking.rescheduled_to_booking_id)?.public_reference || null;
  }

  let packageLogs = [] as BookingDetailResponse["packageLogs"];
  try {
    packageLogs = await fetchBookingPackageLogs({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingId: booking.id,
    });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load package logs");
  }

  let notifications = [] as BookingDetailResponse["notifications"];
  try {
    notifications = await listBookingNotificationSummary({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      bookingId: booking.id,
    });
  } catch (error) {
    return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load notification summary");
  }

  const notificationSummary = summarizeBookingNotifications(notifications);

  let depositPayment = null as BookingDetailResponse["depositPayment"];
  let depositOrders = [] as BookingDetailResponse["depositOrders"];
  let depositPaymentAttempts = [] as BookingDetailResponse["depositPaymentAttempts"];
  let depositPaymentWebhooks = [] as BookingDetailResponse["depositPaymentWebhooks"];
  let depositPaymentReadiness = null as BookingDetailResponse["depositPaymentReadiness"];
  let depositLiveSmokeLatest = null as BookingDetailResponse["depositLiveSmokeLatest"];
  let depositLiveSmokeHistory = [] as BookingDetailResponse["depositLiveSmokeHistory"];
  try {
    const [paymentSummary, paymentTimeline, paymentReadiness, liveSmokeEvidence] = await Promise.all([
      getBookingDepositPaymentSummary({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId: booking.id,
      }),
      getBookingDepositTimeline({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId: booking.id,
      }),
      getBookingDepositReadiness({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId: booking.id,
      }),
      listBookingDepositLiveSmokeEvidence({
        supabase: auth.supabase,
        tenantId: auth.context.tenantId,
        bookingId: booking.id,
        limit: 6,
      }),
    ]);
    depositPayment = paymentSummary;
    depositOrders = paymentTimeline.orders;
    depositPaymentAttempts = paymentTimeline.attempts;
    depositPaymentWebhooks = paymentTimeline.webhooks;
    depositPaymentReadiness = paymentReadiness;
    depositLiveSmokeLatest = liveSmokeEvidence.latest;
    depositLiveSmokeHistory = liveSmokeEvidence.history;
  } catch (error) {
    if (!(error instanceof Error) || !isMissingPaymentColumn(error.message, "booking_id")) {
      return apiError(500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load booking deposit payment");
    }
  }

  return apiSuccess<BookingDetailResponse>({
    booking: {
      ...overview,
      customerNote: booking.customer_note || null,
      internalNote: stripRoomToken(booking.note || null) || null,
      branchAddress: branch?.address || null,
      priceAmount: service ? toNumber(service.price_amount) : null,
      durationMinutes: service?.duration_minutes ?? null,
      depositPaidAt: booking.deposit_paid_at || null,
      statusReason: booking.status_reason || null,
      confirmedAt: booking.confirmed_at || null,
      cancelledAt: booking.cancelled_at || null,
      completedAt: booking.completed_at || null,
      rescheduledFromBookingId: booking.rescheduled_from_booking_id || null,
      rescheduledFromReference,
      rescheduledToBookingId: booking.rescheduled_to_booking_id || null,
      rescheduledToReference,
      createdBy: booking.created_by || null,
      notificationQueuedCount: notificationSummary.queued,
      notificationFailedCount: notificationSummary.failed,
      hasDepositReminderPending: notificationSummary.depositPendingQueued,
    },
    depositPayment,
    depositOrders,
    depositPaymentAttempts,
    depositPaymentWebhooks,
    depositPaymentReadiness,
    depositLiveSmokeLatest,
    depositLiveSmokeHistory,
    logs: logRows.map(
      (item): BookingStatusLogItem => ({
        ...item,
        actorName: item.actorId ? actorMap.get(item.actorId) || item.actorId : null,
      }),
    ),
    packageLogs,
    notifications,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : null;
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const nextPaymentStatus = typeof body?.paymentStatus === "string" ? body.paymentStatus : null;
  const nextPaymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod : null;
  const nextDepositPaidAmount =
    body?.depositPaidAmount === null || body?.depositPaidAmount === undefined ? null : Number(body?.depositPaidAmount);

  const allowedStatus =
    auth.context.role === "coach"
      ? ["checked_in", "completed", "no_show"]
      : ["pending", "confirmed", "booked", "checked_in", "completed", "cancelled", "no_show"];
  if (status && !allowedStatus.includes(status)) {
    return apiError(400, "FORBIDDEN", "Invalid status");
  }

  if (!reason) {
    return apiError(400, "FORBIDDEN", "reason is required for booking updates");
  }
  if (nextDepositPaidAmount !== null && (!Number.isFinite(nextDepositPaidAmount) || nextDepositPaidAmount < 0)) {
    return apiError(400, "FORBIDDEN", "depositPaidAmount must be zero or positive");
  }

  let existingQuery = auth.supabase
    .from("bookings")
    .select("id, tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at, status, note, payment_status, booking_payment_mode, payment_method, deposit_required_amount, deposit_paid_amount, final_amount, outstanding_amount, entry_pass_id, package_sessions_reserved, package_sessions_consumed")
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId);
  if (auth.context.role === "coach") existingQuery = existingQuery.eq("coach_id", auth.context.userId);
  if (auth.context.branchId) existingQuery = existingQuery.eq("branch_id", auth.context.branchId);
  const existingResult = await existingQuery.maybeSingle();
  if (existingResult.error) return apiError(500, "INTERNAL_ERROR", existingResult.error.message);
  if (!existingResult.data) return apiError(404, "FORBIDDEN", "Booking not found");

  const nextStartsAt = startsAt || existingResult.data.starts_at;
  const nextEndsAt = endsAt || existingResult.data.ends_at;
  const nextCoachId = coachId || existingResult.data.coach_id;
  const nextNote = note !== null ? note : existingResult.data.note;
  const movingTimeOrCoach = Boolean(startsAt || endsAt || coachId);

  if (new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  if (movingTimeOrCoach) {
    const scheduleValidation = await validateBookingSchedule({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId!,
      branchId: existingResult.data.branch_id,
      memberId: existingResult.data.member_id,
      coachId: nextCoachId,
      serviceName: existingResult.data.service_name,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      ignoreBookingId: id,
    });
    if (!scheduleValidation.ok) {
      return apiError(409, "FORBIDDEN", scheduleValidation.message);
    }

    const room = parseRoomFromNote(nextNote);
    if (room) {
      const roomCandidates = await auth.supabase
        .from("bookings")
        .select("id, note")
        .eq("tenant_id", auth.context.tenantId)
        .in("status", ["pending", "confirmed", "booked", "checked_in"])
        .neq("id", id)
        .lt("starts_at", nextEndsAt)
        .gt("ends_at", nextStartsAt)
        .limit(200);
      if (roomCandidates.error) return apiError(500, "INTERNAL_ERROR", roomCandidates.error.message);
      const roomConflict = (roomCandidates.data || []).find((item: { note: string | null }) => parseRoomFromNote(item.note || null) === room);
      if (roomConflict) return apiError(400, "FORBIDDEN", "Room time overlaps with another booking");
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (status) updatePayload.status = status;
  if (startsAt) updatePayload.starts_at = startsAt;
  if (endsAt) updatePayload.ends_at = endsAt;
  if (note !== null) updatePayload.note = note;
  if (coachId) updatePayload.coach_id = coachId;
  if (nextPaymentStatus) updatePayload.payment_status = nextPaymentStatus;
  if (nextPaymentMethod !== null) updatePayload.payment_method = nextPaymentMethod;
  if (nextPaymentStatus === "fully_paid") {
    updatePayload.outstanding_amount = 0;
    updatePayload.payment_updated_at = new Date().toISOString();
  }
  if (nextDepositPaidAmount !== null) {
    updatePayload.deposit_paid_amount = nextDepositPaidAmount;
    updatePayload.deposit_paid_at = nextDepositPaidAmount > 0 ? new Date().toISOString() : null;
    updatePayload.payment_updated_at = new Date().toISOString();
    updatePayload.outstanding_amount = Math.max(0, toNumber(existingResult.data.final_amount) - nextDepositPaidAmount);
    if (!nextPaymentStatus && existingResult.data.deposit_required_amount) {
      const required = toNumber(existingResult.data.deposit_required_amount);
      if (nextDepositPaidAmount >= required && required > 0) {
        updatePayload.payment_status = "deposit_paid";
      }
    }
  }
  updatePayload.status_reason = reason;
  updatePayload.updated_at = new Date().toISOString();

  let query = auth.supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, coach_id, status, starts_at, ends_at, note, updated_at");

  if (auth.context.role === "coach") {
    query = query.eq("coach_id", auth.context.userId);
  }
  if (auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const previousStatus = existingResult.data.status;
  const previousEndsAt = existingResult.data.ends_at;
  const previousStartsAt = existingResult.data.starts_at;
  const { data, error } = await query.maybeSingle();

  if (error) {
    const mapped = mapBookingConflictError(error);
    if (mapped) return apiError(409, "FORBIDDEN", mapped.message);
    return apiError(500, "INTERNAL_ERROR", error.message);
  }
  if (!data) return apiError(404, "FORBIDDEN", "Booking not found");

  if (status && existingResult.data.booking_payment_mode === "package" && existingResult.data.entry_pass_id) {
    try {
      if (status === "completed" && previousStatus !== "completed") {
        await consumePackageForBooking({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId!,
          bookingId: id,
          memberId: existingResult.data.member_id,
          entryPassId: existingResult.data.entry_pass_id,
          actorId: auth.context.userId,
          reason,
          note,
          idempotencyKey: `booking:${id}:consume`,
        });
        await auth.supabase
          .from("bookings")
          .update({
            package_sessions_reserved: 0,
            package_sessions_consumed: Math.max(1, toNumber(existingResult.data.package_sessions_consumed) + 1),
            payment_status: "fully_paid",
            payment_updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", id);
      }

      if (status === "cancelled" && previousStatus !== "cancelled" && previousStatus !== "completed") {
        await releasePackageForBooking({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId!,
          bookingId: id,
          memberId: existingResult.data.member_id,
          entryPassId: existingResult.data.entry_pass_id,
          actorId: auth.context.userId,
          reason,
          note,
          idempotencyKey: `booking:${id}:release`,
        });
        await auth.supabase
          .from("bookings")
          .update({
            package_sessions_reserved: 0,
            outstanding_amount: 0,
            payment_updated_at: new Date().toISOString(),
          })
          .eq("tenant_id", auth.context.tenantId)
          .eq("id", id);
      }
    } catch (packageError) {
      await auth.supabase
        .from("bookings")
        .update({ status: previousStatus, updated_at: new Date().toISOString() })
        .eq("tenant_id", auth.context.tenantId)
        .eq("id", id);
      if (packageError instanceof BookingCommercialError) {
        return apiError(packageError.status, packageError.code as "FORBIDDEN", packageError.message);
      }
      return apiError(500, "INTERNAL_ERROR", packageError instanceof Error ? packageError.message : "Package transition failed");
    }
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_update",
    target_type: "booking",
    target_id: id,
    reason,
    payload: updatePayload,
  });

  try {
    if ((startsAt || endsAt) && data?.id && (nextStartsAt !== previousStartsAt || nextEndsAt !== previousEndsAt)) {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "rescheduled",
      });
    }

    if (status === "cancelled" && previousStatus !== "cancelled") {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "cancelled",
      });
    } else if (status === "completed" && previousStatus !== "completed") {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "status_completed",
      });
    } else if (status === "no_show" && previousStatus !== "no_show") {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "status_no_show",
      });
    }

    const finalPaymentStatus = String((updatePayload.payment_status as string | undefined) || existingResult.data.payment_status || "");
    if (existingResult.data.payment_status === "deposit_pending" && finalPaymentStatus === "deposit_paid") {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "payment_deposit_paid",
      });
    } else if (finalPaymentStatus === "deposit_pending") {
      await scheduleBookingNotifications({
        tenantId: auth.context.tenantId!,
        bookingId: id,
        actorId: auth.context.userId,
        trigger: "payment_deposit_pending_refresh",
      });
    }
  } catch (notificationError) {
    console.error("[bookings/:id] failed to sync booking notifications", {
      bookingId: id,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  }

  return apiSuccess({ booking: data });
}
