import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "./auth-context";
import { createSupabaseAdminClient } from "./supabase/admin";

export type JobRerunAuditMode = "dry_run" | "execute";
export type JobRerunAuditScope = "platform" | "tenant";

export type JobRerunAuditInput = {
  supabase?: SupabaseClient;
  actorUserId: string | null;
  actorRole: AppRole | null;
  tenantId: string | null;
  scope: JobRerunAuditScope;
  mode: JobRerunAuditMode;
  targetType: "job_run" | "job_type" | "tenant" | "item_level";
  targetId: string | null;
  summary: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export async function writeJobRerunAudit(params: JobRerunAuditInput) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const action = params.mode === "execute" ? "job_rerun_execute" : "job_rerun_dry_run";
  const payload = {
    scope: params.scope,
    mode: params.mode,
    actorRole: params.actorRole,
    summary: params.summary,
    metadata: params.metadata || {},
  };

  const result = await supabase
    .from("audit_logs")
    .insert({
      tenant_id: params.tenantId,
      actor_id: params.actorUserId,
      action,
      target_type: params.targetType,
      target_id: params.targetId,
      reason: null,
      payload,
    })
    .select("id, created_at")
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, item: null as { id: string; created_at: string } | null };
  return {
    ok: true as const,
    item: (result.data || null) as { id: string; created_at: string } | null,
  };
}

export async function writeJobRerunAuditNonBlocking(params: JobRerunAuditInput & { logContext?: string }) {
  const result = await writeJobRerunAudit(params);
  if (!result.ok) {
    console.warn("[job-rerun-audit][write-failed]", {
      context: params.logContext || "unknown",
      mode: params.mode,
      scope: params.scope,
      tenantId: params.tenantId,
      targetType: params.targetType,
      targetId: params.targetId,
      error: result.error,
    });
  }
  return result;
}

