import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function isValidLimit(value: string | null) {
  if (!value) return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 200;
}

function extractTimestamp(row: any): string | null {
  const keys = [
    "created_at",
    "createdAt",
    "inserted_at",
    "insertedAt",
    "occurred_at",
    "occurredAt",
    "paid_at",
    "paidAt",
    "starts_at",
    "startsAt",
    "timestamp",
  ];
  for (const k of keys) {
    const v = row?.[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Tenant context is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = isValidLimit(url.searchParams.get("limit")) ? Number(url.searchParams.get("limit")) : 50;

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();

  if (memberResult.error || !memberResult.data) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const memberId = memberResult.data.id;

  const loadPayments = async () => {
    const direct = await auth.supabase
      .from("payments")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!direct.error || !direct.error.message.includes("member_id")) {
      return direct;
    }

    return auth.supabase
      .from("payments")
      .select("*, orders!inner(member_id)")
      .eq("tenant_id", auth.context.tenantId)
      .eq("orders.member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit);
  };

  const [checkinsRes, redemptionsRes, ordersRes, paymentsRes] = await Promise.all([
    auth.supabase
      .from("checkins")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("session_redemptions")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("orders")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    loadPayments(),
  ]);

  if (checkinsRes.error || redemptionsRes.error || ordersRes.error || paymentsRes.error) {
    return NextResponse.json(
      {
        error: "Failed to load history",
        details: {
          checkins: checkinsRes.error?.message ?? null,
          session_redemptions: redemptionsRes.error?.message ?? null,
          orders: ordersRes.error?.message ?? null,
          payments: paymentsRes.error?.message ?? null,
        },
      },
      { status: 500 },
    );
  }

  const items = [
    ...(checkinsRes.data ?? []).map((row: any) => ({ type: "checkin", ts: extractTimestamp(row), row })),
    ...(redemptionsRes.data ?? []).map((row: any) => ({ type: "session_redemption", ts: extractTimestamp(row), row })),
    ...(ordersRes.data ?? []).map((row: any) => ({ type: "order", ts: extractTimestamp(row), row })),
    ...(paymentsRes.data ?? []).map((row: any) => ({ type: "payment", ts: extractTimestamp(row), row })),
  ]
    .filter((x) => x.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  return NextResponse.json({ memberId, items });
}
