import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

export async function GET(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("frontdesk_shifts")
    .select("id, opened_at, closed_at, status, cash_total, card_total, transfer_total, note")
    .eq("tenant_id", auth.context.tenantId)
    .order("opened_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["frontdesk", "manager"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = body?.action === "close" ? "close" : "open";

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Missing tenant context" }, { status: 400 });
  }

  if (action === "open") {
    const openShiftQuery = await auth.supabase
      .from("frontdesk_shifts")
      .select("id, status, opened_at")
      .eq("tenant_id", auth.context.tenantId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openShiftQuery.error) return NextResponse.json({ error: openShiftQuery.error.message }, { status: 500 });
    if (openShiftQuery.data) {
      return NextResponse.json({ error: "An open shift already exists", shift: openShiftQuery.data }, { status: 409 });
    }

    const { data, error } = await auth.supabase
      .from("frontdesk_shifts")
      .insert({
        tenant_id: auth.context.tenantId,
        branch_id: auth.context.branchId,
        opened_by: auth.context.userId,
        note: typeof body?.note === "string" ? body.note : null,
      })
      .select("id, status, opened_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ shift: data }, { status: 201 });
  }

  const shiftId = typeof body?.shiftId === "string" ? body.shiftId : "";
  if (!shiftId) return NextResponse.json({ error: "shiftId is required for close" }, { status: 400 });

  const cashTotal = Number(body?.cashTotal ?? 0);
  const cardTotal = Number(body?.cardTotal ?? 0);
  const transferTotal = Number(body?.transferTotal ?? 0);
  if (!Number.isFinite(cashTotal) || !Number.isFinite(cardTotal) || !Number.isFinite(transferTotal)) {
    return NextResponse.json({ error: "Invalid totals" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("frontdesk_shifts")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: auth.context.userId,
      cash_total: cashTotal,
      card_total: cardTotal,
      transfer_total: transferTotal,
      note: typeof body?.note === "string" ? body.note : null,
    })
    .eq("id", shiftId)
    .eq("tenant_id", auth.context.tenantId)
    .eq("status", "open")
    .select("id, status, closed_at, cash_total, card_total, transfer_total")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Shift not found or already closed" }, { status: 404 });
  return NextResponse.json({ shift: data });
}
