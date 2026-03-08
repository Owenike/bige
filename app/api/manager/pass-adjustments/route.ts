import { apiError, apiSuccess, requireProfile } from "../../../../lib/auth-context";
import { claimIdempotency, finalizeIdempotency } from "../../../../lib/idempotency";
import { requirePermission } from "../../../../lib/permissions";
import { evaluateContractStatus } from "../../../../lib/member-plan-lifecycle";

function isMissingTableError(message: string | undefined, table: string) {
  if (!message) return false;
  const lower = message.toLowerCase();
  const target = table.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes(target)) ||
    (lower.includes("could not find the table") && lower.includes(target))
  );
}

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin", "manager", "supervisor", "branch_manager"], request);
  if (!auth.ok) return auth.response;

  const permission = requirePermission(auth.context, "pass_adjustments.approve");
  if (!permission.ok) {
    return apiError(403, "PASS_ADJUSTMENT_DENIED", "Permission denied: pass_adjustments.approve");
  }
  if (!auth.context.tenantId) return apiError(400, "FORBIDDEN", "Missing tenant context");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const passId = typeof body?.passId === "string" ? body.passId.trim() : "";
  const delta = Number(body?.delta ?? 0);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const idempotencyKeyInput = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!passId || !Number.isFinite(delta) || delta === 0 || !reason) {
    return apiError(400, "FORBIDDEN", "passId, delta, reason are required");
  }

  const passResult = await auth.supabase
    .from("entry_passes")
    .select("id, member_id, remaining, member_plan_contract_id, expires_at, status")
    .eq("id", passId)
    .eq("tenant_id", auth.context.tenantId)
    .maybeSingle();
  if (passResult.error) return apiError(500, "INTERNAL_ERROR", passResult.error.message);
  if (!passResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Pass not found");

  const memberResult = await auth.supabase
    .from("members")
    .select("id, store_id")
    .eq("tenant_id", auth.context.tenantId)
    .eq("id", passResult.data.member_id)
    .maybeSingle();
  if (memberResult.error) return apiError(500, "INTERNAL_ERROR", memberResult.error.message);
  if (!memberResult.data) return apiError(404, "ENTITLEMENT_NOT_FOUND", "Member not found for pass");
  if (auth.context.branchId) {
    if (!memberResult.data.store_id || auth.context.branchId !== memberResult.data.store_id) {
      return apiError(403, "BRANCH_SCOPE_DENIED", "Member is outside branch scope");
    }
  }

  const operationKey =
    idempotencyKeyInput || ["pass_adjustment", auth.context.tenantId, passId, delta, reason].join(":");
  const operationClaim = await claimIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    actorId: auth.context.userId,
    ttlMinutes: 60,
  });
  if (!operationClaim.ok) return apiError(500, "INTERNAL_ERROR", operationClaim.error);
  if (!operationClaim.claimed) {
    if (operationClaim.existing?.status === "succeeded" && operationClaim.existing.response) {
      return apiSuccess({ replayed: true, ...operationClaim.existing.response });
    }
    return apiError(409, "PASS_ADJUSTMENT_DENIED", "Duplicate pass adjustment request in progress");
  }

  const currentRemaining = Number(passResult.data.remaining ?? 0);
  const nextRemaining = Math.max(0, currentRemaining + delta);
  const nowIso = new Date().toISOString();
  const passStatus =
    passResult.data.expires_at && new Date(passResult.data.expires_at).getTime() < Date.now()
      ? "expired"
      : nextRemaining > 0
        ? "active"
        : "expired";

  const passUpdate = await auth.supabase
    .from("entry_passes")
    .update({
      remaining: nextRemaining,
      status: passStatus,
      updated_at: nowIso,
    })
    .eq("id", passId)
    .eq("tenant_id", auth.context.tenantId)
    .select("id, member_id, remaining, status, member_plan_contract_id, updated_at")
    .maybeSingle();
  if (passUpdate.error || !passUpdate.data) {
    await finalizeIdempotency({
      supabase: auth.supabase,
      tenantId: auth.context.tenantId,
      operationKey,
      status: "failed",
      errorCode: "PASS_UPDATE_FAILED",
    });
    return apiError(500, "INTERNAL_ERROR", passUpdate.error?.message || "Pass update failed");
  }

  let contractSnapshot: Record<string, unknown> | null = null;
  const contractId =
    typeof passUpdate.data.member_plan_contract_id === "string" ? passUpdate.data.member_plan_contract_id : null;
  if (contractId) {
    const contractResult = await auth.supabase
      .from("member_plan_contracts")
      .select("id, status, ends_at, remaining_uses, remaining_sessions")
      .eq("tenant_id", auth.context.tenantId)
      .eq("id", contractId)
      .maybeSingle();
    if (contractResult.error) {
      if (!isMissingTableError(contractResult.error.message, "member_plan_contracts")) {
        await finalizeIdempotency({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId,
          operationKey,
          status: "failed",
          errorCode: "CONTRACT_LOAD_FAILED",
        });
        return apiError(500, "INTERNAL_ERROR", contractResult.error.message);
      }
    } else if (contractResult.data) {
      const currentSessions = Number(contractResult.data.remaining_sessions ?? nextRemaining);
      const nextSessions = Math.max(0, currentSessions + delta);
      const nextContractStatus = evaluateContractStatus({
        status: contractResult.data.status,
        endsAt: contractResult.data.ends_at,
        remainingUses: contractResult.data.remaining_uses,
        remainingSessions: nextSessions,
      });

      const contractUpdate = await auth.supabase
        .from("member_plan_contracts")
        .update({
          remaining_sessions: nextSessions,
          status: nextContractStatus,
          updated_by: auth.context.userId,
          updated_at: nowIso,
        })
        .eq("tenant_id", auth.context.tenantId)
        .eq("id", contractId)
        .select("id, status, remaining_sessions, ends_at")
        .maybeSingle();
      if (contractUpdate.error) {
        await finalizeIdempotency({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId,
          operationKey,
          status: "failed",
          errorCode: "CONTRACT_UPDATE_FAILED",
        });
        return apiError(500, "INTERNAL_ERROR", contractUpdate.error.message);
      }
      contractSnapshot = contractUpdate.data || null;

      const ledgerInsert = await auth.supabase.from("member_plan_ledger").insert({
        tenant_id: auth.context.tenantId,
        branch_id: memberResult.data.store_id,
        member_id: passUpdate.data.member_id,
        contract_id: contractId,
        source_type: "adjustment",
        delta_uses: 0,
        delta_sessions: delta,
        balance_uses: null,
        balance_sessions: nextSessions,
        reference_type: "pass_adjustment",
        reference_id: passId,
        reason,
        payload: {
          passId,
          previousRemaining: currentRemaining,
          nextRemaining,
          contractStatus: nextContractStatus,
        },
        created_by: auth.context.userId,
      });
      if (ledgerInsert.error && !isMissingTableError(ledgerInsert.error.message, "member_plan_ledger")) {
        await finalizeIdempotency({
          supabase: auth.supabase,
          tenantId: auth.context.tenantId,
          operationKey,
          status: "failed",
          errorCode: "LEDGER_WRITE_FAILED",
        });
        return apiError(500, "INTERNAL_ERROR", ledgerInsert.error.message);
      }
    }
  }

  await auth.supabase.from("audit_logs").insert({
    tenant_id: auth.context.tenantId,
    actor_id: auth.context.userId,
    action: "pass_adjustment",
    target_type: "entry_pass",
    target_id: passId,
    reason,
    payload: {
      delta,
      previousRemaining: currentRemaining,
      nextRemaining,
      contractId,
      contractSnapshot,
    },
  });

  const successPayload = {
    pass: passUpdate.data,
    contract: contractSnapshot,
  };
  await finalizeIdempotency({
    supabase: auth.supabase,
    tenantId: auth.context.tenantId,
    operationKey,
    status: "succeeded",
    response: successPayload as Record<string, unknown>,
  });

  return apiSuccess(successPayload);
}
