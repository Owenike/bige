import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { createOrReuseBookingDepositPayment } from "../../../../lib/booking-deposit-payments";
import {
  BookingCommercialError,
  prepareBookingCommercials,
  reservePackageForBooking,
} from "../../../../lib/booking-commerce";
import { scheduleBookingNotifications } from "../../../../lib/booking-notifications";
import { mapBookingConflictError, validateBookingSchedule } from "../../../../lib/therapist-scheduling";

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Tenant context is required");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  }

  const status = new URL(request.url).searchParams.get("status");

  let query = auth.supabase
    .from("bookings")
    .select("id, coach_id, service_name, starts_at, ends_at, status, note")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", memberResult.data.id)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return apiError(500, "INTERNAL_ERROR", error.message);

  return apiSuccess({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;
  const paymentMode = typeof body?.paymentMode === "string" ? body.paymentMode : "single";
  const entryPassId = typeof body?.entryPassId === "string" ? body.entryPassId : null;

  if (!serviceName || !startsAt || !endsAt || !auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Missing required fields");
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return apiError(400, "FORBIDDEN", "endsAt must be after startsAt");
  }

  if (new Date(startsAt).getTime() <= Date.now()) {
    return apiError(400, "FORBIDDEN", "Booking must be in the future");
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");
  }

  let commercials;
  try {
    commercials = await prepareBookingCommercials({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      branchId: (typeof memberResult.data.store_id === "string" ? memberResult.data.store_id : null) || auth.context.branchId,
      memberId: memberResult.data.id,
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
    branchId: (typeof memberResult.data.store_id === "string" ? memberResult.data.store_id : null) || auth.context.branchId,
    memberId: memberResult.data.id,
    coachId,
    serviceName,
    startsAt,
    endsAt,
    enforceBookingWindow: true,
  });
  if (!scheduleValidation.ok) {
    return apiError(409, "FORBIDDEN", scheduleValidation.message);
  }

  const { data, error } = await auth.supabase
    .from("bookings")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId ?? memberResult.data.store_id ?? null,
      member_id: memberResult.data.id,
      coach_id: scheduleValidation.assignedCoachId,
      service_name: serviceName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      note,
      source: "member",
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
    .select("id, member_id, coach_id, service_name, starts_at, ends_at, status, note, booking_payment_mode, entry_pass_id, member_plan_contract_id, payment_status")
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
        memberId: memberResult.data.id,
        entryPassId: commercials.packageSelection.entryPassId,
        actorId: auth.context.userId,
        reason: "booking_create_reserve",
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
    action: "member_booking_create",
    target_type: "booking",
    target_id: String(data?.id || ""),
    payload: {
      startsAt,
      endsAt,
      serviceName,
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
          channel: "online",
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
      console.error("[member/bookings] failed to schedule booking notifications", {
        bookingId: String(data.id),
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
    return apiSuccess({ booking: data, commercial: commercials, depositPayment });
  }
  return apiSuccess({ booking: data, commercial: commercials, depositPayment: null });
}
