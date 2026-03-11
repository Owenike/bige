import type { SupabaseClient } from "@supabase/supabase-js";
import { runNotificationSweep } from "./in-app-notifications";
import { buildJobExecutionScope, claimJobExecutionLock, listActiveJobExecutionLockConflicts, releaseJobExecutionLock, type LockJobType } from "./job-execution-lock";
import { completeJobRun, createJobRun } from "./notification-ops";
import { runOpportunitySweep } from "./opportunities";
import { createSupabaseAdminClient } from "./supabase/admin";
import type { AppRole } from "./auth-context";

type JobStatus = "running" | "success" | "failed" | "partial";
type JobTriggerMode = "scheduled" | "manual" | "api" | "inline";

type JobRunRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  job_type: LockJobType;
  trigger_mode: JobTriggerMode;
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
  affected_count: number | null;
  error_count: number | null;
  error_summary: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type JobRerunTargetType = "job_run" | "job_type" | "tenant" | "item_level";

export type JobRerunUnitGuidance = {
  jobType: LockJobType;
  recommendedUnit: JobRerunTargetType;
  reason: string;
};

export type JobRerunDryRunPlan = {
  target: {
    type: "job_run";
    jobRunId: string;
    tenantId: string | null;
    branchId: string | null;
    jobType: LockJobType;
    triggerMode: JobTriggerMode;
    status: JobStatus;
    createdAt: string;
    errorCount: number;
  };
  failedOnly: true;
  executeEnabled: boolean;
  planned: Array<{
    plannedUnit: "job_run";
    sourceJobRunId: string;
    tenantId: string;
    jobType: LockJobType;
    windowStartAt: string;
    windowEndAt: string;
    scopeKey: string;
    estimatedAffectedCount: number;
    estimatedErrorCount: number;
  }>;
  skipped: Array<{
    sourceJobRunId: string;
    reasonCode: string;
    reason: string;
  }>;
  lockConflicts: Array<{
    scopeKey: string;
    acquiredAt: string;
    expiresAt: string;
    acquiredBy: string | null;
  }>;
  dedupeSignals: Array<{
    code: string;
    message: string;
  }>;
  riskHints: string[];
  warnings: string[];
  guidance: JobRerunUnitGuidance[];
};

export type JobRerunExecuteResult = {
  executionJobRunId: string | null;
  sourceJobRunId: string;
  tenantId: string;
  jobType: LockJobType;
  status: "success" | "failed" | "partial";
  affectedCount: number;
  errorCount: number;
  errorSummary: string | null;
  lock: {
    lockId: string | null;
    scopeKey: string;
  };
};

function readSweepError(input: unknown) {
  if (input && typeof input === "object" && "error" in input && typeof (input as { error?: unknown }).error === "string") {
    return (input as { error: string }).error;
  }
  return "Sweep execution failed";
}

const GUIDANCE: JobRerunUnitGuidance[] = [
  {
    jobType: "notification_sweep",
    recommendedUnit: "job_run",
    reason: "in_app notification and delivery rows already have dedupe keys; rerun should anchor to a failed run scope.",
  },
  {
    jobType: "opportunity_sweep",
    recommendedUnit: "job_run",
    reason: "crm opportunities use tenant+dedupe_key uniqueness; rerun should stay run-scoped and failed-only.",
  },
  {
    jobType: "delivery_dispatch",
    recommendedUnit: "item_level",
    reason: "delivery retry eligibility is per delivery record; prefer notification retry pipeline over job-level rerun.",
  },
  {
    jobType: "reminder_bundle",
    recommendedUnit: "job_type",
    reason: "reserved type; no active runtime in current chain.",
  },
];

function nowIso() {
  return new Date().toISOString();
}

async function findNewerSuccessfulRun(params: {
  supabase: SupabaseClient;
  tenantId: string;
  jobType: LockJobType;
  createdAt: string;
  sourceJobRunId: string;
}) {
  const result = await params.supabase
    .from("notification_job_runs")
    .select("id, created_at, status")
    .eq("tenant_id", params.tenantId)
    .eq("job_type", params.jobType)
    .in("status", ["success", "partial"])
    .gt("created_at", params.createdAt)
    .neq("id", params.sourceJobRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, row: null as { id: string; created_at: string; status: string } | null };
  return { ok: true as const, row: (result.data || null) as { id: string; created_at: string; status: string } | null };
}

async function findRunningRun(params: {
  supabase: SupabaseClient;
  tenantId: string;
  jobType: LockJobType;
  sourceJobRunId: string;
}) {
  const result = await params.supabase
    .from("notification_job_runs")
    .select("id, created_at")
    .eq("tenant_id", params.tenantId)
    .eq("job_type", params.jobType)
    .eq("status", "running")
    .neq("id", params.sourceJobRunId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) return { ok: false as const, error: result.error.message, row: null as { id: string; created_at: string } | null };
  return { ok: true as const, row: (result.data || null) as { id: string; created_at: string } | null };
}

export async function buildJobRerunDryRunPlan(params: {
  supabase?: SupabaseClient;
  jobRunId: string;
  failedOnly: true;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  const result = await supabase
    .from("notification_job_runs")
    .select("id, tenant_id, branch_id, job_type, trigger_mode, status, started_at, finished_at, affected_count, error_count, error_summary, payload, created_at, updated_at")
    .eq("id", params.jobRunId)
    .maybeSingle();
  if (result.error) return { ok: false as const, code: "query_failed" as const, error: result.error };
  if (!result.data) return { ok: false as const, code: "not_found" as const, error: "job run not found" };

  const row = result.data as JobRunRow;
  const plan: JobRerunDryRunPlan = {
    target: {
      type: "job_run",
      jobRunId: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      jobType: row.job_type,
      triggerMode: row.trigger_mode,
      status: row.status,
      createdAt: row.created_at,
      errorCount: Number(row.error_count || 0),
    },
    failedOnly: true,
    executeEnabled: true,
    planned: [],
    skipped: [],
    lockConflicts: [],
    dedupeSignals: [],
    riskHints: [],
    warnings: [],
    guidance: GUIDANCE,
  };

  if (!(row.status === "failed" || row.status === "partial")) {
    plan.skipped.push({
      sourceJobRunId: row.id,
      reasonCode: "FAILED_ONLY_ENFORCED",
      reason: "target job run status is not failed/partial",
    });
    plan.riskHints.push("failed-only policy blocked rerun planning for non-failed target.");
    return { ok: true as const, plan };
  }

  if (!row.tenant_id) {
    plan.skipped.push({
      sourceJobRunId: row.id,
      reasonCode: "TENANT_SCOPE_REQUIRED",
      reason: "phase 2-1 rerun is restricted to tenant-scoped runs",
    });
    plan.riskHints.push("global-scope run rerun is disabled in phase 2-1 to avoid broad blast radius.");
    return { ok: true as const, plan };
  }

  if (row.job_type === "delivery_dispatch") {
    plan.skipped.push({
      sourceJobRunId: row.id,
      reasonCode: "ITEM_LEVEL_RETRY_REQUIRED",
      reason: "delivery_dispatch should use item-level notification retry pipeline",
    });
    plan.riskHints.push("use /platform-admin/notification-retry for delivery item-level retries.");
    return { ok: true as const, plan };
  }

  const scope = buildJobExecutionScope({
    tenantId: row.tenant_id,
    jobType: row.job_type,
    triggerSource: "rerun_execute",
    anchorIso: row.created_at,
    windowMinutes: 30,
  });
  plan.planned.push({
    plannedUnit: "job_run",
    sourceJobRunId: row.id,
    tenantId: row.tenant_id,
    jobType: row.job_type,
    windowStartAt: scope.windowStartAt,
    windowEndAt: scope.windowEndAt,
    scopeKey: scope.scopeKey,
    estimatedAffectedCount: Number(row.affected_count || 0),
    estimatedErrorCount: Number(row.error_count || 0),
  });

  const lockConflicts = await listActiveJobExecutionLockConflicts({
    supabase,
    scopes: [scope],
  });
  if (!lockConflicts.ok) {
    plan.warnings.push(`lock check failed: ${lockConflicts.error}`);
  } else {
    if (lockConflicts.warning) plan.warnings.push(lockConflicts.warning);
    plan.lockConflicts = lockConflicts.items.map((item) => ({
      scopeKey: item.scope_key,
      acquiredAt: item.acquired_at,
      expiresAt: item.expires_at,
      acquiredBy: item.acquired_by || null,
    }));
    if (plan.lockConflicts.length > 0) {
      plan.riskHints.push("active execution lock exists for the same tenant/job/window scope.");
    }
  }

  const [newerSuccess, running] = await Promise.all([
    findNewerSuccessfulRun({
      supabase,
      tenantId: row.tenant_id,
      jobType: row.job_type,
      createdAt: row.created_at,
      sourceJobRunId: row.id,
    }),
    findRunningRun({
      supabase,
      tenantId: row.tenant_id,
      jobType: row.job_type,
      sourceJobRunId: row.id,
    }),
  ]);

  if (!newerSuccess.ok) {
    plan.warnings.push(`newer-success check failed: ${newerSuccess.error}`);
  } else if (newerSuccess.row) {
    plan.dedupeSignals.push({
      code: "NEWER_SUCCESS_EXISTS",
      message: `newer successful/partial run ${newerSuccess.row.id} at ${newerSuccess.row.created_at}`,
    });
    plan.riskHints.push("a newer successful run already exists; rerun may be unnecessary.");
  }

  if (!running.ok) {
    plan.warnings.push(`running-check failed: ${running.error}`);
  } else if (running.row) {
    plan.dedupeSignals.push({
      code: "RUNNING_JOB_EXISTS",
      message: `another running job ${running.row.id} at ${running.row.created_at}`,
    });
    plan.riskHints.push("another run is currently running for this tenant/job_type.");
  }

  plan.riskHints.push("execute requires dry-run preview token + confirmPhrase + lock claim.");
  plan.warnings.push(`dry-run generated at ${nowIso()}`);
  return { ok: true as const, plan };
}

export async function executeJobRerunPlan(params: {
  supabase?: SupabaseClient;
  plan: JobRerunDryRunPlan;
  actorUserId: string;
  actorRole: AppRole;
}) {
  const supabase = params.supabase ?? createSupabaseAdminClient();
  if (params.plan.planned.length === 0) {
    return {
      ok: false as const,
      code: "NOTHING_TO_EXECUTE" as const,
      error: "No planned rerun items from dry-run result",
    };
  }

  const item = params.plan.planned[0];
  if (item.jobType === "delivery_dispatch") {
    return {
      ok: false as const,
      code: "DELIVERY_DISPATCH_NOT_ALLOWED" as const,
      error: "delivery_dispatch is restricted to item-level retry flow",
    };
  }

  const scope = buildJobExecutionScope({
    tenantId: item.tenantId,
    jobType: item.jobType,
    triggerSource: "rerun_execute",
    anchorIso: item.windowStartAt,
    windowMinutes: Math.max(5, Math.round((new Date(item.windowEndAt).getTime() - new Date(item.windowStartAt).getTime()) / (60 * 1000))),
  });

  const claim = await claimJobExecutionLock({
    supabase,
    scope,
    actorUserId: params.actorUserId,
    ttlMinutes: 30,
    metadata: {
      sourceJobRunId: item.sourceJobRunId,
      mode: "job_rerun_execute",
      failedOnly: true,
    },
  });
  if (!claim.ok) return { ok: false as const, code: "LOCK_CLAIM_FAILED" as const, error: claim.error };
  if (claim.warning) {
    return {
      ok: false as const,
      code: "LOCK_INFRA_UNAVAILABLE" as const,
      error: claim.warning,
    };
  }
  if (!claim.claimed) {
    return {
      ok: false as const,
      code: "LOCK_CONFLICT" as const,
      error: "Active execution lock exists for this tenant/job/window scope",
      existingLock: claim.existing || null,
    };
  }

  let createdJobRunId: string | null = null;
  try {
    const created = await createJobRun({
      supabase,
      tenantId: item.tenantId,
      jobType: item.jobType,
      triggerMode: "manual",
      initiatedBy: params.actorUserId,
      payload: {
        source: "job_rerun_execute",
        sourceJobRunId: item.sourceJobRunId,
        failedOnly: true,
        scopeKey: scope.scopeKey,
      },
    });
    if (!created.ok) {
      return { ok: false as const, code: "JOB_RUN_CREATE_FAILED" as const, error: created.error };
    }
    createdJobRunId = created.jobRunId;

    let status: "success" | "failed" | "partial" = "success";
    let affectedCount = 0;
    let errorCount = 0;
    let errorSummary: string | null = null;
    let payload: Record<string, unknown> = {};

    if (item.jobType === "notification_sweep") {
      const rerun = await runNotificationSweep({
        actorRole: params.actorRole,
        actorUserId: params.actorUserId,
        tenantId: item.tenantId,
      });
      if (!rerun.ok) {
        status = "failed";
        errorCount = 1;
        errorSummary = readSweepError(rerun);
      } else {
        affectedCount = rerun.summary.generated;
        payload = { byEventType: rerun.summary.byEventType };
      }
    } else if (item.jobType === "opportunity_sweep") {
      const rerun = await runOpportunitySweep({
        actorRole: params.actorRole,
        actorUserId: params.actorUserId,
        tenantId: item.tenantId,
      });
      if (!rerun.ok) {
        status = "failed";
        errorCount = 1;
        errorSummary = readSweepError(rerun);
      } else {
        affectedCount = rerun.summary.inserted;
        payload = {
          byType: rerun.summary.byType,
          reminders: rerun.summary.reminders,
        };
      }
    } else {
      status = "failed";
      errorCount = 1;
      errorSummary = "Unsupported rerun job type in execute path";
    }

    await completeJobRun({
      supabase,
      jobRunId: createdJobRunId,
      status,
      affectedCount,
      errorCount,
      errorSummary,
      payload,
    });

    return {
      ok: true as const,
      result: {
        executionJobRunId: createdJobRunId,
        sourceJobRunId: item.sourceJobRunId,
        tenantId: item.tenantId,
        jobType: item.jobType,
        status,
        affectedCount,
        errorCount,
        errorSummary,
        lock: {
          lockId: claim.item?.id || null,
          scopeKey: scope.scopeKey,
        },
      } as JobRerunExecuteResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (createdJobRunId) {
      await completeJobRun({
        supabase,
        jobRunId: createdJobRunId,
        status: "failed",
        affectedCount: 0,
        errorCount: 1,
        errorSummary: message,
        payload: { thrown: true },
      }).catch(() => null);
    }
    return {
      ok: false as const,
      code: "EXECUTE_FAILED" as const,
      error: message,
    };
  } finally {
    await releaseJobExecutionLock({
      supabase,
      lockId: claim.item?.id || null,
      reason: "rerun_execute_completed",
    }).catch(() => null);
  }
}
