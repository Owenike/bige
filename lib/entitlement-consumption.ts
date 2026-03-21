import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateContractStatus } from "./member-plan-lifecycle";
import { checkMemberEligibility } from "./entitlement-eligibility";

export interface ConsumeSessionInput {
  supabase: SupabaseClient;
  tenantId: string;
  memberId: string;
  actorId: string;
  branchId?: string | null;
  bookingId?: string | null;
  serviceName?: string | null;
  coachId?: string | null;
  quantity?: number;
  sessionNo?: number | null;
  note?: string | null;
  preferredPassId?: string | null;
  preferredContractId?: string | null;
}

type ConsumeSessionFailureCode =
  | "ENTITLEMENT_NOT_FOUND"
  | "ENTITLEMENT_EXPIRED"
  | "ENTITLEMENT_EXHAUSTED"
  | "CONTRACT_STATE_INVALID"
  | "PLAN_INACTIVE"
  | "BRANCH_SCOPE_DENIED"
  | "ELIGIBILITY_DENIED"
  | "NO_MATCHING_ENTITLEMENT"
  | "INTERNAL_ERROR";

export type ConsumeSessionResult =
  | {
      ok: true;
      data: {
        eligibility: Awaited<ReturnType<typeof checkMemberEligibility>>;
        redemption: Record<string, unknown>;
        contract: Record<string, unknown> | null;
      };
    }
  | {
      ok: false;
      status: number;
      code: ConsumeSessionFailureCode;
      message: string;
    };

const REDEMPTION_ERROR_STATUS: Record<string, number> = {
  invalid_redemption_input: 400,
  invalid_redeemed_kind: 400,
  pass_id_required: 400,
  pass_not_found: 404,
  insufficient_remaining_sessions: 400,
};

function isUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingSchemaError(message: string | undefined, tableOrColumn: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = tableOrColumn.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

function mapRedemptionError(message: string | undefined): {
  status: number;
  code: ConsumeSessionFailureCode;
  message: string;
} {
  if (!message) return { status: 500, code: "INTERNAL_ERROR", message: "Redemption failed" };
  if (message.includes("session_redemptions_booking_unique")) {
    return { status: 409, code: "CONTRACT_STATE_INVALID", message: "Booking already redeemed" };
  }
  if (message.includes("session_redemptions_pass_session_unique")) {
    return { status: 409, code: "CONTRACT_STATE_INVALID", message: "Session number already redeemed for this pass" };
  }
  if (message === "pass_not_found") return { status: 404, code: "ENTITLEMENT_NOT_FOUND", message };
  if (message === "insufficient_remaining_sessions") return { status: 400, code: "ENTITLEMENT_EXHAUSTED", message };
  const status = REDEMPTION_ERROR_STATUS[message];
  if (status) return { status, code: "ELIGIBILITY_DENIED", message };
  return { status: 500, code: "INTERNAL_ERROR", message };
}

export async function consumeSessionEntitlement(input: ConsumeSessionInput): Promise<ConsumeSessionResult> {
  const quantity = Math.max(1, Number(input.quantity || 1));
  const eligibility = await checkMemberEligibility({
    supabase: input.supabase,
    tenantId: input.tenantId,
    memberId: input.memberId,
    branchId: input.branchId ?? null,
    scenario: "redemption",
    serviceName: input.serviceName ?? null,
    coachId: input.coachId ?? null,
    preferredPassId: input.preferredPassId ?? null,
    preferredContractId: input.preferredContractId ?? null,
  });

  if (!eligibility.eligible || !eligibility.candidate) {
    const denialCode: ConsumeSessionFailureCode =
      eligibility.reasonCode === "OK" ? "ELIGIBILITY_DENIED" : eligibility.reasonCode;
    return {
      ok: false,
      status: denialCode === "ENTITLEMENT_NOT_FOUND" ? 404 : 409,
      code: denialCode,
      message: eligibility.message,
    };
  }

  if (!eligibility.candidate.passId) {
    return {
      ok: false,
      status: 409,
      code: "ELIGIBILITY_DENIED",
      message: "Selected entitlement cannot be consumed by session redemption",
    };
  }

  const rpcResult = await input.supabase.rpc("redeem_session", {
    p_tenant_id: input.tenantId,
    p_booking_id: input.bookingId || null,
    p_member_id: input.memberId,
    p_redeemed_by: input.actorId,
    p_redeemed_kind: "pass",
    p_pass_id: eligibility.candidate.passId,
    p_session_no: input.sessionNo ?? null,
    p_quantity: quantity,
    p_note: input.note ?? null,
  });

  if (rpcResult.error) {
    const mapped = mapRedemptionError(rpcResult.error.message);
    return {
      ok: false,
      status: mapped.status,
      code: mapped.code,
      message: mapped.message,
    };
  }

  const redemption = Array.isArray(rpcResult.data) ? rpcResult.data[0] : null;
  if (!redemption) {
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Redemption failed",
    };
  }

  let contractSnapshot: Record<string, unknown> | null = null;

  const passResult = await input.supabase
    .from("entry_passes")
    .select("id, member_plan_contract_id, remaining, status, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("id", eligibility.candidate.passId)
    .maybeSingle();
  if (passResult.error) {
    return { ok: false, status: 500, code: "INTERNAL_ERROR", message: passResult.error.message };
  }
  if (!passResult.data) {
    return { ok: false, status: 404, code: "ENTITLEMENT_NOT_FOUND", message: "Pass not found after redemption" };
  }

  const persistedContractId = isUuid(passResult.data.member_plan_contract_id)
    ? String(passResult.data.member_plan_contract_id)
    : isUuid(eligibility.candidate.contractId)
      ? String(eligibility.candidate.contractId)
      : null;

  if (persistedContractId) {
    const contractResult = await input.supabase
      .from("member_plan_contracts")
      .select("id, status, ends_at, remaining_uses, remaining_sessions")
      .eq("tenant_id", input.tenantId)
      .eq("id", persistedContractId)
      .maybeSingle();
    if (contractResult.error && !isMissingSchemaError(contractResult.error.message, "member_plan_contracts")) {
      return { ok: false, status: 500, code: "INTERNAL_ERROR", message: contractResult.error.message };
    }

    if (contractResult.data) {
      const nextStatus = evaluateContractStatus({
        status: contractResult.data.status,
        endsAt: contractResult.data.ends_at ?? passResult.data.expires_at ?? null,
        remainingUses: contractResult.data.remaining_uses,
        remainingSessions:
          typeof passResult.data.remaining === "number"
            ? passResult.data.remaining
            : Number(passResult.data.remaining ?? 0),
      });

      const contractUpdate = await input.supabase
        .from("member_plan_contracts")
        .update({
          remaining_sessions:
            typeof passResult.data.remaining === "number"
              ? passResult.data.remaining
              : Number(passResult.data.remaining ?? 0),
          status: nextStatus,
          updated_by: input.actorId,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", input.tenantId)
        .eq("id", persistedContractId)
        .select("id, status, remaining_sessions, ends_at")
        .maybeSingle();
      if (contractUpdate.error) {
        return { ok: false, status: 500, code: "INTERNAL_ERROR", message: contractUpdate.error.message };
      }
      contractSnapshot = contractUpdate.data || null;
    }

    const patchRedemption = await input.supabase
      .from("session_redemptions")
      .update({ member_plan_contract_id: persistedContractId })
      .eq("id", String(redemption.redemption_id || ""));
    if (patchRedemption.error && !isMissingSchemaError(patchRedemption.error.message, "member_plan_contract_id")) {
      return { ok: false, status: 500, code: "INTERNAL_ERROR", message: patchRedemption.error.message };
    }

    const ledgerInsert = await input.supabase.from("member_plan_ledger").insert({
      tenant_id: input.tenantId,
      branch_id: input.branchId ?? null,
      member_id: input.memberId,
      contract_id: persistedContractId,
      source_type: "redeem",
      delta_uses: 0,
      delta_sessions: -quantity,
      balance_uses: null,
      balance_sessions:
        typeof passResult.data.remaining === "number"
          ? passResult.data.remaining
          : Number(passResult.data.remaining ?? 0),
      reference_type: "session_redemption",
      reference_id: String(redemption.redemption_id || ""),
      reason: input.note || "booking_redemption",
      payload: {
        bookingId: input.bookingId || null,
        passId: eligibility.candidate.passId,
        quantity,
        sessionNo: input.sessionNo ?? null,
      },
      created_by: input.actorId,
    });
    if (ledgerInsert.error && !isMissingSchemaError(ledgerInsert.error.message, "member_plan_ledger")) {
      return { ok: false, status: 500, code: "INTERNAL_ERROR", message: ledgerInsert.error.message };
    }
  }

  return {
    ok: true,
    data: {
      eligibility,
      redemption: redemption as Record<string, unknown>,
      contract: contractSnapshot,
    },
  };
}
