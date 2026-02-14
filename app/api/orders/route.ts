import { NextResponse } from "next/server";
import { requireProfile } from "../../../lib/auth-context";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("orders")
    .select("id, member_id, amount, status, channel, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireProfile(["manager", "frontdesk"], request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const rawMemberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
  const memberId = rawMemberId ? rawMemberId : null;
  const amount = Number(body?.amount ?? 0);
  const channel = body?.channel === "online" ? "online" : "frontdesk";
  const note = typeof body?.note === "string" ? body.note : null;

  if (!auth.context.tenantId || Number.isNaN(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount or tenant context" }, { status: 400 });
  }
  if (memberId && !isUuid(memberId)) {
    return NextResponse.json({ error: "memberId must be a valid UUID" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("orders")
    .insert({
      tenant_id: auth.context.tenantId,
      branch_id: auth.context.branchId,
      member_id: memberId,
      amount,
      status: "confirmed",
      channel,
      note,
      created_by: auth.context.userId,
    })
    .select("id, amount, status, channel")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ order: data }, { status: 201 });
}
