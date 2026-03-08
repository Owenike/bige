import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { checkMemberEligibility } from "../../../../lib/entitlement-eligibility";
import { evaluateContractStatus } from "../../../../lib/member-plan-lifecycle";

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
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("auth_user_id", auth.context.userId)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found");

  const memberId = memberResult.data.id;
  const memberBranchId = typeof memberResult.data.store_id === "string" ? memberResult.data.store_id : null;

  const [contractsRes, plansRes, subscriptionsRes, entryPassesRes] = await Promise.all([
    auth.supabase
      .from("member_plan_contracts")
      .select(
        "id, plan_catalog_id, status, starts_at, ends_at, remaining_uses, remaining_sessions, auto_renew, note, created_at, updated_at",
      )
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("member_plan_catalog")
      .select("id, code, name, plan_type, fulfillment_kind, is_active")
      .eq("tenant_id", auth.context.tenantId)
      .limit(500),
    auth.supabase
      .from("subscriptions")
      .select("id, member_plan_contract_id, valid_from, valid_to, status")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
    auth.supabase
      .from("entry_passes")
      .select("id, member_plan_contract_id, pass_type, remaining, total_sessions, expires_at, status")
      .eq("tenant_id", auth.context.tenantId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (contractsRes.error && !isMissingTableError(contractsRes.error.message, "member_plan_contracts")) {
    return apiError(500, "INTERNAL_ERROR", contractsRes.error.message);
  }
  if (plansRes.error && !isMissingTableError(plansRes.error.message, "member_plan_catalog")) {
    return apiError(500, "INTERNAL_ERROR", plansRes.error.message);
  }
  if (subscriptionsRes.error) return apiError(500, "INTERNAL_ERROR", subscriptionsRes.error.message);
  if (entryPassesRes.error) return apiError(500, "INTERNAL_ERROR", entryPassesRes.error.message);

  const plansById = new Map<
    string,
    {
      code: string | null;
      name: string | null;
      planType: string | null;
      fulfillmentKind: string | null;
      isActive: boolean;
    }
  >();
  for (const plan of ((plansRes.data || []) as Array<{
    id: string;
    code: string | null;
    name: string | null;
    plan_type: string | null;
    fulfillment_kind: string | null;
    is_active: boolean | null;
  }>)) {
    plansById.set(plan.id, {
      code: plan.code ?? null,
      name: plan.name ?? null,
      planType: plan.plan_type ?? null,
      fulfillmentKind: plan.fulfillment_kind ?? null,
      isActive: plan.is_active !== false,
    });
  }

  const subscriptionsByContract = new Map<string, Record<string, unknown>>();
  for (const row of (subscriptionsRes.data || []) as Array<Record<string, unknown>>) {
    const contractId = typeof row.member_plan_contract_id === "string" ? row.member_plan_contract_id : "";
    if (contractId && !subscriptionsByContract.has(contractId)) {
      subscriptionsByContract.set(contractId, row);
    }
  }
  const passesByContract = new Map<string, Record<string, unknown>>();
  for (const row of (entryPassesRes.data || []) as Array<Record<string, unknown>>) {
    const contractId = typeof row.member_plan_contract_id === "string" ? row.member_plan_contract_id : "";
    if (contractId && !passesByContract.has(contractId)) {
      passesByContract.set(contractId, row);
    }
  }

  const contracts = ((contractsRes.data || []) as Array<Record<string, unknown>>).map((contract) => {
    const planId = typeof contract.plan_catalog_id === "string" ? contract.plan_catalog_id : "";
    const plan = plansById.get(planId);
    const remainingUses = typeof contract.remaining_uses === "number" ? contract.remaining_uses : null;
    const remainingSessions = typeof contract.remaining_sessions === "number" ? contract.remaining_sessions : null;
    const endsAt = typeof contract.ends_at === "string" ? contract.ends_at : null;
    const subscription = subscriptionsByContract.get(String(contract.id || ""));
    const pass = passesByContract.get(String(contract.id || ""));
    const status = evaluateContractStatus({
      status: typeof contract.status === "string" ? contract.status : null,
      endsAt,
      remainingUses,
      remainingSessions:
        typeof pass?.remaining === "number"
          ? pass.remaining
          : typeof pass?.remaining === "string"
            ? Number(pass.remaining)
            : remainingSessions,
    });
    const entryEligible = status === "active" && (plan?.planType === "subscription" || plan?.planType === "entry_pass" || plan?.planType === "trial");
    const coachEligible = status === "active" && (plan?.planType === "coach_pack" || plan?.planType === "trial");
    return {
      id: String(contract.id || ""),
      planCatalogId: planId || null,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      planType: plan?.planType ?? null,
      fulfillmentKind: plan?.fulfillmentKind ?? null,
      planActive: plan?.isActive ?? true,
      status,
      startsAt: typeof contract.starts_at === "string" ? contract.starts_at : null,
      endsAt,
      remainingUses,
      remainingSessions:
        typeof pass?.remaining === "number"
          ? pass.remaining
          : typeof pass?.remaining === "string"
            ? Number(pass.remaining)
            : remainingSessions,
      autoRenew: contract.auto_renew === true,
      note: typeof contract.note === "string" ? contract.note : null,
      subscription: subscription || null,
      pass: pass || null,
      usableFor: {
        entry: entryEligible,
        booking: entryEligible || coachEligible,
        redemption: coachEligible,
      },
      createdAt: typeof contract.created_at === "string" ? contract.created_at : null,
      updatedAt: typeof contract.updated_at === "string" ? contract.updated_at : null,
    };
  });

  const [entryEligibility, bookingEligibility, redemptionEligibility] = await Promise.all([
    checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId,
      branchId: memberBranchId,
      scenario: "entry",
    }),
    checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId,
      branchId: memberBranchId,
      scenario: "booking",
      serviceName: "coach_session",
      coachId: "coach",
    }),
    checkMemberEligibility({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      memberId,
      branchId: memberBranchId,
      scenario: "redemption",
      serviceName: "coach_session",
      coachId: "coach",
    }),
  ]);

  const firstActiveSubscription = ((subscriptionsRes.data || []) as Array<Record<string, unknown>>).find((row) => {
    const status = typeof row.status === "string" ? row.status : "";
    return status === "active";
  });
  const firstValidPass = ((entryPassesRes.data || []) as Array<Record<string, unknown>>).find((row) => {
    const status = typeof row.status === "string" ? row.status : "";
    const remaining = typeof row.remaining === "number" ? row.remaining : Number(row.remaining || 0);
    const expiresAt = typeof row.expires_at === "string" ? row.expires_at : null;
    const notExpired = !expiresAt || new Date(expiresAt).getTime() >= Date.now();
    return status === "active" && remaining > 0 && notExpired;
  });
  const legacyRemainingSessions =
    typeof firstValidPass?.remaining === "number"
      ? firstValidPass.remaining
      : contracts.find((item) => typeof item.remainingSessions === "number")?.remainingSessions ?? null;

  return apiSuccess({
    memberId,
    summary: {
      monthly_expires_at:
        (typeof firstActiveSubscription?.valid_to === "string" ? firstActiveSubscription.valid_to : null) ??
        contracts.find((item) => item.planType === "subscription")?.endsAt ??
        null,
      remaining_sessions: legacyRemainingSessions,
      pass_valid_to: (typeof firstValidPass?.expires_at === "string" ? firstValidPass.expires_at : null) ?? null,
    },
    entitlements: contracts,
    contracts,
    subscriptions: subscriptionsRes.data || [],
    entryPasses: entryPassesRes.data || [],
    eligibility: {
      entry: entryEligibility,
      booking: bookingEligibility,
      redemption: redemptionEligibility,
    },
    lifecycle: {
      activeContracts: contracts.filter((item) => item.status === "active").length,
      expiringSoon: contracts.filter((item) => {
        if (!item.endsAt) return false;
        const days = Math.ceil((new Date(item.endsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        return days >= 0 && days <= 14;
      }).length,
      expired: contracts.filter((item) => item.status === "expired").length,
      exhausted: contracts.filter((item) => item.status === "exhausted").length,
    },
  });
}
