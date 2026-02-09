import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

const REDEMPTION_ERROR_STATUS: Record<string, number> = {
  invalid_redemption_input: 400,
  invalid_redeemed_kind: 400,
  pass_id_required: 400,
  pass_not_found: 404,
  insufficient_remaining_sessions: 400,
};

function mapRedemptionError(message: string | undefined) {
  if (!message) return { status: 500, error: "Redemption failed" };
  if (message.includes("session_redemptions_booking_unique")) {
    return { status: 409, error: "Booking already redeemed" };
  }
  const status = REDEMPTION_ERROR_STATUS[message];
  if (status) return { status, error: message };
  return { status: 500, error: message };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const memberId = new URL(request.url).searchParams.get("memberId");

  let query = auth.supabase
    .from("session_redemptions")
    .select("id, booking_id, member_id, redeemed_kind, quantity, note, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (memberId) query = query.eq("member_id", memberId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk", "coach"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const redeemedKind = body?.redeemedKind === "monthly" ? "monthly" : "pass";
  const passId = typeof body?.passId === "string" ? body.passId : null;
  const note = typeof body?.note === "string" ? body.note : null;
  const quantity = Math.max(1, Number(body?.quantity ?? 1));

  if (!auth.context.tenantId || !memberId) {
    return NextResponse.json({ error: "memberId and tenant context are required" }, { status: 400 });
  }

  const rpcResult = await auth.supabase.rpc("redeem_session", {
    p_tenant_id: auth.context.tenantId,
    p_booking_id: bookingId,
    p_member_id: memberId,
    p_redeemed_by: auth.context.userId,
    p_redeemed_kind: redeemedKind,
    p_pass_id: passId,
    p_quantity: quantity,
    p_note: note,
  });

  if (rpcResult.error) {
    const mapped = mapRedemptionError(rpcResult.error.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const redemption = Array.isArray(rpcResult.data) ? rpcResult.data[0] : null;
  if (!redemption) return NextResponse.json({ error: "Redemption failed" }, { status: 500 });

  return NextResponse.json({ redemption }, { status: 201 });
}
