import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

const CANCEL_OR_RESCHEDULE_LOCK_MINUTES = 120;

function canModify(startsAt: string) {
  const starts = new Date(startsAt).getTime();
  const lockAt = starts - CANCEL_OR_RESCHEDULE_LOCK_MINUTES * 60 * 1000;
  return Date.now() < lockAt;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
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

  if (!serviceName || !startsAt || !endsAt || !auth.context.tenantId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
  }

  if (new Date(startsAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Booking must be in the future" }, { status: 400 });
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const overlapResult = await auth.supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("member_id", memberResult.data.id)
    .in("status", ["booked", "checked_in"])
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1)
    .maybeSingle();

  if (overlapResult.error) return NextResponse.json({ error: overlapResult.error.message }, { status: 500 });
  if (overlapResult.data) {
    return NextResponse.json({ error: "Booking time overlaps with existing booking" }, { status: 400 });
  }

  if (coachId) {
    const coachOverlap = await auth.supabase
      .from("bookings")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", coachId)
      .in("status", ["booked", "checked_in"])
      .lt("starts_at", endsAt)
      .gt("ends_at", startsAt)
      .limit(1)
      .maybeSingle();
    if (coachOverlap.error) return NextResponse.json({ error: coachOverlap.error.message }, { status: 500 });
    if (coachOverlap.data) {
      return NextResponse.json({ error: "Coach time overlaps with another booking" }, { status: 400 });
    }

    const slotResult = await auth.supabase
      .from("coach_slots")
      .select("id")
      .eq("tenant_id", auth.context.tenantId)
      .eq("coach_id", coachId)
      .eq("status", "active")
      .lte("starts_at", startsAt)
      .gte("ends_at", endsAt)
      .limit(1)
      .maybeSingle();

    if (slotResult.error && !slotResult.error.message.includes('relation "coach_slots" does not exist')) {
      return NextResponse.json({ error: slotResult.error.message }, { status: 500 });
    }
    if (!slotResult.error && !slotResult.data) {
      return NextResponse.json({ error: "Coach is unavailable (no matching schedule slot)" }, { status: 400 });
    }
  }

  const { data, error } = await auth.supabase
    .from("bookings")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberResult.data.id,
      coach_id: coachId,
      service_name: serviceName,
      starts_at: startsAt,
      ends_at: endsAt,
      status: "booked",
      note,
      created_by: auth.context.userId,
    })
    .select("id, coach_id, service_name, starts_at, ends_at, status, note")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "member_booking_create",
    target_type: "booking",
    target_id: String(data?.id || ""),
    payload: { startsAt, endsAt, serviceName },
  });

  return NextResponse.json({ booking: data }, { status: 201 });
}

export { canModify };
