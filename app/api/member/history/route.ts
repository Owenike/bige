import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";

function isValidLimit(value: string | null) {
  if (!value) return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 200;
}

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

function extractTimestamp(row: Record<string, unknown>): string | null {
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
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return apiError(400, "FORBIDDEN", "Tenant context is required");
  }

  const url = new URL(request.url);
  const limit = isValidLimit(url.searchParams.get("limit")) ? Number(url.searchParams.get("limit")) : 50;

  const memberResult = await auth.supabase
    .from("members")
    .select("id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");

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

  const [checkinsRes, redemptionsRes, ordersRes, paymentsRes, ledgerRes] = await Promise.all([
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
    auth.supabase
      .from("member_plan_ledger")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (checkinsRes.error) return apiError(500, "INTERNAL_ERROR", checkinsRes.error.message);
  if (redemptionsRes.error) return apiError(500, "INTERNAL_ERROR", redemptionsRes.error.message);
  if (ordersRes.error) return apiError(500, "INTERNAL_ERROR", ordersRes.error.message);
  if (paymentsRes.error) return apiError(500, "INTERNAL_ERROR", paymentsRes.error.message);
  if (ledgerRes.error && !isMissingTableError(ledgerRes.error.message, "member_plan_ledger")) {
    return apiError(500, "INTERNAL_ERROR", ledgerRes.error.message);
  }

  const items = [
    ...((checkinsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ type: "checkin", ts: extractTimestamp(row), row })),
    ...((redemptionsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ type: "session_redemption", ts: extractTimestamp(row), row })),
    ...((ordersRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ type: "order", ts: extractTimestamp(row), row })),
    ...((paymentsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ type: "payment", ts: extractTimestamp(row), row })),
    ...((ledgerRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ type: "plan_ledger", ts: extractTimestamp(row), row })),
  ]
    .filter((item) => item.ts)
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  return apiSuccess({ memberId, items });
}
