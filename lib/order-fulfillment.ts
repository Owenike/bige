import { addDays, type MemberPlanType, type PlanCatalogRow, type PlanFulfillmentKind } from "./member-plan-lifecycle";
import type { SupabaseClient } from "@supabase/supabase-js";

const MONTHLY_30D_CODE = "monthly_30d";
const SINGLE_PASS_CODE = "single_pass";
const PUNCH_10_CODE = "punch_10";

type SupabaseLike = SupabaseClient;

interface FulfillOrderInput {
  supabase: SupabaseLike;
  tenantId: string;
  orderId: string;
  actorId: string | null;
  memberId: string | null;
  paymentId?: string | null;
}

type OrderLine = {
  id: string;
  title: string;
  quantity: number;
  item_type: string;
};

function parseCodeQuantity(lineTitle: string, quantity: number) {
  const q = Math.max(1, Number(quantity || 1));
  const code = String(lineTitle || "").trim();
  return { code, quantity: q };
}

function isSchemaMissing(message: string | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("does not exist") || lower.includes("schema cache");
}

function inferPlanType(line: OrderLine, code: string): MemberPlanType {
  if (line.item_type === "subscription") return "subscription";
  if (code === MONTHLY_30D_CODE) return "subscription";
  if (code === PUNCH_10_CODE) return "coach_pack";
  if (code === SINGLE_PASS_CODE) return "entry_pass";
  return "entry_pass";
}

function inferFulfillmentKind(line: OrderLine, plan: PlanCatalogRow | null): PlanFulfillmentKind {
  if (plan?.fulfillment_kind) return plan.fulfillment_kind;
  if (line.item_type === "subscription") return "subscription";
  if (line.item_type === "entry_pass") return "entry_pass";
  return "none";
}

function inferDurationDays(code: string, plan: PlanCatalogRow | null, kind: PlanFulfillmentKind) {
  if (typeof plan?.default_duration_days === "number" && plan.default_duration_days > 0) {
    return plan.default_duration_days;
  }
  if (kind === "subscription") return 30;
  if (code === PUNCH_10_CODE) return 180;
  return 30;
}

function inferGrantedSessions(code: string, lineQty: number, plan: PlanCatalogRow | null) {
  if (typeof plan?.default_quantity === "number" && plan.default_quantity >= 0) {
    return Math.max(0, plan.default_quantity * lineQty);
  }
  if (code === PUNCH_10_CODE) return lineQty * 10;
  return lineQty;
}

async function loadPlanByCodes(params: {
  supabase: SupabaseLike;
  tenantId: string;
  codes: string[];
}) {
  if (params.codes.length === 0) return new Map<string, PlanCatalogRow>();
  const result = await params.supabase
    .from("member_plan_catalog")
    .select(
      "id, tenant_id, code, name, description, plan_type, fulfillment_kind, default_duration_days, default_quantity, allow_auto_renew, is_active",
    )
    .eq("tenant_id", params.tenantId)
    .in("code", params.codes);

  if (result.error || !result.data) return new Map<string, PlanCatalogRow>();
  const map = new Map<string, PlanCatalogRow>();
  for (const row of result.data) {
    const code = typeof row.code === "string" ? row.code : "";
    if (!code) continue;
    map.set(code, {
      id: String(row.id || ""),
      tenant_id: String(row.tenant_id || ""),
      code,
      name: String(row.name || code),
      description: typeof row.description === "string" ? row.description : null,
      plan_type: (row.plan_type as MemberPlanType) || "entry_pass",
      fulfillment_kind: (row.fulfillment_kind as PlanFulfillmentKind) || "none",
      default_duration_days:
        typeof row.default_duration_days === "number" ? row.default_duration_days : null,
      default_quantity: typeof row.default_quantity === "number" ? row.default_quantity : null,
      allow_auto_renew: row.allow_auto_renew === true,
      is_active: row.is_active !== false,
    });
  }
  return map;
}

async function createContract(params: {
  input: FulfillOrderInput;
  memberBranchId: string | null;
  memberId: string;
  plan: PlanCatalogRow | null;
  status: "active" | "pending";
  startsAt: string;
  endsAt: string | null;
  remainingUses: number | null;
  remainingSessions: number | null;
  note: string | null;
}) {
  const fallbackLegacy = {
    ok: true as const,
    legacy: true as const,
    contract: null,
  };
  const insertResult = await params.input.supabase
    .from("member_plan_contracts")
    .insert({
      tenant_id: params.input.tenantId,
      branch_id: params.memberBranchId,
      member_id: params.memberId,
      plan_catalog_id: params.plan?.id ?? null,
      source_order_id: params.input.orderId,
      source_payment_id: params.input.paymentId ?? null,
      status: params.status,
      starts_at: params.startsAt,
      ends_at: params.endsAt,
      remaining_uses: params.remainingUses,
      remaining_sessions: params.remainingSessions,
      auto_renew: params.plan?.allow_auto_renew === true,
      note: params.note,
      created_by: params.input.actorId,
      updated_by: params.input.actorId,
    })
    .select("id, status, starts_at, ends_at, remaining_uses, remaining_sessions")
    .maybeSingle();

  if (insertResult.error || !insertResult.data) {
    if (isSchemaMissing(insertResult.error?.message)) {
      return fallbackLegacy;
    }
    return {
      ok: false as const,
      reason: insertResult.error?.message || "Create member_plan_contracts failed",
    };
  }

  return {
    ok: true as const,
    legacy: false as const,
    contract: insertResult.data,
  };
}

async function writeLedger(params: {
  input: FulfillOrderInput;
  memberId: string;
  memberBranchId: string | null;
  contractId: string;
  sourceType: "grant";
  deltaUses: number;
  deltaSessions: number;
  balanceUses: number | null;
  balanceSessions: number | null;
  referenceType: string;
  referenceId: string;
  reason: string;
  payload: Record<string, unknown>;
}) {
  const result = await params.input.supabase
    .from("member_plan_ledger")
    .insert({
      tenant_id: params.input.tenantId,
      branch_id: params.memberBranchId,
      member_id: params.memberId,
      contract_id: params.contractId,
      source_type: params.sourceType,
      delta_uses: params.deltaUses,
      delta_sessions: params.deltaSessions,
      balance_uses: params.balanceUses,
      balance_sessions: params.balanceSessions,
      reference_type: params.referenceType,
      reference_id: params.referenceId,
      reason: params.reason,
      payload: params.payload,
      created_by: params.input.actorId,
    })
    .select("id")
    .maybeSingle();
  if (result.error && !isSchemaMissing(result.error.message)) {
    throw new Error(result.error.message);
  }
}

export async function fulfillOrderEntitlements(input: FulfillOrderInput) {
  if (!input.memberId) {
    return { ok: false as const, fulfilled: false, reason: "missing_member_id" };
  }

  const existing = await input.supabase
    .from("audit_logs")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("action", "order_fulfilled")
    .eq("target_type", "order")
    .eq("target_id", input.orderId)
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return { ok: true as const, fulfilled: false, reason: "already_fulfilled" };
  }

  const lineResult = await input.supabase
    .from("order_items")
    .select("id, title, quantity, item_type")
    .eq("tenant_id", input.tenantId)
    .eq("order_id", input.orderId);

  if (lineResult.error) {
    return { ok: false as const, fulfilled: false, reason: lineResult.error.message };
  }

  const lines = ((lineResult.data || []) as Record<string, unknown>[])
    .map((row) => ({
      id: String(row.id || ""),
      title: String(row.title || ""),
      quantity: Number(row.quantity || 1),
      item_type: String(row.item_type || ""),
    }))
    .filter((row) => row.id && row.title);

  if (!lines.length) {
    return { ok: true as const, fulfilled: false, reason: "no_order_items" };
  }

  const memberResult = await input.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.memberId)
    .maybeSingle();
  if (memberResult.error || !memberResult.data) {
    return { ok: false as const, fulfilled: false, reason: memberResult.error?.message || "member_not_found" };
  }
  const memberBranchId = typeof memberResult.data.store_id === "string" ? memberResult.data.store_id : null;

  const codes = Array.from(new Set(lines.map((line) => parseCodeQuantity(line.title, line.quantity).code)));
  const plansByCode = await loadPlanByCodes({ supabase: input.supabase, tenantId: input.tenantId, codes });

  const grants: Array<Record<string, unknown>> = [];
  const now = new Date();

  for (const line of lines) {
    const parsed = parseCodeQuantity(line.title, line.quantity);
    const plan = plansByCode.get(parsed.code) ?? null;
    const fulfillmentKind = inferFulfillmentKind(line, plan);
    if (fulfillmentKind === "none") continue;

    if (fulfillmentKind === "subscription") {
      const activeSub = await input.supabase
        .from("subscriptions")
        .select("id, valid_to")
        .eq("tenant_id", input.tenantId)
        .eq("member_id", input.memberId)
        .eq("status", "active")
        .gte("valid_to", now.toISOString())
        .order("valid_to", { ascending: false })
        .limit(1)
        .maybeSingle();

      const startAt = activeSub.data?.valid_to ? new Date(String(activeSub.data.valid_to)) : now;
      const durationDays = inferDurationDays(parsed.code, plan, fulfillmentKind) * parsed.quantity;
      const validTo = addDays(startAt, durationDays);
      const contractResult = await createContract({
        input,
        memberBranchId,
        memberId: input.memberId,
        plan,
        status: "active",
        startsAt: startAt.toISOString(),
        endsAt: validTo.toISOString(),
        remainingUses: null,
        remainingSessions: null,
        note: "order_fulfillment_subscription",
      });
      if (!contractResult.ok) {
        return { ok: false as const, fulfilled: false, reason: contractResult.reason };
      }
      const contractId = contractResult.contract?.id ? String(contractResult.contract.id) : null;

      let subscriptionInsert = await input.supabase
        .from("subscriptions")
        .insert({
          tenant_id: input.tenantId,
          member_id: input.memberId,
          valid_from: startAt.toISOString(),
          valid_to: validTo.toISOString(),
          status: "active",
          member_plan_contract_id: contractId,
          plan_catalog_id: plan?.id ?? null,
          source_order_id: input.orderId,
          source_payment_id: input.paymentId ?? null,
          auto_renew: plan?.allow_auto_renew === true,
        })
        .select("id")
        .maybeSingle();
      if (subscriptionInsert.error && isSchemaMissing(subscriptionInsert.error.message)) {
        subscriptionInsert = await input.supabase
          .from("subscriptions")
          .insert({
            tenant_id: input.tenantId,
            member_id: input.memberId,
            valid_from: startAt.toISOString(),
            valid_to: validTo.toISOString(),
            status: "active",
          })
          .select("id")
          .maybeSingle();
      }

      if (subscriptionInsert.error || !subscriptionInsert.data) {
        return {
          ok: false as const,
          fulfilled: false,
          reason: subscriptionInsert.error?.message || "subscription_insert_failed",
        };
      }

      if (contractId) {
        await writeLedger({
          input,
          memberId: input.memberId,
          memberBranchId,
          contractId,
          sourceType: "grant",
          deltaUses: 0,
          deltaSessions: 0,
          balanceUses: null,
          balanceSessions: null,
          referenceType: "subscription",
          referenceId: String(subscriptionInsert.data.id),
          reason: "order_payment_settled",
          payload: {
            code: parsed.code,
            lineId: line.id,
            durationDays,
            planType: plan?.plan_type ?? inferPlanType(line, parsed.code),
          },
        });
      }

      grants.push({
        type: "subscription",
        code: parsed.code,
        contractId,
        subscriptionId: subscriptionInsert.data.id,
        validFrom: startAt.toISOString(),
        validTo: validTo.toISOString(),
      });
      continue;
    }

    if (fulfillmentKind === "entry_pass") {
      const grantedSessions = inferGrantedSessions(parsed.code, parsed.quantity, plan);
      const durationDays = inferDurationDays(parsed.code, plan, fulfillmentKind);
      const expiresAt = addDays(now, durationDays).toISOString();
      const nextStatus = grantedSessions > 0 ? "active" : "exhausted";

      const contractResult = await createContract({
        input,
        memberBranchId,
        memberId: input.memberId,
        plan,
        status: nextStatus === "active" ? "active" : "pending",
        startsAt: now.toISOString(),
        endsAt: expiresAt,
        remainingUses: null,
        remainingSessions: grantedSessions,
        note: "order_fulfillment_entry_pass",
      });
      if (!contractResult.ok) {
        return { ok: false as const, fulfilled: false, reason: contractResult.reason };
      }
      const contractId = contractResult.contract?.id ? String(contractResult.contract.id) : null;

      const passType = parsed.code === SINGLE_PASS_CODE || grantedSessions <= 1 ? "single" : "punch";
      let passInsert = await input.supabase
        .from("entry_passes")
        .insert({
          tenant_id: input.tenantId,
          member_id: input.memberId,
          pass_type: passType,
          remaining: grantedSessions,
          total_sessions: grantedSessions,
          expires_at: expiresAt,
          status: grantedSessions > 0 ? "active" : "expired",
          member_plan_contract_id: contractId,
          plan_catalog_id: plan?.id ?? null,
          source_order_id: input.orderId,
          source_payment_id: input.paymentId ?? null,
        })
        .select("id, remaining, expires_at")
        .maybeSingle();
      if (passInsert.error && isSchemaMissing(passInsert.error.message)) {
        passInsert = await input.supabase
          .from("entry_passes")
          .insert({
            tenant_id: input.tenantId,
            member_id: input.memberId,
            pass_type: passType,
            remaining: grantedSessions,
            expires_at: expiresAt,
            status: grantedSessions > 0 ? "active" : "expired",
          })
          .select("id, remaining, expires_at")
          .maybeSingle();
      }

      if (passInsert.error || !passInsert.data) {
        return {
          ok: false as const,
          fulfilled: false,
          reason: passInsert.error?.message || "entry_pass_insert_failed",
        };
      }

      if (contractId) {
        await writeLedger({
          input,
          memberId: input.memberId,
          memberBranchId,
          contractId,
          sourceType: "grant",
          deltaUses: 0,
          deltaSessions: grantedSessions,
          balanceUses: null,
          balanceSessions: grantedSessions,
          referenceType: "entry_pass",
          referenceId: String(passInsert.data.id),
          reason: "order_payment_settled",
          payload: {
            code: parsed.code,
            lineId: line.id,
            grantedSessions,
            expiresAt,
            planType: plan?.plan_type ?? inferPlanType(line, parsed.code),
          },
        });
      }

      grants.push({
        type: "entry_pass",
        code: parsed.code,
        contractId,
        passId: passInsert.data.id,
        grantedSessions,
        expiresAt,
      });
    }
  }

  await input.supabase
    .from("audit_logs")
    .insert({
      tenant_id: input.tenantId,
      actor_id: input.actorId,
      action: "order_fulfilled",
      target_type: "order",
      target_id: input.orderId,
      reason: "payment_settled",
      payload: { memberId: input.memberId, grants, sourcePaymentId: input.paymentId ?? null },
    })
    .select("id")
    .maybeSingle();

  return { ok: true as const, fulfilled: true, reason: null };
}

export const PURCHASE_PRODUCT_CODES = {
  MONTHLY_30D_CODE,
  SINGLE_PASS_CODE,
  PUNCH_10_CODE,
} as const;
