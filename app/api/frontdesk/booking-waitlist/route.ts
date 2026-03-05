import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../../lib/auth-context";

function isMissingWaitlistTable(message: string) {
  return message.includes('relation "booking_waitlist" does not exist')
    || message.includes("Could not find the table 'public.booking_waitlist' in the schema cache");
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeTime(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const date = normalizeDate(params.get("date"));
  const status = (params.get("status") || "").trim();
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") || 20)));

  let query = auth.supabase
    .from("booking_waitlist")
    .select("id, member_id, contact_name, contact_phone, desired_date, desired_time, note, status, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (date) query = query.eq("desired_date", date);
  if (status) query = query.eq("status", status);
  if (auth.context.role === "frontdesk" && auth.context.branchId) query = query.eq("branch_id", auth.context.branchId);

  const { data, error } = await query;
  if (error) {
    if (isMissingWaitlistTable(error.message)) {
      return NextResponse.json({ items: [], warning: "booking_waitlist table missing" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;
  if (!auth.context.tenantId) return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId.trim() : null;
  const contactName = typeof body?.contactName === "string" ? body.contactName.trim() : "";
  const contactPhone = typeof body?.contactPhone === "string" ? body.contactPhone.trim() : null;
  const desiredDate = normalizeDate(body?.desiredDate);
  const desiredTime = normalizeTime(body?.desiredTime);
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!contactName) return NextResponse.json({ error: "contactName is required" }, { status: 400 });

  const insert = await auth.supabase
    .from("booking_waitlist")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId || null,
      contact_name: contactName,
      contact_phone: contactPhone || null,
      desired_date: desiredDate,
      desired_time: desiredTime,
      note,
      status: "pending",
      created_by: auth.context.userId,
    })
    .select("id, member_id, contact_name, contact_phone, desired_date, desired_time, note, status, created_at")
    .maybeSingle();
  if (insert.error) {
    if (isMissingWaitlistTable(insert.error.message)) {
      return NextResponse.json({ error: "booking_waitlist table missing" }, { status: 409 });
    }
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "booking_waitlist_create",
    target_type: "booking_waitlist",
    target_id: insert.data?.id || null,
    reason: note,
    payload: {
      memberId,
      contactName,
      contactPhone,
      desiredDate,
      desiredTime,
      note,
    },
  }).catch(() => null);

  return NextResponse.json({ item: insert.data }, { status: 201 });
}
