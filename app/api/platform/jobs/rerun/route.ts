import { z } from "zod";
import { apiError, apiSuccess, requireProfile } from "../../../../../lib/auth-context";
import { buildJobRerunDryRunPlan, executeJobRerunPlan } from "../../../../../lib/job-rerun";
import { writeJobRerunAuditNonBlocking } from "../../../../../lib/job-rerun-audit";
import { issueJobRerunPreviewToken, verifyJobRerunPreviewToken } from "../../../../../lib/job-rerun-preview-token";
import { requirePermission } from "../../../../../lib/permissions";
import { uuidLikeSchema } from "../../../../../lib/notification-productization";

const rerunRequestSchema = z.object({
  action: z.enum(["dry_run", "execute"]),
  failedOnly: z.literal(true),
  target: z.object({
    type: z.literal("job_run"),
    id: uuidLikeSchema,
  }),
  previewToken: z.string().trim().min(10).max(3000).optional(),
  confirmPhrase: z.string().trim().max(120).optional(),
  confirmHighRisk: z.boolean().optional(),
  confirmReason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const auth = await requireProfile(["platform_admin"], request);
  if (!auth.ok) return auth.response;
  const context = auth.context;

  const permission = requirePermission(context, "audit.read");
  if (!permission.ok) return permission.response;

  const body = await request.json().catch(() => null);
  const parsed = rerunRequestSchema.safeParse(body || {});
  if (!parsed.success) {
    return apiError(400, "FORBIDDEN", parsed.error.issues[0]?.message || "Invalid rerun request payload");
  }

  const planResult = await buildJobRerunDryRunPlan({
    jobRunId: parsed.data.target.id,
    failedOnly: true,
  });
  if (!planResult.ok && planResult.code === "not_found") return apiError(404, "FORBIDDEN", planResult.error);
  if (!planResult.ok) {
    return apiError(500, "INTERNAL_ERROR", planResult.error instanceof Error ? planResult.error.message : String(planResult.error));
  }

  const plan = planResult.plan;
  const previewIssued = issueJobRerunPreviewToken({
    actorUserId: context.userId,
    plan,
    ttlSeconds: 600,
  });
  const executeEnabled = previewIssued.ok;
  const auditScope = plan.target.tenantId ? "tenant" : "platform";

  async function writeExecuteRejectedAudit(params: {
    code: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    await writeJobRerunAuditNonBlocking({
      actorUserId: context.userId,
      actorRole: context.role,
      scope: auditScope,
      tenantId: plan.target.tenantId,
      mode: "execute",
      targetType: "job_run",
      targetId: plan.target.jobRunId,
      summary: {
        failedOnly: true,
        executeStatus: "rejected_precheck",
        code: params.code,
      },
      metadata: {
        target: plan.target,
        requestedAction: "execute",
        message: params.message,
        ...(params.metadata || {}),
      },
      logContext: "platform/jobs/rerun:execute_precheck_rejected",
    });
  }

  if (parsed.data.action === "dry_run") {
    await writeJobRerunAuditNonBlocking({
      actorUserId: context.userId,
      actorRole: context.role,
      scope: auditScope,
      tenantId: plan.target.tenantId,
      mode: "dry_run",
      targetType: "job_run",
      targetId: plan.target.jobRunId,
      summary: {
        failedOnly: true,
        plannedCount: plan.planned.length,
        skippedCount: plan.skipped.length,
        lockConflictCount: plan.lockConflicts.length,
        dedupeSignalCount: plan.dedupeSignals.length,
        executeEnabled,
      },
      metadata: {
        target: plan.target,
        requestedAction: "dry_run",
        risks: plan.riskHints,
        warnings: plan.warnings,
        previewTokenIssued: previewIssued.ok,
        previewTokenIssueError: previewIssued.ok ? null : previewIssued.error,
      },
      logContext: "platform/jobs/rerun:dry_run",
    });

    return apiSuccess({
      mode: "dry_run" as const,
      ...plan,
      executeEnabled,
      previewToken: previewIssued.ok ? previewIssued.token : null,
      previewTokenExpiresAt: previewIssued.ok ? previewIssued.expiresAt : null,
      previewWarning: previewIssued.ok ? null : previewIssued.error,
    });
  }

  if (plan.target.jobType === "delivery_dispatch") {
    await writeExecuteRejectedAudit({
      code: "DELIVERY_DISPATCH_EXCLUDED",
      message: "delivery_dispatch is excluded from generic job_run execute; use item-level retry.",
    });
    return apiError(409, "FORBIDDEN", "delivery_dispatch is excluded from generic job_run execute; use item-level retry.");
  }
  const executePermission = requirePermission(context, "jobs.rerun.execute");
  if (!executePermission.ok) return executePermission.response;
  if (plan.planned.length === 0) {
    await writeExecuteRejectedAudit({
      code: "NO_PLANNED_ITEMS",
      message: "No planned rerun items from current dry-run result",
    });
    return apiError(409, "FORBIDDEN", "No planned rerun items from current dry-run result");
  }
  if (plan.lockConflicts.length > 0) {
    await writeExecuteRejectedAudit({
      code: "LOCK_CONFLICT_PRECHECK",
      message: "Active execution lock conflict detected; rerun execute rejected.",
      metadata: { lockConflicts: plan.lockConflicts },
    });
    return apiError(409, "FORBIDDEN", "Active execution lock conflict detected; rerun execute rejected.");
  }
  if ((parsed.data.confirmPhrase || "") !== "EXECUTE_RERUN") {
    await writeExecuteRejectedAudit({
      code: "CONFIRM_PHRASE_MISSING",
      message: "confirmPhrase must equal EXECUTE_RERUN",
    });
    return apiError(400, "FORBIDDEN", "confirmPhrase must equal EXECUTE_RERUN");
  }
  if (!parsed.data.previewToken) {
    await writeExecuteRejectedAudit({
      code: "PREVIEW_TOKEN_MISSING",
      message: "previewToken is required for execute",
    });
    return apiError(400, "FORBIDDEN", "previewToken is required for execute");
  }
  const previewVerified = verifyJobRerunPreviewToken({
    token: parsed.data.previewToken,
    actorUserId: context.userId,
    plan,
  });
  if (!previewVerified.ok) {
    await writeExecuteRejectedAudit({
      code: "PREVIEW_TOKEN_INVALID",
      message: `Invalid preview token: ${previewVerified.error}`,
    });
    return apiError(409, "FORBIDDEN", `Invalid preview token: ${previewVerified.error}`);
  }
  if (plan.dedupeSignals.length > 0) {
    const confirmReason = (parsed.data.confirmReason || "").trim();
    if (!parsed.data.confirmHighRisk || confirmReason.length < 8) {
      await writeExecuteRejectedAudit({
        code: "HIGH_RISK_CONFIRMATION_REQUIRED",
        message: "High-risk dedupe signals found. Set confirmHighRisk=true and provide confirmReason (>= 8 chars).",
        metadata: { dedupeSignals: plan.dedupeSignals },
      });
      return apiError(
        409,
        "FORBIDDEN",
        "High-risk dedupe signals found. Set confirmHighRisk=true and provide confirmReason (>= 8 chars).",
      );
    }
  }

  const executed = await executeJobRerunPlan({
    plan,
    actorUserId: context.userId,
    actorRole: context.role,
  });
  if (!executed.ok) {
    await writeJobRerunAuditNonBlocking({
      actorUserId: context.userId,
      actorRole: context.role,
      scope: auditScope,
      tenantId: plan.target.tenantId,
      mode: "execute",
      targetType: "job_run",
      targetId: plan.target.jobRunId,
      summary: {
        failedOnly: true,
        executeStatus: "rejected_or_failed",
        code: executed.code,
      },
      metadata: {
        target: plan.target,
        requestedAction: "execute",
        error: executed.error,
      },
      logContext: "platform/jobs/rerun:execute_failed",
    });
    return apiError(409, "FORBIDDEN", `${executed.code}: ${executed.error}`);
  }

  await writeJobRerunAuditNonBlocking({
    actorUserId: context.userId,
    actorRole: context.role,
    scope: auditScope,
    tenantId: plan.target.tenantId,
    mode: "execute",
    targetType: "job_run",
    targetId: plan.target.jobRunId,
    summary: {
      failedOnly: true,
      executeStatus: "executed",
      resultStatus: executed.result.status,
      executionJobRunId: executed.result.executionJobRunId,
    },
    metadata: {
      target: plan.target,
      requestedAction: "execute",
      result: executed.result,
      highRiskConfirmed: Boolean(parsed.data.confirmHighRisk),
      highRiskConfirmReason: parsed.data.confirmReason || null,
    },
    logContext: "platform/jobs/rerun:execute",
  });

  return apiSuccess({
    mode: "execute" as const,
    target: plan.target,
    failedOnly: true as const,
    result: executed.result,
    riskHints: plan.riskHints,
    guidance: plan.guidance,
  });
}
