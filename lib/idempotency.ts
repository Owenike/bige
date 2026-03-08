import type { SupabaseClient } from "@supabase/supabase-js";

type IdempotencyState = "processing" | "succeeded" | "failed";

interface OperationIdempotencyRow {
  tenant_id: string | null;
  operation_key: string;
  status: IdempotencyState;
  response: Record<string, unknown> | null;
  error_code: string | null;
  actor_id: string | null;
  expires_at: string | null;
}

function isMissingTableError(message: string | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes("operation_idempotency_keys")) ||
    (lower.includes("could not find the table") && lower.includes("operation_idempotency_keys"))
  );
}

export async function claimIdempotency(params: {
  supabase: SupabaseClient;
  tenantId: string | null;
  operationKey: string;
  actorId?: string | null;
  ttlMinutes?: number;
}) {
  const expiresAt =
    typeof params.ttlMinutes === "number" && params.ttlMinutes > 0
      ? new Date(Date.now() + params.ttlMinutes * 60 * 1000).toISOString()
      : null;

  const insertResult = await params.supabase
    .from("operation_idempotency_keys")
    .insert({
      tenant_id: params.tenantId,
      operation_key: params.operationKey,
      status: "processing",
      actor_id: params.actorId ?? null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .select("tenant_id, operation_key, status, response, error_code, actor_id, expires_at")
    .maybeSingle();

  if (!insertResult.error && insertResult.data) {
    return {
      ok: true as const,
      claimed: true,
      existing: null,
    };
  }

  if (insertResult.error && !isMissingTableError(insertResult.error.message)) {
    if (insertResult.error.code !== "23505") {
      return {
        ok: false as const,
        error: insertResult.error.message,
      };
    }
  }

  const existingResult = await params.supabase
    .from("operation_idempotency_keys")
    .select("tenant_id, operation_key, status, response, error_code, actor_id, expires_at")
    .eq("tenant_id", params.tenantId)
    .eq("operation_key", params.operationKey)
    .maybeSingle();

  if (existingResult.error) {
    if (isMissingTableError(existingResult.error.message)) {
      return {
        ok: true as const,
        claimed: true,
        existing: null,
      };
    }
    return {
      ok: false as const,
      error: existingResult.error.message,
    };
  }

  return {
    ok: true as const,
    claimed: false,
    existing: (existingResult.data as OperationIdempotencyRow | null) ?? null,
  };
}

export async function finalizeIdempotency(params: {
  supabase: SupabaseClient;
  tenantId: string | null;
  operationKey: string;
  status: "succeeded" | "failed";
  response?: Record<string, unknown> | null;
  errorCode?: string | null;
}) {
  const updateResult = await params.supabase
    .from("operation_idempotency_keys")
    .update({
      status: params.status,
      response: params.response ?? null,
      error_code: params.errorCode ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", params.tenantId)
    .eq("operation_key", params.operationKey);

  if (updateResult.error && !isMissingTableError(updateResult.error.message)) {
    return {
      ok: false as const,
      error: updateResult.error.message,
    };
  }
  return {
    ok: true as const,
  };
}
