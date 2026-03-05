import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function isMissingSyncTable(message: string) {
  return message.includes('relation "booking_sync_jobs" does not exist')
    || message.includes("Could not find the table 'public.booking_sync_jobs' in the schema cache");
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 20)));
  const { data, error } = await auth.supabase
    .from("booking_sync_jobs")
    .select("id, booking_id, provider, event_type, status, payload, created_at, updated_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingSyncTable(error.message)) {
      return NextResponse.json({ items: [], warning: "booking_sync_jobs table missing" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  const provider = typeof body?.provider === "string" ? body.provider.trim() : "google_calendar";
  const eventType = typeof body?.eventType === "string" ? body.eventType.trim() : "upsert";
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  if (!bookingId) return NextResponse.json({ error: "bookingId is required" }, { status: 400 });

  const insert = await auth.supabase
    .from("booking_sync_jobs")
    .insert({
      tenant_id: auth.context.tenantId,
      booking_id: bookingId,
      provider,
      event_type: eventType,
      payload,
      status: "queued",
      created_by: auth.context.userId,
    })
    .select("id, booking_id, provider, event_type, status, payload, created_at, updated_at")
    .maybeSingle();

  if (insert.error) {
    if (isMissingSyncTable(insert.error.message)) {
      return NextResponse.json({ error: "booking_sync_jobs table missing" }, { status: 409 });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_sync_queue",
    target_type: "booking",
    target_id: bookingId,
    reason: `${provider}:${eventType}`,
    payload,
  }).catch(() => null);

  return NextResponse.json({ job: insert.data }, { status: 201 });
}
