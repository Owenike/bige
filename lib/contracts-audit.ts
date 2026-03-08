import type { SupabaseClient } from "@supabase/supabase-js";

export async function writeOperationalAudit(params: {
  supabase: SupabaseClient;
  tenantId: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (!params.tenantId) return { ok: false as const, skipped: true as const };
  const result = await params.supabase.from("audit_logs").insert({
    tenant_id: params.tenantId,
    actor_id: params.actorId ?? null,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    reason: params.reason ?? null,
    payload: params.payload ?? {},
  });
  if (result.error) {
    return {
      ok: false as const,
      skipped: false as const,
      error: result.error.message,
    };
  }
  return { ok: true as const, skipped: false as const };
}
