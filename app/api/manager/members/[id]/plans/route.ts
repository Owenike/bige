import { apiError, apiSuccess, requireProfile } from "../../../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../../../lib/idempotency";
import { requirePermission } from "../../../../../../lib/permissions";
import { addDays, evaluateContractStatus, normalizeContractStatus } from "../../../../../../lib/member-plan-lifecycle";

type MemberRow = {
  id: string;
  store_id: string | null;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  plan_type: string;
  fulfillment_kind: "subscription" | "entry_pass" | "none";
  default_duration_days: number | null;
  default_quantity: number | null;
  allow_auto_renew: boolean;
  is_active: boolean;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function getMemberScope(params: { request: Request; memberId: string }) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], params.request);
  if (!auth.ok) return auth;

  const readPermission = requirePermission(auth.context, "member_plans.read");
  if (!readPermission.ok) return { ok: false as const, response: readPermission.response };

  if (!auth.context.tenantId) {
    return { ok: false as const, response: apiError(400, "FORBIDDEN", "Missing tenant context") };
  }

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", params.memberId)
    .maybeSingle();
  if (memberResult.error) return { ok: false as const, response: apiError(500, "INTERNAL_ERROR", memberResult.error.message) };
  if (!memberResult.data) return { ok: false as const, response: apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found") };

  const member = memberResult.data as MemberRow;
  if (auth.context.branchId) {
    if (!member.store_id || auth.context.branchId !== member.store_id) {
      return { ok: false as const, response: apiError(403, "BRANCH_SCOPE_DENIED", "Member is outside branch scope") };
    }
  }

  return { ok: true as const, auth, member };
}

function toContractItem(row: Record<string, unknown>, planName: string | null, planCode: string | null) {
  const endsAt = typeof row.ends_at === "string" ? row.ends_at : null;
  const remainingUses = typeof row.remaining_uses === "number" ? row.remaining_uses : null;
  const remainingSessions = typeof row.remaining_sessions === "number" ? row.remaining_sessions : null;
  const derivedStatus = evaluateContractStatus({
    status: typeof row.status === "string" ? row.status : null,
    endsAt,
    remainingUses,
    remainingSessions,
  });

  return {
    id: String(row.id || ""),
    memberId: String(row.member_id || ""),
    planCatalogId: row.plan_catalog_id ? String(row.plan_catalog_id) : null,
    planName,
    planCode,
    status: derivedStatus,
    startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
    endsAt,
    remainingUses,
    remainingSessions,
    autoRenew: row.auto_renew === true,
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourcePaymentId: row.source_payment_id ? String(row.source_payment_id) : null,
    note: typeof row.note === "string" ? row.note : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await getMemberScope({ request, memberId: id });
  if (!scoped.ok) return scoped.response;

  const status = new URL(request.url).searchParams.get("status");
  let query = scoped.auth.supabase
    .from("member_plan_contracts")
    .select(
      "id, member_id, plan_catalog_id, status, starts_at, ends_at, remaining_uses, remaining_sessions, auto_renew, source_order_id, source_payment_id, note, created_at, updated_at",
    )
    .eq("tenant_id", scoped.auth.context.tenantId)
    .eq("member_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);

  const contractsResult = await query;
  if (contractsResult.error) return apiError(500, "INTERNAL_ERROR", contractsResult.error.message);

  const contracts = (contractsResult.data || []) as Array<Record<string, unknown>>;
  const planIds = Array.from(
    new Set(
      contracts
        .map((item) => (typeof item.plan_catalog_id === "string" ? item.plan_catalog_id : ""))
        .filter((item) => item.length > 0),
    ),
  );
  const plansById = new Map<string, { name: string | null; code: string | null }>();
  if (planIds.length > 0) {
    const plansResult = await scoped.auth.supabase
      .from("member_plan_catalog")
      .select("id, name, code")
      .eq("tenant_id", scoped.auth.context.tenantId)
      .in("id", planIds);
    if (plansResult.error) return apiError(500, "INTERNAL_ERROR", plansResult.error.message);
    for (const row of (plansResult.data || []) as Array<{ id: string; name: string | null; code: string | null }>) {
      plansById.set(row.id, { name: row.name ?? null, code: row.code ?? null });
    }
  }

  return apiSuccess({
    items: contracts.map((contract) => {
      const planId = typeof contract.plan_catalog_id === "string" ? contract.plan_catalog_id : "";
      const plan = plansById.get(planId);
      return toContractItem(contract, plan?.name ?? null, plan?.code ?? null);
    }),
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const scoped = await getMemberScope({ request, memberId: id });
  if (!scoped.ok) return scoped.response;

  const writePermission = requirePermission(scoped.auth.context, "member_plans.write");
  if (!writePermission.ok) return writePermission.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const planId = normalizeText(body?.planId);
  const planCode = normalizeText(body?.planCode)?.toLowerCase() ?? null;
  if (!planId && !planCode) return apiError(400, "FORBIDDEN", "planId or planCode is required");

  let planQuery = scoped.auth.supabase
    .from("member_plan_catalog")
    .select("id, code, name, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active")
    .eq("tenant_id", scoped.auth.context.tenantId)
    .limit(1);
  planQuery = planId ? planQuery.eq("id", planId) : planQuery.eq("code", planCode as string);
  const planResult = await planQuery.maybeSingle();
  if (planResult.error) return apiError(500, "INTERNAL_ERROR", planResult.error.message);
  if (!planResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Plan not found");
  const plan = planResult.data as PlanRow;
  if (!plan.is_active) return apiError(409, "PLAN_INACTIVE", "Plan is inactive");

  const statusInput = normalizeContractStatus(body?.status) ?? "active";
  const startsAt = normalizeText(body?.startsAt) ?? new Date().toISOString();
  const endsAt = normalizeText(body?.endsAt);
  const note = normalizeText(body?.note);
  const manualRemainingUses =
    body?.remainingUses === null || body?.remainingUses === undefined ? null : Number(body?.remainingUses);
  const manualRemainingSessions =
    body?.remainingSessions === null || body?.remainingSessions === undefined ? null : Number(body?.remainingSessions);
  const idempotencyKeyInput = normalizeText(body?.idempotencyKey);

  if (manualRemainingUses !== null && (!Number.isFinite(manualRemainingUses) || manualRemainingUses < 0)) {
    return apiError(400, "FORBIDDEN", "remainingUses must be zero or positive");
  }
  if (manualRemainingSessions !== null && (!Number.isFinite(manualRemainingSessions) || manualRemainingSessions < 0)) {
    return apiError(400, "FORBIDDEN", "remainingSessions must be zero or positive");
  }

  const startsAtDate = new Date(startsAt);
  if (Number.isNaN(startsAtDate.getTime())) return apiError(400, "FORBIDDEN", "startsAt is invalid");
  const derivedEndsAt =
    endsAt ||
    (typeof plan.default_duration_days === "number" && plan.default_duration_days > 0
      ? addDays(startsAtDate, plan.default_duration_days).toISOString()
      : null);

  const remainingSessions =
    manualRemainingSessions ??
    (plan.fulfillment_kind === "entry_pass" ? Math.max(0, Number(plan.default_quantity ?? 0)) : null);
  const remainingUses = manualRemainingUses;
  const derivedStatus = evaluateContractStatus({
    status: statusInput,
    endsAt: derivedEndsAt,
    remainingUses,
    remainingSessions,
  });

  const operationKey =
    idempotencyKeyInput ||
    [
      "member_plan_assign",
      scoped.auth.context.tenantId,
      id,
      plan.id,
      derivedStatus,
      startsAtDate.toISOString(),
      derivedEndsAt || "na",
      remainingSessions ?? "na",
      remainingUses ?? "na",
    ].join(":");
  const operationClaim = await claimIdempotency({
    supabase: scoped.auth.supabase,
    tenantId: scoped.auth.context.tenantId,
    operationKey,
    actorId: scoped.auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return apiSuccess({ replayed: true, ...operationClaim.existing.response });
    }
    return apiError(409, "FORBIDDEN", "Duplicate member plan assignment request in progress");
  }

  const contractInsert = await scoped.auth.supabase
    .from("member_plan_contracts")
    .insert({
      tenant_id: scoped.auth.context.tenantId,
      branch_id: scoped.member.store_id,
      member_id: id,
      plan_catalog_id: plan.id,
      status: derivedStatus,
      starts_at: startsAtDate.toISOString(),
      ends_at: derivedEndsAt,
      remaining_uses: remainingUses,
      remaining_sessions: remainingSessions,
      auto_renew: plan.allow_auto_renew,
      note,
      created_by: scoped.auth.context.userId,
      updated_by: scoped.auth.context.userId,
      updated_at: new Date().toISOString(),
    })
    .select("id, status, starts_at, ends_at, remaining_uses, remaining_sessions")
    .maybeSingle();
  if (contractInsert.error || !contractInsert.data) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "CONTRACT_INSERT_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", contractInsert.error?.message || "Create contract failed");
  }

  if (plan.fulfillment_kind === "subscription") {
    const subscriptionInsert = await scoped.auth.supabase.from("subscriptions").insert({
      tenant_id: scoped.auth.context.tenantId,
      member_id: id,
      valid_from: startsAtDate.toISOString(),
      valid_to: derivedEndsAt,
      status: derivedStatus === "active" ? "active" : derivedStatus === "canceled" ? "cancelled" : "paused",
      member_plan_contract_id: contractInsert.data.id,
      plan_catalog_id: plan.id,
      auto_renew: plan.allow_auto_renew,
    });
    if (subscriptionInsert.error) {
      await finalizeIdempotency({
        supabase: scoped.auth.supabase,
        tenantId: scoped.auth.context.tenantId,
        operationKey,
        status: "failed",
        errorCode: "SUBSCRIPTION_INSERT_FAILED",
      });
      return apiError(500, "INTERNAL_ERROR", subscriptionInsert.error.message);
    }
  }

  if (plan.fulfillment_kind === "entry_pass") {
    const passType = plan.plan_type === "coach_pack" ? "punch" : "single";
    const passInsert = await scoped.auth.supabase.from("entry_passes").insert({
      tenant_id: scoped.auth.context.tenantId,
      member_id: id,
      pass_type: passType,
      remaining: remainingSessions ?? 0,
      total_sessions: remainingSessions ?? 0,
      expires_at: derivedEndsAt,
      status: derivedStatus === "active" ? "active" : derivedStatus === "expired" ? "expired" : "cancelled",
      member_plan_contract_id: contractInsert.data.id,
      plan_catalog_id: plan.id,
    });
    if (passInsert.error) {
      await finalizeIdempotency({
        supabase: scoped.auth.supabase,
        tenantId: scoped.auth.context.tenantId,
        operationKey,
        status: "failed",
        errorCode: "ENTRY_PASS_INSERT_FAILED",
      });
      return apiError(500, "INTERNAL_ERROR", passInsert.error.message);
    }
  }

  const ledgerInsert = await scoped.auth.supabase.from("member_plan_ledger").insert({
    tenant_id: scoped.auth.context.tenantId,
    branch_id: scoped.member.store_id,
    member_id: id,
    contract_id: contractInsert.data.id,
    source_type: "grant",
    delta_uses: remainingUses ?? 0,
    delta_sessions: remainingSessions ?? 0,
    balance_uses: remainingUses,
    balance_sessions: remainingSessions,
    reference_type: "manager_member_plan_assign",
    reference_id: String(contractInsert.data.id),
    reason: note || "manager_assign",
    payload: {
      planId: plan.id,
      planCode: plan.code,
      status: derivedStatus,
    },
    created_by: scoped.auth.context.userId,
  });
  if (ledgerInsert.error) {
    await finalizeIdempotency({
      supabase: scoped.auth.supabase,
      tenantId: scoped.auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "LEDGER_INSERT_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", ledgerInsert.error.message);
  }

  await scoped.auth.supabase.from("audit_logs").insert({
    tenant_id: scoped.auth.context.tenantId,
    actor_id: scoped.auth.context.userId,
    action: "member_plan_contract_create",
    target_type: "member_plan_contract",
    target_id: String(contractInsert.data.id),
    reason: note || null,
    payload: {
      memberId: id,
      planId: plan.id,
      planCode: plan.code,
      status: derivedStatus,
      startsAt,
      endsAt: derivedEndsAt,
      remainingUses,
      remainingSessions,
    },
  });

  const successPayload = {
    item: {
      id: String(contractInsert.data.id),
      memberId: id,
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      status: derivedStatus,
      startsAt,
      endsAt: derivedEndsAt,
      remainingUses,
      remainingSessions,
    },
  };
  await finalizeIdempotency({
    supabase: scoped.auth.supabase,
    tenantId: scoped.auth.context.tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return apiSuccess(successPayload);
}
