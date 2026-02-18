import { NextResponse } from "next/server";
import { requireOpenShift, requireProfile } from "../../../lib/auth-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Invalid tenant context" }, { status: 400 });
  }

  let query = auth.supabase
    .from("orders")
    .select("id, member_id, amount, status, channel, note, created_at, updated_at, branch_id")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (auth.context.role === "frontdesk" && auth.context.branchId) {
    query = query.eq("branch_id", auth.context.branchId);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const shiftGuard = await requireOpenShift({ supabase: auth.supabase, context: auth.context });
  if (!shiftGuard.ok) return shiftGuard.response;

  const body = await request.json().catch(() => null);
  const rawMemberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
  const memberId = rawMemberId ? rawMemberId : null;
  const amount = Number(body?.amount ?? 0);
  const subtotal = Number(body?.subtotal ?? amount);
  const discountAmount = Number(body?.discountAmount ?? 0);
  const discountNote = typeof body?.discountNote === "string" ? body.discountNote.trim() : "";
  const managerOverride = body?.managerOverride === true;
  const channel = body?.channel === "online" ? "online" : "frontdesk";
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  if (!auth.context.tenantId || Number.isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount or tenant context" }, { status: 400 });
  }
  if (memberId && !isUuid(memberId)) {
    return NextResponse.json({ error: "memberId must be a valid UUID" }, { status: 400 });
  }
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return NextResponse.json({ error: "Invalid subtotal" }, { status: 400 });
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > subtotal) {
    return NextResponse.json({ error: "Invalid discountAmount" }, { status: 400 });
  }
  const computedAmount = Number((subtotal - discountAmount).toFixed(2));
  if (Math.abs(computedAmount - amount) > 0.01) {
    return NextResponse.json({ error: "amount does not match subtotal - discountAmount" }, { status: 400 });
  }
  const discountRate = subtotal > 0 ? discountAmount / subtotal : 0;
  const requiresManagerOverride = discountAmount > 0 && (discountAmount >= 500 || discountRate >= 0.2);
  if (auth.context.role === "frontdesk" && requiresManagerOverride && !managerOverride) {
    return NextResponse.json({ error: "High discount requires manager override" }, { status: 409 });
  }

  const persistedNote = [
    note || "",
    discountAmount > 0 ? `discount:${discountAmount}` : "",
    discountNote ? `discount_note:${discountNote}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const { data, error } = await auth.supabase
    .from("orders")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId,
      amount,
      status: "confirmed",
      channel,
      note: persistedNote || null,
      created_by: auth.context.userId,
    })
    .select("id, amount, status, channel, note")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "order_created",
    target_type: "order",
    target_id: data?.id ? String(data.id) : null,
    reason: discountNote || null,
    payload: {
      memberId,
      amount,
      subtotal,
      discountAmount,
      discountRate,
      requiresManagerOverride,
      managerOverride,
      channel,
      note: note || null,
    },
  });

  return NextResponse.json({ order: data }, { status: 201 });
}
