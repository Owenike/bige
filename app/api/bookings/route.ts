import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = auth.supabase
    .from("bookings")
    .select("id, member_id, coach_id, service_name, starts_at, ends_at, status, note")
    .eq("tenant_id", auth.context.tenantId)
    .order("starts_at", { ascending: true })
    .limit(100);

  if (from) query = query.gte("starts_at", from);
  if (to) query = query.lte("starts_at", to);
  if (auth.context.role === "coach") query = query.eq("coach_id", auth.context.userId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const coachId = typeof body?.coachId === "string" ? body.coachId : null;
  const serviceName = typeof body?.serviceName === "string" ? body.serviceName.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : "";
  const note = typeof body?.note === "string" ? body.note : null;

  if (!memberId || !serviceName || !startsAt || !endsAt || !auth.context.tenantId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return NextResponse.json({ error: "endsAt must be after startsAt" }, { status: 400 });
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
      member_id: memberId,
      coach_id: coachId,
      service_name: serviceName,
      starts_at: startsAt,
      ends_at: endsAt,
      note,
      created_by: auth.context.userId,
    })
    .select("id, status, starts_at, ends_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ booking: data }, { status: 201 });
}
