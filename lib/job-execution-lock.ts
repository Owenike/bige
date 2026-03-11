import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "./supabase/admin";

export type LockJobType = "notification_sweep" | "opportunity_sweep" | "delivery_dispatch" | "reminder_bundle";
export type LockTriggerSource = "scheduled" | "manual" | "api" | "inline" | "rerun_execute";
export type LockStatus = "locked" | "released" | "expired";

type LockRow = {
  id: string;
  tenant_id: string | null;
  job_type: LockJobType;
  trigger_source: LockTriggerSource;
  window_start_at: string;
  window_end_at: string;
  scope_key: string;
  lock_status: LockStatus;
  acquired_by: string | null;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
  release_reason: string | null;
  metadata: Record<string, unknown> | null;
};

export type JobExecutionScope = {
  tenantId: string | null;
  jobType: LockJobType;
  triggerSource: LockTriggerSource;
  windowStartAt: string;
  windowEndAt: string;
  scopeKey: string;
};

function isLockTableMissing(message: string | undefined) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes("does not exist") && lower.includes("notification_job_execution_locks")) ||
    (lower.includes("could not find the table") && lower.includes("notification_job_execution_locks"))
  );
}

function floorToWindow(input: Date, windowMinutes: number) {
  const minutes = Math.max(1, Math.floor(windowMinutes));
  const ms = minutes * 60 * 1000;
  return new Date(Math.floor(input.getTime() / ms) * ms);
}

export function buildJobExecutionScope(params: {
  tenantId: string | null;
  jobType: LockJobType;
  triggerSource: LockTriggerSource;
  anchorIso: string;
  windowMinutes?: number;
}) {
  const anchor = new Date(params.anchorIso);
  const safeAnchor = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const windowMinutes = Math.min(240, Math.max(5, Math.floor(params.windowMinutes || 30)));
  const start = floorToWindow(safeAnchor, windowMinutes);
  const end = new Date(start.getTime() + windowMinutes * 60 * 1000);
  const windowStartAt = start.toISOString();
  const windowEndAt = end.toISOString();
  const scopeKey = [params.tenantId || "global", params.jobType, params.triggerSource, windowStartAt].join(":");
  return {
    tenantId: params.tenantId,
    jobType: params.jobType,
    triggerSource: params.triggerSource,
    windowStartAt,
    windowEndAt,
    scopeKey,
  } as JobExecutionScope;
}

async function expireStaleLocks(supabase: SupabaseClient) {
  const result = await supabase
    .from("notification_job_execution_locks")
    .update({
      lock_status: "expired",
      updated_at: new Date().toISOString(),
      released_at: new Date().toISOString(),
      release_reason: "expired_auto_cleanup",
    })
    .eq("lock_status", "locked")
    .is("released_at", null)
    .lt("expires_at", new Date().toISOString());
  if (result.error && !isLockTableMissing(result.error.message)) {
    return { ok: false as const, error: result.error.message };
  }
  return { ok: true as const };
}

export async function listActiveJobExecutionLockConflicts(params: {
  supabase?: SupabaseClient;
  scopes: JobExecutionScope[];
}) {
  if (params.scopes.length === 0) return { ok: true as const, items: [] as LockRow[], warning: null as string | null };
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const keys = Array.from(new Set(params.scopes.map((scope) => scope.scopeKey)));
  const result = await supabase
    .from("notification_job_execution_locks")
    .select("id, tenant_id, job_type, trigger_source, window_start_at, window_end_at, scope_key, lock_status, acquired_by, acquired_at, expires_at, released_at, release_reason, metadata")
    .in("scope_key", keys)
    .eq("lock_status", "locked")
    .is("released_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("acquired_at", { ascending: false });

  if (result.error) {
    if (isLockTableMissing(result.error.message)) {
      return { ok: true as const, items: [] as LockRow[], warning: "notification_job_execution_locks table not found" };
    }
    return { ok: false as const, error: result.error.message, items: [] as LockRow[], warning: null as string | null };
  }
  return {
    ok: true as const,
    items: (result.data || []) as LockRow[],
    warning: null as string | null,
  };
}

export async function claimJobExecutionLock(params: {
  supabase?: SupabaseClient;
  scope: JobExecutionScope;
  actorUserId: string | null;
  ttlMinutes?: number;
  metadata?: Record<string, unknown>;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const cleanup = await expireStaleLocks(supabase);
  if (!cleanup.ok) return { ok: false as const, error: cleanup.error, claimed: false as const, existing: null as LockRow | null };

  const ttlMinutes = Math.min(240, Math.max(1, Math.floor(params.ttlMinutes || 30)));
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const insertResult = await supabase
    .from("notification_job_execution_locks")
    .insert({
      tenant_id: params.scope.tenantId,
      job_type: params.scope.jobType,
      trigger_source: params.scope.triggerSource,
      window_start_at: params.scope.windowStartAt,
      window_end_at: params.scope.windowEndAt,
      scope_key: params.scope.scopeKey,
      lock_status: "locked",
      acquired_by: params.actorUserId,
      expires_at: expiresAt,
      metadata: params.metadata || {},
      updated_at: nowIso,
    })
    .select("id, tenant_id, job_type, trigger_source, window_start_at, window_end_at, scope_key, lock_status, acquired_by, acquired_at, expires_at, released_at, release_reason, metadata")
    .maybeSingle();

  if (!insertResult.error && insertResult.data) {
    return {
      ok: true as const,
      claimed: true as const,
      item: insertResult.data as LockRow,
      existing: null as LockRow | null,
      warning: null as string | null,
    };
  }

  if (insertResult.error && isLockTableMissing(insertResult.error.message)) {
    return {
      ok: true as const,
      claimed: true as const,
      item: null as LockRow | null,
      existing: null as LockRow | null,
      warning: "notification_job_execution_locks table not found",
    };
  }

  const existingResult = await supabase
    .from("notification_job_execution_locks")
    .select("id, tenant_id, job_type, trigger_source, window_start_at, window_end_at, scope_key, lock_status, acquired_by, acquired_at, expires_at, released_at, release_reason, metadata")
    .eq("scope_key", params.scope.scopeKey)
    .eq("lock_status", "locked")
    .is("released_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("acquired_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingResult.error && !isLockTableMissing(existingResult.error.message)) {
    return {
      ok: false as const,
      error: existingResult.error.message,
      claimed: false as const,
      item: null as LockRow | null,
      existing: null as LockRow | null,
      warning: null as string | null,
    };
  }

  return {
    ok: true as const,
    claimed: false as const,
    item: null as LockRow | null,
    existing: (existingResult.data || null) as LockRow | null,
    warning: isLockTableMissing(existingResult.error?.message) ? "notification_job_execution_locks table not found" : null,
  };
}

export async function releaseJobExecutionLock(params: {
  supabase?: SupabaseClient;
  lockId: string | null;
  reason?: string | null;
}) {
  if (!params.lockId) return { ok: true as const };
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("notification_job_execution_locks")
    .update({
      lock_status: "released",
      released_at: nowIso,
      release_reason: params.reason || "released",
      updated_at: nowIso,
    })
    .eq("id", params.lockId);
  if (result.error && !isLockTableMissing(result.error.message)) {
    return { ok: false as const, error: result.error.message };
  }
  return { ok: true as const };
}

