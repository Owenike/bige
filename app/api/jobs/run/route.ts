import { apiError, apiSuccess, requireProfile, type AppRole } from "../../../../lib/auth-context";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { runNotificationSweep } from "../../../../lib/in-app-notifications";
import { runOpportunitySweep } from "../../../../lib/opportunities";
import { dispatchNotificationDeliveries } from "../../../../lib/notification-dispatch";
import { completeJobRun, createJobRun, type JobType } from "../../../../lib/notification-ops";

const DEFAULT_JOBS: JobType[] = ["notification_sweep", "opportunity_sweep", "delivery_dispatch"];
const JOBS_RUN_LOG_PREFIX = "[jobs/run]";

function getDebugModeEnabled() {
  return process.env.JOBS_RUN_DEBUG_VERBOSE === "1";
}

function toErrorSummary(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseJobTypes(input: unknown) {
  if (!Array.isArray(input)) return DEFAULT_JOBS;
  const parsed = input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is JobType => item === "notification_sweep" || item === "opportunity_sweep" || item === "delivery_dispatch");
  return parsed.length > 0 ? parsed : DEFAULT_JOBS;
}

function readCronSignal(request: Request) {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const xSecret = request.headers.get("x-cron-secret") || "";
  const vercelCron = request.headers.get("x-vercel-cron") || "";
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  const isVercelCronUserAgent = userAgent.includes("vercel-cron/");
  if (bearer) {
    return {
      value: bearer,
      source: "authorization_bearer" as const,
      hasVercelCronHeader: request.headers.has("x-vercel-cron"),
      isVercelCronUserAgent,
    };
  }
  if (xSecret) {
    return {
      value: xSecret,
      source: "x-cron-secret" as const,
      hasVercelCronHeader: request.headers.has("x-vercel-cron"),
      isVercelCronUserAgent,
    };
  }
  if (vercelCron) {
    return {
      value: vercelCron,
      source: "x-vercel-cron" as const,
      hasVercelCronHeader: request.headers.has("x-vercel-cron"),
      isVercelCronUserAgent,
    };
  }
  return {
    value: "",
    source: "none" as const,
    hasVercelCronHeader: request.headers.has("x-vercel-cron"),
    isVercelCronUserAgent,
  };
}

async function resolveCronActorId() {
  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("profiles")
    .select("id")
    .eq("role", "platform_admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data?.id) return null;
  return String(result.data.id);
}

async function runOneJob(params: {
  jobType: JobType;
  triggerMode: "scheduled" | "manual" | "api";
  tenantId: string | null;
  actorRole: AppRole;
  actorUserId: string | null;
  debug: boolean;
}) {
  console.info(`${JOBS_RUN_LOG_PREFIX}[job:start]`, {
    jobType: params.jobType,
    triggerMode: params.triggerMode,
    tenantId: params.tenantId,
    actorRole: params.actorRole,
  });

  const start = await createJobRun({
    jobType: params.jobType,
    triggerMode: params.triggerMode,
    tenantId: params.tenantId,
    initiatedBy: params.actorUserId,
    payload: {
      actorRole: params.actorRole,
      triggerMode: params.triggerMode,
      scopedTenantId: params.tenantId,
    },
  });

  if (start.ok) {
    console.info(`${JOBS_RUN_LOG_PREFIX}[job:created]`, {
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      jobRunId: start.jobRunId,
    });
  } else {
    console.error(`${JOBS_RUN_LOG_PREFIX}[job:error]`, {
      stage: "createJobRun",
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      error: start.error,
    });
  }

  let affectedCount = 0;
  let errorCount = 0;
  let status: "success" | "failed" | "partial" = "success";
  let errorSummary: string | null = null;
  let resultPayload: Record<string, unknown> = {};
  try {
    if (params.jobType === "notification_sweep") {
      const result = await runNotificationSweep({
        actorRole: params.actorRole,
        actorUserId: params.actorUserId,
        tenantId: params.tenantId,
      });
      if (!result.ok) {
        status = "failed";
        errorCount = 1;
        errorSummary = result.error;
      } else {
        affectedCount = result.summary.generated;
        resultPayload = { byEventType: result.summary.byEventType };
      }
    } else if (params.jobType === "opportunity_sweep") {
      const result = await runOpportunitySweep({
        actorRole: params.actorRole,
        actorUserId: params.actorUserId,
        tenantId: params.tenantId,
      });
      if (!result.ok) {
        status = "failed";
        errorCount = 1;
        errorSummary = result.error;
      } else {
        affectedCount = result.summary.inserted;
        resultPayload = {
          byType: result.summary.byType,
          reminders: result.summary.reminders,
        };
      }
    } else if (params.jobType === "delivery_dispatch") {
      const result = await dispatchNotificationDeliveries({
        tenantId: params.tenantId,
        mode: "job",
        includeFailed: true,
        limit: 500,
      });
      if (!result.ok) {
        status = "failed";
        errorCount = 1;
        errorSummary = result.error;
      } else {
        affectedCount = result.summary.processed;
        resultPayload = {
          sent: result.summary.sent,
          skipped: result.summary.skipped,
          failed: result.summary.failed,
          retrying: result.summary.retrying,
        };
        if (result.summary.failed > 0 && result.summary.sent > 0) status = "partial";
        if (result.summary.failed > 0 && result.summary.sent === 0) status = "failed";
        errorCount = result.summary.failed;
        if (result.summary.failed > 0) errorSummary = `${result.summary.failed} delivery dispatch(es) failed`;
      }
    }
  } catch (error) {
    status = "failed";
    errorCount = Math.max(1, errorCount);
    errorSummary = toErrorSummary(error);
    resultPayload = params.debug
      ? { thrown: true, error: errorSummary }
      : { thrown: true };
    console.error(`${JOBS_RUN_LOG_PREFIX}[job:error]`, {
      stage: "execute",
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      error: errorSummary,
    });
  }

  const complete = await completeJobRun({
    jobRunId: start.jobRunId,
    status,
    affectedCount,
    errorCount,
    errorSummary,
    payload: resultPayload,
  });
  if (!complete.ok) {
    console.error(`${JOBS_RUN_LOG_PREFIX}[job:error]`, {
      stage: "completeJobRun",
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      jobRunId: start.jobRunId,
      error: complete.error,
    });
  }

  if (status === "failed") {
    console.error(`${JOBS_RUN_LOG_PREFIX}[job:error]`, {
      stage: "result",
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      status,
      errorSummary,
      affectedCount,
      errorCount,
    });
  } else {
    console.info(`${JOBS_RUN_LOG_PREFIX}[job:done]`, {
      jobType: params.jobType,
      triggerMode: params.triggerMode,
      tenantId: params.tenantId,
      status,
      affectedCount,
      errorCount,
    });
  }

  return {
    jobType: params.jobType,
    status,
    affectedCount,
    errorCount,
    errorSummary,
    details: resultPayload,
  };
}

async function handleRunJobs(request: Request) {
  const debug = getDebugModeEnabled();
  const requestUrl = new URL(request.url);
  const requestId = request.headers.get("x-request-id");
  const hostHeader = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").toLowerCase();
  const normalizedHost = hostHeader.split(":")[0] || "";
  const vercelUrl = (process.env.VERCEL_URL || "").toLowerCase();
  const hasVercelHostContext = normalizedHost.endsWith(".vercel.app") || (vercelUrl.length > 0 && normalizedHost === vercelUrl);
  const hasVercelRequestId = Boolean(request.headers.get("x-vercel-id"));
  const hasVercelRuntimeContext = hasVercelHostContext && hasVercelRequestId;
  console.info(`${JOBS_RUN_LOG_PREFIX}[entry]`, {
    method: request.method,
    pathname: requestUrl.pathname,
    requestId,
    userAgent: request.headers.get("user-agent"),
    host: request.headers.get("host"),
    xForwardedHost: request.headers.get("x-forwarded-host"),
    xForwardedProto: request.headers.get("x-forwarded-proto"),
    xVercelId: request.headers.get("x-vercel-id"),
    hasXVercelCron: request.headers.has("x-vercel-cron"),
    hasAuthorization: request.headers.has("authorization") || request.headers.has("Authorization"),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    hasVercelRuntimeContext,
  });

  const jobsCronSecret = (process.env.JOBS_CRON_SECRET || "").trim();
  const vercelCronSecret = (process.env.CRON_SECRET || "").trim();
  const configuredCronSecrets = [vercelCronSecret, jobsCronSecret].filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
  const hasCronSecretConfigured = configuredCronSecrets.length > 0;
  const hasVercelManagedCronSecret = vercelCronSecret.length > 0;
  const cronSignal = readCronSignal(request);
  const incomingSecret = cronSignal.value;
  const incomingSecretMatchesConfiguredSecret =
    incomingSecret.length > 0 && configuredCronSecrets.some((secret) => secret === incomingSecret);
  const matchedCronSecretSource =
    incomingSecret.length > 0 && incomingSecret === vercelCronSecret
      ? "CRON_SECRET"
      : incomingSecret.length > 0 && incomingSecret === jobsCronSecret
        ? "JOBS_CRON_SECRET"
        : "none";
  const configuredCronSecretMode =
    vercelCronSecret.length > 0 && jobsCronSecret.length > 0
      ? "dual"
      : vercelCronSecret.length > 0
        ? "vercel"
        : jobsCronSecret.length > 0
          ? "jobs"
          : "none";
  const isVercelCron = cronSignal.hasVercelCronHeader;
  const isVercelCronUserAgent = cronSignal.isVercelCronUserAgent;
  const isCronLikeRequest = isVercelCron || isVercelCronUserAgent;
  let scheduledReason = "none";
  const isScheduled =
    (() => {
      if (incomingSecretMatchesConfiguredSecret) {
        scheduledReason = matchedCronSecretSource === "CRON_SECRET" ? "cron_secret_match" : "jobs_cron_secret_match";
        return true;
      }
      if (isVercelCron && !hasCronSecretConfigured) {
        scheduledReason = "x-vercel-cron_without_secret";
        return true;
      }
      if (!hasVercelManagedCronSecret && isVercelCron && isVercelCronUserAgent && hasVercelRuntimeContext) {
        scheduledReason = "x-vercel-cron_ua_runtime_fallback";
        return true;
      }
      if (isVercelCron && hasCronSecretConfigured && incomingSecret.length === 0) {
        scheduledReason = "x-vercel-cron_missing_secret_with_cron_secret_env";
      } else if (isVercelCron && hasCronSecretConfigured && incomingSecret.length > 0 && !incomingSecretMatchesConfiguredSecret) {
        scheduledReason = "x-vercel-cron_secret_mismatch";
      } else if (isVercelCron && !isVercelCronUserAgent) {
        scheduledReason = "x-vercel-cron_missing_cron_user_agent";
      } else if (isVercelCron && isVercelCronUserAgent && !hasVercelRuntimeContext) {
        scheduledReason = "x-vercel-cron_ua_missing_runtime_context";
      }
      if (!isVercelCron && isVercelCronUserAgent && !hasCronSecretConfigured) {
        scheduledReason = "cron_ua_without_secret_missing_x_vercel_cron";
      } else if (isVercelCronUserAgent && hasCronSecretConfigured && incomingSecret.length === 0) {
        scheduledReason = "cron_ua_missing_secret_header";
      } else if (
        isVercelCronUserAgent &&
        hasCronSecretConfigured &&
        incomingSecret.length > 0 &&
        !incomingSecretMatchesConfiguredSecret
      ) {
        scheduledReason = "cron_ua_secret_mismatch";
      }
      return false;
    })();

  console.info(`${JOBS_RUN_LOG_PREFIX}${isScheduled ? "[scheduled]" : "[api]"}`, {
    method: request.method,
    requestId,
    isScheduled,
    scheduledReason,
    hasCronSecret: hasCronSecretConfigured,
    configuredCronSecretMode,
    hasIncomingSecret: incomingSecret.length > 0,
    incomingSecretLength: incomingSecret.length,
    incomingSecretSource: cronSignal.source,
    matchedCronSecretSource,
    hasVercelCronHeader: isVercelCron,
    isVercelCronUserAgent,
    hasVercelManagedCronSecret,
    hasVercelRuntimeContext,
  });

  let actorRole: AppRole;
  let actorUserId: string | null = null;
  let scopedTenantId: string | null = null;
  let triggerMode: "scheduled" | "manual" | "api" = isScheduled ? "scheduled" : "api";

  if (isScheduled) {
    actorRole = "platform_admin";
    actorUserId = await resolveCronActorId();
    if (debug) {
      console.info(`${JOBS_RUN_LOG_PREFIX}[scheduled] actor-resolved`, {
        actorUserId,
      });
    }
  } else {
    if (hasVercelManagedCronSecret && isCronLikeRequest) {
      console.warn(`${JOBS_RUN_LOG_PREFIX}[auth-denied]`, {
        requestId,
        mode: "cron",
        scheduledReason,
        hasVercelCronHeader: isVercelCron,
        isVercelCronUserAgent,
        hasCronSecret: hasCronSecretConfigured,
        configuredCronSecretMode,
        hasVercelManagedCronSecret,
        hasIncomingSecret: incomingSecret.length > 0,
        incomingSecretSource: cronSignal.source,
        hasVercelRuntimeContext,
        userAgent: request.headers.get("user-agent"),
        xVercelId: request.headers.get("x-vercel-id"),
      });
      return apiError(401, "UNAUTHORIZED", "Invalid or missing cron secret");
    }

    const auth = await requireProfile(["platform_admin", "manager"], request);
    if (!auth.ok) {
      console.warn(`${JOBS_RUN_LOG_PREFIX}[auth-denied]`, {
        requestId,
        mode: "api",
        scheduledReason,
        hasVercelCronHeader: isVercelCron,
        isVercelCronUserAgent,
        hasCronSecret: hasCronSecretConfigured,
        configuredCronSecretMode,
        hasVercelManagedCronSecret,
        hasIncomingSecret: incomingSecret.length > 0,
        incomingSecretSource: cronSignal.source,
        hasVercelRuntimeContext,
        userAgent: request.headers.get("user-agent"),
        xVercelId: request.headers.get("x-vercel-id"),
      });
      return auth.response;
    }
    actorRole = auth.context.role;
    actorUserId = auth.context.userId;
    const body = await request.json().catch(() => null);
    const tenantFromBody = typeof body?.tenantId === "string" ? body.tenantId.trim() : null;
    if (actorRole === "platform_admin") {
      scopedTenantId = tenantFromBody || null;
    } else {
      scopedTenantId = auth.context.tenantId || null;
      triggerMode = "manual";
    }

    const jobs = parseJobTypes(body?.jobs);
    console.info(`${JOBS_RUN_LOG_PREFIX}[api] dispatch`, {
      actorRole,
      triggerMode,
      scopedTenantId,
      jobs,
    });
    const results = [];
    for (const job of jobs) {
      const result = await runOneJob({
        jobType: job,
        triggerMode,
        tenantId: scopedTenantId,
        actorRole,
        actorUserId,
        debug,
      });
      results.push(result);
    }
    console.info(`${JOBS_RUN_LOG_PREFIX} response`, {
      mode: "manual",
      actorRole,
      scopedTenantId,
      totalJobs: results.length,
      failedJobs: results.filter((item) => item.status === "failed").length,
    });
    return apiSuccess({
      mode: "manual",
      actorRole,
      scopedTenantId,
      results,
    });
  }

  const params = new URL(request.url).searchParams;
  scopedTenantId = params.get("tenantId");
  const jobsParam = params.get("jobs");
  const jobs = jobsParam
    ? parseJobTypes(jobsParam.split(",").map((item) => item.trim()))
    : DEFAULT_JOBS;

  console.info(`${JOBS_RUN_LOG_PREFIX}[scheduled] dispatch`, {
    actorRole,
    triggerMode,
    scopedTenantId,
    jobs,
  });

  const results = [];
  for (const job of jobs) {
    const result = await runOneJob({
      jobType: job,
      triggerMode,
      tenantId: scopedTenantId,
      actorRole,
      actorUserId,
      debug,
    });
    results.push(result);
  }

  const failed = results.filter((item) => item.status === "failed").length;
  if (failed === results.length && results.length > 0) {
    console.error(`${JOBS_RUN_LOG_PREFIX} response`, {
      mode: "scheduled",
      actorRole,
      scopedTenantId,
      totalJobs: results.length,
      failedJobs: failed,
      status: "all_failed",
    });
    return apiError(500, "INTERNAL_ERROR", "All scheduled jobs failed");
  }

  console.info(`${JOBS_RUN_LOG_PREFIX} response`, {
    mode: "scheduled",
    actorRole,
    scopedTenantId,
    totalJobs: results.length,
    failedJobs: failed,
  });
  return apiSuccess({
    mode: "scheduled",
    actorRole,
    scopedTenantId,
    results,
  });
}

export async function POST(request: Request) {
  return handleRunJobs(request);
}

export async function GET(request: Request) {
  return handleRunJobs(request);
}
