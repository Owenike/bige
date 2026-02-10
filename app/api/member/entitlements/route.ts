import { NextResponse } from "next/server";
import { requireProfile } from "../../../../lib/auth-context";

function isValidLimit(value: string | null) {
  if (!value) return false;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 200;
}

function extractSummaryRows(rows: any[] | null | undefined) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.slice(0, 50);
}

function bestEffortEntitlementSummary(input: {
  subscriptions: any[];
  entitlements: any[];
  entryPasses: any[];
}) {
  // Keep this intentionally conservative: schema may differ across deployments.
  const pickDate = (obj: any, keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  };
  const pickNumber = (obj: any, keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "number") return v;
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
    }
    return null;
  };

  const latestSub = input.subscriptions?.[0] ?? null;
  const latestEnt = input.entitlements?.[0] ?? null;
  const latestPass = input.entryPasses?.[0] ?? null;

  return {
    monthly_expires_at:
      pickDate(latestSub, ["expires_at", "valid_to", "current_period_end", "ends_at"]) ??
      pickDate(latestEnt, ["monthly_expires_at", "expires_at", "valid_to"]) ??
      null,
    remaining_sessions:
      pickNumber(latestEnt, ["remaining_sessions", "remaining", "remaining_count", "sessions_remaining"]) ??
      null,
    pass_valid_to: pickDate(latestPass, ["valid_to", "expires_at", "ends_at"]) ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireProfile(["member"], request);
  if (!auth.ok) return auth.response;

  if (!auth.context.tenantId) {
    return NextResponse.json({ error: "Tenant context is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = isValidLimit(url.searchParams.get("limit")) ? Number(url.searchParams.get("limit")) : 50;

  // Resolve member_id for the authenticated user in this tenant.
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

  const [subscriptionsRes, entitlementsRes, entryPassesRes] = await Promise.all([
    auth.supabase
      .from("subscriptions")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("member_entitlements")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("entry_passes")
      .select("*")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (subscriptionsRes.error || entitlementsRes.error || entryPassesRes.error) {
    return NextResponse.json(
      {
        error: "Failed to load entitlements",
        details: {
          subscriptions: subscriptionsRes.error?.message ?? null,
          entitlements: entitlementsRes.error?.message ?? null,
          entryPasses: entryPassesRes.error?.message ?? null,
        },
      },
      { status: 500 },
    );
  }

  const subscriptions = extractSummaryRows(subscriptionsRes.data);
  const entitlements = extractSummaryRows(entitlementsRes.data);
  const entryPasses = extractSummaryRows(entryPassesRes.data);

  return NextResponse.json({
    memberId,
    summary: bestEffortEntitlementSummary({ subscriptions, entitlements, entryPasses }),
    subscriptions,
    entitlements,
    entryPasses,
  });
}

