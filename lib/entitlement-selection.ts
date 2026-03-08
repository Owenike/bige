import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateContractStatus, type MemberContractStatus, type MemberPlanType } from "./member-plan-lifecycle";

export type EntitlementScenario = "entry" | "booking" | "checkin" | "redemption";
export type EntitlementUsageBucket = "entry" | "coach";

export type EntitlementDecisionCode =
  | "OK"
  | "ENTITLEMENT_NOT_FOUND"
  | "ENTITLEMENT_EXPIRED"
  | "ENTITLEMENT_EXHAUSTED"
  | "CONTRACT_STATE_INVALID"
  | "PLAN_INACTIVE"
  | "BRANCH_SCOPE_DENIED"
  | "ELIGIBILITY_DENIED"
  | "NO_MATCHING_ENTITLEMENT";

type PlanCatalogSnapshot = {
  id: string;
  code: string | null;
  name: string | null;
  planType: MemberPlanType | null;
  isActive: boolean;
};

type ContractRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string;
  plan_catalog_id: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  remaining_uses: number | null;
  remaining_sessions: number | null;
  created_at: string | null;
};

type EntryPassRow = {
  id: string;
  member_plan_contract_id: string | null;
  pass_type: string | null;
  remaining: number | null;
  total_sessions: number | null;
  expires_at: string | null;
  status: string | null;
  created_at: string | null;
};

type SubscriptionRow = {
  id: string;
  member_plan_contract_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string | null;
  created_at: string | null;
};

export interface EntitlementCandidate {
  contractId: string;
  planCatalogId: string | null;
  planCode: string | null;
  planName: string | null;
  planType: MemberPlanType | null;
  status: MemberContractStatus;
  startsAt: string | null;
  endsAt: string | null;
  remainingUses: number | null;
  remainingSessions: number | null;
  branchId: string | null;
  passId: string | null;
  passType: string | null;
  passRemaining: number | null;
  passExpiresAt: string | null;
  subscriptionId: string | null;
  subscriptionValidTo: string | null;
  sourcePriority: number;
}

export interface EntitlementSelectionResult {
  scenario: EntitlementScenario;
  usageBucket: EntitlementUsageBucket;
  eligible: boolean;
  reasonCode: EntitlementDecisionCode;
  message: string;
  candidate: EntitlementCandidate | null;
  candidates: EntitlementCandidate[];
  evaluatedAt: string;
}

export interface SelectEntitlementInput {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
  branchId?: string | null;
  scenario: EntitlementScenario;
  serviceName?: string | null;
  coachId?: string | null;
  preferredPassId?: string | null;
  preferredContractId?: string | null;
}

type DecisionAccumulator = {
  sawAny: boolean;
  sawBranchDenied: boolean;
  sawPlanInactive: boolean;
  sawExpired: boolean;
  sawExhausted: boolean;
  sawInvalidState: boolean;
};

function toDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function normalizeLifecycleStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "cancelled") return "canceled";
  return value;
}

function normalizePassPlanType(passType: string | null): MemberPlanType | null {
  if (!passType) return null;
  if (passType === "punch") return "coach_pack";
  if (passType === "single") return "entry_pass";
  return null;
}

function inferUsageBucket(input: {
  scenario: EntitlementScenario;
  serviceName: string | null | undefined;
  coachId: string | null | undefined;
}): EntitlementUsageBucket {
  if (input.scenario === "entry" || input.scenario === "checkin") return "entry";
  if (input.scenario === "redemption") return "coach";
  const text = `${input.serviceName || ""}`.toLowerCase();
  if (input.coachId) return "coach";
  if (text.includes("coach") || text.includes("pt") || text.includes("教練") || text.includes("私人")) {
    return "coach";
  }
  return "entry";
}

function planMatchesUsage(planType: MemberPlanType | null, usage: EntitlementUsageBucket): boolean {
  if (usage === "coach") {
    return planType === "coach_pack" || planType === "trial";
  }
  return planType === "subscription" || planType === "entry_pass" || planType === "trial";
}

function computePriority(candidate: EntitlementCandidate, usage: EntitlementUsageBucket): number {
  if (candidate.planType === "trial") return 0;
  if (usage === "coach") {
    if (candidate.planType === "coach_pack") return 1;
    return 50;
  }
  if (candidate.planType === "entry_pass") return 1;
  if (candidate.planType === "subscription") return 2;
  return 50;
}

function hasPositiveBalance(candidate: EntitlementCandidate) {
  if (candidate.planType === "subscription") return true;
  if (typeof candidate.passRemaining === "number") return candidate.passRemaining > 0;
  if (typeof candidate.remainingSessions === "number") return candidate.remainingSessions > 0;
  if (typeof candidate.remainingUses === "number") return candidate.remainingUses > 0;
  return false;
}

function isExpired(candidate: EntitlementCandidate, now: Date) {
  const nowMs = now.getTime();
  const endMs = toDateMs(candidate.endsAt);
  const passEndMs = toDateMs(candidate.passExpiresAt);
  const subEndMs = toDateMs(candidate.subscriptionValidTo);
  const allEnds = [endMs, passEndMs, subEndMs].filter((v): v is number => typeof v === "number");
  if (allEnds.length === 0) return false;
  return Math.min(...allEnds) < nowMs;
}

function matchPreferred(candidate: EntitlementCandidate, input: SelectEntitlementInput) {
  if (input.preferredContractId && candidate.contractId !== input.preferredContractId) return false;
  if (input.preferredPassId) {
    if (!candidate.passId) return false;
    return candidate.passId === input.preferredPassId;
  }
  return true;
}

function chooseDeniedCode(acc: DecisionAccumulator): {
  code: EntitlementDecisionCode;
  message: string;
} {
  if (!acc.sawAny) {
    return { code: "ENTITLEMENT_NOT_FOUND", message: "No entitlement contract found" };
  }
  if (acc.sawBranchDenied) {
    return { code: "BRANCH_SCOPE_DENIED", message: "No entitlement available in this branch scope" };
  }
  if (acc.sawPlanInactive) {
    return { code: "PLAN_INACTIVE", message: "Plan is inactive" };
  }
  if (acc.sawExpired) {
    return { code: "ENTITLEMENT_EXPIRED", message: "All matching entitlements are expired" };
  }
  if (acc.sawExhausted) {
    return { code: "ENTITLEMENT_EXHAUSTED", message: "All matching entitlements are exhausted" };
  }
  if (acc.sawInvalidState) {
    return { code: "CONTRACT_STATE_INVALID", message: "Contract state is not eligible" };
  }
  return { code: "NO_MATCHING_ENTITLEMENT", message: "No matching entitlement for this operation" };
}

async function loadContracts(params: SelectEntitlementInput) {
  const contractsResult = await params.supabase
    .from("member_plan_contracts")
    .select(
      "id, tenant_id, branch_id, member_id, plan_catalog_id, status, starts_at, ends_at, remaining_uses, remaining_sessions, created_at",
    )
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (contractsResult.error) {
    const message = contractsResult.error.message || "";
    if (message.includes("member_plan_contracts") && message.includes("does not exist")) {
      return [] as ContractRow[];
    }
    throw new Error(contractsResult.error.message);
  }
  return (contractsResult.data || []) as ContractRow[];
}

async function loadPlans(params: SelectEntitlementInput, planIds: string[]) {
  if (planIds.length === 0) return new Map<string, PlanCatalogSnapshot>();
  const planResult = await params.supabase
    .from("member_plan_catalog")
    .select("id, code, name, plan_type, is_active")
    .eq("tenant_id", params.tenantId)
    .in("id", planIds)
    .limit(500);
  if (planResult.error) {
    const message = planResult.error.message || "";
    if (message.includes("member_plan_catalog") && message.includes("does not exist")) {
      return new Map<string, PlanCatalogSnapshot>();
    }
    throw new Error(planResult.error.message);
  }
  const map = new Map<string, PlanCatalogSnapshot>();
  for (const row of (planResult.data || []) as Array<Record<string, unknown>>) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const planTypeRaw = typeof row.plan_type === "string" ? row.plan_type : null;
    const planType: MemberPlanType | null =
      planTypeRaw === "subscription" || planTypeRaw === "entry_pass" || planTypeRaw === "coach_pack" || planTypeRaw === "trial"
        ? planTypeRaw
        : null;
    map.set(id, {
      id,
      code: typeof row.code === "string" ? row.code : null,
      name: typeof row.name === "string" ? row.name : null,
      planType,
      isActive: row.is_active !== false,
    });
  }
  return map;
}

async function loadPasses(params: SelectEntitlementInput) {
  const passResult = await params.supabase
    .from("entry_passes")
    .select("id, member_plan_contract_id, pass_type, remaining, total_sessions, expires_at, status, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (passResult.error) {
    const message = passResult.error.message || "";
    if (message.includes("entry_passes") && message.includes("does not exist")) {
      return [] as EntryPassRow[];
    }
    throw new Error(passResult.error.message);
  }
  return (passResult.data || []) as EntryPassRow[];
}

async function loadSubscriptions(params: SelectEntitlementInput) {
  const subResult = await params.supabase
    .from("subscriptions")
    .select("id, member_plan_contract_id, valid_from, valid_to, status, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("member_id", params.memberId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (subResult.error) {
    const message = subResult.error.message || "";
    if (message.includes("subscriptions") && message.includes("does not exist")) {
      return [] as SubscriptionRow[];
    }
    throw new Error(subResult.error.message);
  }
  return (subResult.data || []) as SubscriptionRow[];
}

function buildCandidates(params: {
  contracts: ContractRow[];
  plansById: Map<string, PlanCatalogSnapshot>;
  passes: EntryPassRow[];
  subscriptions: SubscriptionRow[];
  usageBucket: EntitlementUsageBucket;
}): EntitlementCandidate[] {
  const passByContractId = new Map<string, EntryPassRow>();
  for (const pass of params.passes) {
    if (!pass.member_plan_contract_id) continue;
    if (!passByContractId.has(pass.member_plan_contract_id)) passByContractId.set(pass.member_plan_contract_id, pass);
  }
  const subByContractId = new Map<string, SubscriptionRow>();
  for (const sub of params.subscriptions) {
    if (!sub.member_plan_contract_id) continue;
    if (!subByContractId.has(sub.member_plan_contract_id)) subByContractId.set(sub.member_plan_contract_id, sub);
  }

  const fromContracts: EntitlementCandidate[] = params.contracts.map((contract) => {
    const plan = contract.plan_catalog_id ? params.plansById.get(contract.plan_catalog_id) : undefined;
    const pass = passByContractId.get(contract.id);
    const subscription = subByContractId.get(contract.id);
    const passTypeDerived = normalizePassPlanType(pass?.pass_type ?? null);
    const planType = plan?.planType ?? passTypeDerived ?? (subscription ? "subscription" : null);
    const endsAt = contract.ends_at || pass?.expires_at || subscription?.valid_to || null;
    const status = evaluateContractStatus({
      status: normalizeLifecycleStatus(contract.status),
      endsAt,
      remainingUses: contract.remaining_uses,
      remainingSessions: pass?.remaining ?? contract.remaining_sessions,
    });
    const candidate: EntitlementCandidate = {
      contractId: contract.id,
      planCatalogId: contract.plan_catalog_id,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      planType,
      status,
      startsAt: contract.starts_at || subscription?.valid_from || null,
      endsAt,
      remainingUses: contract.remaining_uses,
      remainingSessions: pass?.remaining ?? contract.remaining_sessions,
      branchId: contract.branch_id,
      passId: pass?.id ?? null,
      passType: pass?.pass_type ?? null,
      passRemaining: pass?.remaining ?? null,
      passExpiresAt: pass?.expires_at ?? null,
      subscriptionId: subscription?.id ?? null,
      subscriptionValidTo: subscription?.valid_to ?? null,
      sourcePriority: 0,
    };
    candidate.sourcePriority = computePriority(candidate, params.usageBucket);
    return candidate;
  });

  const knownContractIds = new Set(fromContracts.map((item) => item.contractId));
  const legacyFromPasses: EntitlementCandidate[] = [];
  for (const pass of params.passes) {
    if (pass.member_plan_contract_id && knownContractIds.has(pass.member_plan_contract_id)) continue;
    const planType = normalizePassPlanType(pass.pass_type) ?? "entry_pass";
    const syntheticId = pass.member_plan_contract_id || `legacy-pass-${pass.id}`;
    const status = evaluateContractStatus({
      status: normalizeLifecycleStatus(pass.status) || "active",
      endsAt: pass.expires_at,
      remainingUses: null,
      remainingSessions: pass.remaining,
    });
    const candidate: EntitlementCandidate = {
      contractId: syntheticId,
      planCatalogId: null,
      planCode: null,
      planName: null,
      planType,
      status,
      startsAt: null,
      endsAt: pass.expires_at,
      remainingUses: null,
      remainingSessions: pass.remaining,
      branchId: null,
      passId: pass.id,
      passType: pass.pass_type,
      passRemaining: pass.remaining,
      passExpiresAt: pass.expires_at,
      subscriptionId: null,
      subscriptionValidTo: null,
      sourcePriority: 0,
    };
    candidate.sourcePriority = computePriority(candidate, params.usageBucket);
    legacyFromPasses.push(candidate);
  }

  const legacyFromSubs: EntitlementCandidate[] = [];
  for (const sub of params.subscriptions) {
    if (sub.member_plan_contract_id && knownContractIds.has(sub.member_plan_contract_id)) continue;
    const syntheticId = sub.member_plan_contract_id || `legacy-sub-${sub.id}`;
    const status = evaluateContractStatus({
      status: normalizeLifecycleStatus(sub.status) || "active",
      endsAt: sub.valid_to,
      remainingUses: null,
      remainingSessions: null,
    });
    const candidate: EntitlementCandidate = {
      contractId: syntheticId,
      planCatalogId: null,
      planCode: null,
      planName: null,
      planType: "subscription",
      status,
      startsAt: sub.valid_from,
      endsAt: sub.valid_to,
      remainingUses: null,
      remainingSessions: null,
      branchId: null,
      passId: null,
      passType: null,
      passRemaining: null,
      passExpiresAt: null,
      subscriptionId: sub.id,
      subscriptionValidTo: sub.valid_to,
      sourcePriority: 0,
    };
    candidate.sourcePriority = computePriority(candidate, params.usageBucket);
    legacyFromSubs.push(candidate);
  }

  return [...fromContracts, ...legacyFromPasses, ...legacyFromSubs];
}

export async function selectEntitlementCandidate(input: SelectEntitlementInput): Promise<EntitlementSelectionResult> {
  const now = new Date();
  const usageBucket = inferUsageBucket({
    scenario: input.scenario,
    serviceName: input.serviceName,
    coachId: input.coachId,
  });

  const [contracts, passes, subscriptions] = await Promise.all([
    loadContracts(input),
    loadPasses(input),
    loadSubscriptions(input),
  ]);
  const planIds = Array.from(
    new Set(
      contracts
        .map((row) => row.plan_catalog_id || "")
        .filter((value) => value.length > 0),
    ),
  );
  const plansById = await loadPlans(input, planIds);

  const candidates = buildCandidates({
    contracts,
    plansById,
    passes,
    subscriptions,
    usageBucket,
  });

  const acc: DecisionAccumulator = {
    sawAny: candidates.length > 0,
    sawBranchDenied: false,
    sawPlanInactive: false,
    sawExpired: false,
    sawExhausted: false,
    sawInvalidState: false,
  };

  const eligible = candidates.filter((candidate) => {
    if (!matchPreferred(candidate, input)) {
      acc.sawInvalidState = true;
      return false;
    }

    if (input.branchId && candidate.branchId && candidate.branchId !== input.branchId) {
      acc.sawBranchDenied = true;
      return false;
    }

    if (candidate.planCatalogId) {
      const plan = plansById.get(candidate.planCatalogId);
      if (plan && !plan.isActive) {
        acc.sawPlanInactive = true;
        return false;
      }
    }

    if (!planMatchesUsage(candidate.planType, usageBucket)) {
      acc.sawInvalidState = true;
      return false;
    }

    if (candidate.status !== "active") {
      if (candidate.status === "expired") acc.sawExpired = true;
      if (candidate.status === "exhausted") acc.sawExhausted = true;
      if (candidate.status === "pending" || candidate.status === "frozen" || candidate.status === "canceled") {
        acc.sawInvalidState = true;
      }
      return false;
    }

    if (isExpired(candidate, now)) {
      acc.sawExpired = true;
      return false;
    }

    if (!hasPositiveBalance(candidate)) {
      acc.sawExhausted = true;
      return false;
    }

    if (candidate.planType === "subscription" && candidate.subscriptionId && candidate.subscriptionValidTo) {
      const subValidTo = toDateMs(candidate.subscriptionValidTo);
      if (subValidTo !== null && subValidTo < now.getTime()) {
        acc.sawExpired = true;
        return false;
      }
    }

    return true;
  });

  eligible.sort((a, b) => {
    if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
    const aEnd = toDateMs(a.endsAt) ?? Number.POSITIVE_INFINITY;
    const bEnd = toDateMs(b.endsAt) ?? Number.POSITIVE_INFINITY;
    if (aEnd !== bEnd) return aEnd - bEnd;
    const aStart = toDateMs(a.startsAt) ?? Number.POSITIVE_INFINITY;
    const bStart = toDateMs(b.startsAt) ?? Number.POSITIVE_INFINITY;
    return aStart - bStart;
  });

  const chosen = eligible[0] || null;
  if (chosen) {
    return {
      scenario: input.scenario,
      usageBucket,
      eligible: true,
      reasonCode: "OK",
      message: "Eligible",
      candidate: chosen,
      candidates: eligible,
      evaluatedAt: now.toISOString(),
    };
  }

  const denied = chooseDeniedCode(acc);
  return {
    scenario: input.scenario,
    usageBucket,
    eligible: false,
    reasonCode: denied.code,
    message: denied.message,
    candidate: null,
    candidates: [],
    evaluatedAt: now.toISOString(),
  };
}
