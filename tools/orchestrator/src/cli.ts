import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  approvePendingPatch,
  approvePendingPlan,
  cleanupStateWorkspaces,
  createDefaultDependencies,
  createInitialState,
  planOrchestratorIteration,
  prepareHandoff,
  promoteApprovedPatch,
  pruneStateArtifacts,
  rejectPendingPatch,
  rejectPendingPlan,
  runLiveAcceptance,
  runLivePass,
  runLiveSmoke,
  runOrchestratorLoop,
  runOrchestratorOnce,
} from "./orchestrator";
import {
  orchestratorStateSchema,
  type BackendType,
  type ExecutionMode,
  type ExecutorFallbackMode,
  type ExecutorProviderKind,
  type PlannerProviderKind,
} from "./schemas";
import { FileSystemWorkspaceManager } from "./workspace";
import { runOrchestratorPreflight, formatPreflightSummary } from "./preflight";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "./diagnostics";
import { applyQueueItemToState, enqueueStateRun, formatQueueSummary, listQueueRuns, requeueRun, requestCancelRun, requestPauseRun } from "./queue";
import { getWorkerStatus, runQueueWorker } from "./worker";
import { runSupabaseBackendLiveSmoke } from "./supabase-live";
import { exportBackendSnapshot, importBackendSnapshot } from "./transfer";
import { inspectBackendHealth, repairBackendHealth } from "./health";
import { ingestGitHubEvent } from "./github-events";
import {
  GhCliStatusReportingAdapter,
  applyStatusReportToState,
  inspectGitHubReportingOperatorSummary,
  reportStateStatus,
  runGitHubLiveCommentSmoke,
  runGitHubReportPermissionSmoke,
} from "./status-reporting";
import { formatReportDeliveryAttempts } from "./reporting-audit";
import { runGitHubLiveAuthSmoke } from "./github-live-auth";
import { selectGitHubLiveSmokeTarget } from "./github-live-targets";
import { describeGitHubSandboxTargetRegistry, loadGitHubSandboxTargetRegistry, resolveGitHubSandboxTarget } from "./github-sandbox-targets";
import { formatSandboxProfileList, formatSandboxProfileValidation, showSandboxProfile, validateSandboxProfile } from "./sandbox-profile-ops";
import { createSandboxProfile, deleteSandboxProfile, setDefaultSandboxProfile, updateSandboxProfile } from "./sandbox-profile-lifecycle";
import { runLiveAuthOperatorFlow } from "./live-auth-operator";
import { formatSandboxAuditTrail, listSandboxAuditRecords } from "./sandbox-audit";
import { evaluateSandboxGuardrails, evaluateSandboxProfileGovernance, formatSandboxGuardrailsSummary, formatSandboxGovernanceSummary, inspectSandboxGovernance } from "./sandbox-governance";
import { evaluateSandboxBundleGovernance, formatSandboxBundleGovernanceSummary, inspectSandboxBundleGovernance } from "./sandbox-bundle-governance";
import { applySandboxPolicyBundle, formatSandboxPolicyBundle, formatSandboxPolicyBundleList, showSandboxPolicyBundle } from "./sandbox-policy-bundles";
import { exportSandboxProfiles, importSandboxProfiles } from "./sandbox-import-export";
import { applySandboxRegistryChange, buildSandboxRegistryDiff, reviewSandboxRegistryChange } from "./sandbox-change-review";
import { runSandboxBatchChange } from "./sandbox-batch-change";
import { formatSandboxImpactSummary } from "./sandbox-impact-summary";
import { listSandboxRestorePoints } from "./sandbox-restore-points";
import { runSandboxRollback } from "./sandbox-rollback";
import { ingestGitHubWebhook } from "./webhook";
import { formatWebhookHostingConfig, loadWebhookHostingConfig } from "./runtime-config";
import { formatWebhookShutdownSummary, startWebhookHosting } from "./webhook-hosting";
import { resolveActorAuthorization } from "./actor-policy";
import { describeActorPolicyConfig, loadActorPolicyConfig } from "./actor-policy-config";
import { formatInboundAuditSummary, listInboundAuditRecords } from "./inbound-audit";
import { evaluateWebhookRuntime, formatWebhookRuntimeSummary } from "./webhook-runtime";

async function resolveRunId(params: {
  stateId: string;
  dependencies: ReturnType<typeof createDefaultDependencies>;
  explicitRunId?: string;
}) {
  if (params.explicitRunId) {
    return params.explicitRunId;
  }
  const queue = await listQueueRuns(params.dependencies.backend);
  const match = queue.find((item) => item.stateId === params.stateId && ["queued", "running", "paused", "blocked", "failed"].includes(item.status));
  if (!match) {
    throw new Error(`No queue run found for state ${params.stateId}.`);
  }
  return match.id;
}

function formatRunSummary(run: {
  id: string;
  status: string;
  stateId: string;
  workerId: string | null;
  attemptCount: number;
  reason: string | null;
}) {
  return [
    `Run: ${run.id}`,
    `State: ${run.stateId}`,
    `Status: ${run.status}`,
    `Worker: ${run.workerId ?? "none"}`,
    `Attempts: ${run.attemptCount}`,
    `Reason: ${run.reason ?? "none"}`,
  ].join("\n");
}

function formatWorkerSummary(summary: {
  workerId: string;
  polls: number;
  processed: number;
  recovered: number;
  finalStatuses: string[];
  queueSize: number;
  backendType: string;
  daemon: boolean;
  workerStatus: string;
  supervisionStatus: string;
  lastError: string | null;
  heartbeatStatus: string | null;
}) {
  return [
    `Worker: ${summary.workerId}`,
    `Backend: ${summary.backendType}`,
    `Daemon mode: ${summary.daemon}`,
    `Worker status: ${summary.workerStatus}`,
    `Supervision: ${summary.supervisionStatus}`,
    `Polls: ${summary.polls}`,
    `Processed: ${summary.processed}`,
    `Recovered stale runs: ${summary.recovered}`,
    `Final statuses: ${summary.finalStatuses.join(", ") || "none"}`,
    `Queue size: ${summary.queueSize}`,
    `Heartbeat: ${summary.heartbeatStatus ?? "none"}`,
    `Last error: ${summary.lastError ?? "none"}`,
  ].join("\n");
}

function formatBackendStatus(summary: {
  backendType: string;
  status: string;
  inspection: {
    queueDepth: number;
    runningCount: number;
    queuedCount: number;
    pausedCount: number;
    blockedCount: number;
    staleLeaseCount: number;
    workerCount: number;
    activeWorkers: string[];
  };
  details: string[];
  migrationPath: string | null;
}) {
  return [
    `Backend: ${summary.backendType}`,
    `Status: ${summary.status}`,
    `Queue depth: ${summary.inspection.queueDepth}`,
    `Running: ${summary.inspection.runningCount}`,
    `Queued: ${summary.inspection.queuedCount}`,
    `Paused: ${summary.inspection.pausedCount}`,
    `Blocked: ${summary.inspection.blockedCount}`,
    `Stale leases: ${summary.inspection.staleLeaseCount}`,
    `Workers: ${summary.inspection.workerCount}`,
    `Active workers: ${summary.inspection.activeWorkers.join(", ") || "none"}`,
    `Details: ${summary.details.join(" | ") || "none"}`,
    `Migration path: ${summary.migrationPath ?? "none"}`,
  ].join("\n");
}

function formatBackendHealth(summary: {
  backendType: string;
  status: string;
  queueDepth: number;
  activeLeaseCount: number;
  staleLeaseCount: number;
  orphanRunCount: number;
  pendingApprovalCount: number;
  pendingPromotionCount: number;
  recoverableAnomalyCount: number;
  summary: string;
}) {
  return [
    `Backend: ${summary.backendType}`,
    `Health: ${summary.status}`,
    `Queue depth: ${summary.queueDepth}`,
    `Active leases: ${summary.activeLeaseCount}`,
    `Stale leases: ${summary.staleLeaseCount}`,
    `Orphan runs: ${summary.orphanRunCount}`,
    `Pending approval: ${summary.pendingApprovalCount}`,
    `Pending promotion: ${summary.pendingPromotionCount}`,
    `Recoverable anomalies: ${summary.recoverableAnomalyCount}`,
    `Summary: ${summary.summary}`,
  ].join("\n");
}

function formatTransferSummary(summary: {
  status: string;
  sourceBackend: string;
  targetBackend: string;
  exportedStateCount: number;
  importedStateCount: number;
  queueItemCount: number;
  workerCount: number;
  snapshotPath: string | null;
  notes: string[];
  conflicts: string[];
}) {
  return [
    `Transfer status: ${summary.status}`,
    `Source backend: ${summary.sourceBackend}`,
    `Target backend: ${summary.targetBackend}`,
    `Exported states: ${summary.exportedStateCount}`,
    `Imported states: ${summary.importedStateCount}`,
    `Queue items: ${summary.queueItemCount}`,
    `Workers: ${summary.workerCount}`,
    `Snapshot path: ${summary.snapshotPath ?? "none"}`,
    `Notes: ${summary.notes.join(" | ") || "none"}`,
    `Conflicts: ${summary.conflicts.join(" | ") || "none"}`,
  ].join("\n");
}

function formatRepairSummary(summary: {
  status: string;
  staleRequeuedCount: number;
  orphanBlockedCount: number;
  manualRequiredReasons: string[];
  summary: string;
}) {
  return [
    `Repair status: ${summary.status}`,
    `Stale requeued: ${summary.staleRequeuedCount}`,
    `Orphan blocked: ${summary.orphanBlockedCount}`,
    `Manual required: ${summary.manualRequiredReasons.join(" | ") || "none"}`,
    `Summary: ${summary.summary}`,
  ].join("\n");
}

function formatSandboxLifecycleSummary(summary: {
  action: string;
  status: string;
  profileId: string | null;
  defaultProfileId: string | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  path: string | null;
  auditId: string | null;
  governanceStatus: string;
  governanceReason: string | null;
}) {
  return [
    `Sandbox action: ${summary.action}`,
    `Status: ${summary.status}`,
    `Profile: ${summary.profileId ?? "none"}`,
    `Default profile: ${summary.defaultProfileId ?? "none"}`,
    `Config path: ${summary.path ?? "none"}`,
    `Audit: ${summary.auditId ?? "none"}`,
    `Governance: ${summary.governanceStatus} / ${summary.governanceReason ?? "none"}`,
    `Summary: ${summary.summary}`,
    `Failure: ${summary.failureReason ?? "none"}`,
    `Next action: ${summary.suggestedNextAction}`,
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const [command = "help", ...rest] = argv;
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key.startsWith("--")) continue;
    options.set(key.slice(2), value ?? "true");
  }
  return {
    command,
    options,
  };
}

function normalizeCliValue(value: string) {
  return value.replace(/\^/g, "").trim();
}

function getOption(options: Map<string, string>, key: string, fallback: string) {
  return normalizeCliValue(options.get(key) ?? fallback);
}

async function loadSandboxRegistryFromOptions(options: Map<string, string>) {
  return loadGitHubSandboxTargetRegistry({
    configPath: options.get("sandbox-config") ?? null,
  });
}

function summarizeSandboxImportExport(result: {
  status: string;
  mode: string;
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  outputPath: string | null;
  restorePointId?: string | null;
  restorePointSummary?: string | null;
}) {
  return [
    `Sandbox import/export: ${result.status} / ${result.mode}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Restore point: ${result.restorePointId ?? "none"} / ${result.restorePointSummary ?? "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Output: ${result.outputPath ?? "none"}`,
  ].join("\n");
}

function summarizeSandboxReview(result: {
  status: string;
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  governanceStatus: string;
  guardrailsStatus: string;
  auditId: string | null;
}) {
  return [
    `Sandbox review: ${result.status}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Governance: ${result.governanceStatus}`,
    `Guardrails: ${result.guardrailsStatus}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Audit: ${result.auditId ?? "none"}`,
  ].join("\n");
}

function summarizeSandboxBatchChange(result: {
  status: string;
  mode: string;
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  impactSummary: {
    summaryText: string;
  };
  restorePointId?: string | null;
  restorePointSummary?: string | null;
}) {
  return [
    `Sandbox batch change: ${result.status} / ${result.mode}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Blocked profiles: ${result.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${result.manualRequiredProfileIds.join(", ") || "none"}`,
    `Impact: ${result.impactSummary.summaryText}`,
    `Restore point: ${result.restorePointId ?? "none"} / ${result.restorePointSummary ?? "none"}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}

function summarizeSandboxRestorePoints(result: {
  restorePointsPath: string;
  records: Array<{
    id: string;
    createdAt: string;
    source: string;
    affectedProfileIds: string[];
    previousDefaultProfileId: string | null;
    reason: string;
  }>;
}) {
  return [
    `Sandbox restore points path: ${result.restorePointsPath}`,
    `Restore points: ${result.records.length}`,
    ...result.records.map(
      (record) =>
        `- ${record.createdAt} ${record.source} profiles=${record.affectedProfileIds.join(",") || "none"} default=${record.previousDefaultProfileId ?? "none"} reason=${record.reason}`,
    ),
  ].join("\n");
}

function summarizeSandboxRollback(result: {
  status: string;
  mode: string;
  restorePointId: string | null;
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  impactSummary: {
    summaryText: string;
  };
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  auditId: string | null;
}) {
  return [
    `Sandbox rollback: ${result.status} / ${result.mode}`,
    `Restore point: ${result.restorePointId ?? "none"}`,
    `Affected profiles: ${result.affectedProfileIds.join(", ") || "none"}`,
    `Blocked profiles: ${result.blockedProfileIds.join(", ") || "none"}`,
    `Manual required profiles: ${result.manualRequiredProfileIds.join(", ") || "none"}`,
    `Impact: ${result.impactSummary.summaryText}`,
    `Diff: ${result.diffSummary.join(" | ") || "none"}`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
    `Audit: ${result.auditId ?? "none"}`,
  ].join("\n");
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const repoPath = getOption(options, "repo", process.cwd());
  const stateId = getOption(options, "state-id", "default");
  const storageRoot = getOption(options, "storage-root", path.join(repoPath, ".tmp", "orchestrator-state"));
  const executorMode = getOption(options, "executor", "mock") as ExecutorProviderKind;
  const executionMode = getOption(options, "execution-mode", executorMode === "mock" ? "mock" : "dry_run") as ExecutionMode;
  const executorFallbackMode = getOption(options, "executor-fallback", "blocked") as ExecutorFallbackMode;
  const backendType = getOption(options, "backend-type", "file") as BackendType;
  const backendFallbackType = getOption(options, "backend-fallback", "blocked") as BackendType | "blocked";
  const workspaceRoot = getOption(options, "workspace-root", path.join(repoPath, ".tmp", "orchestrator-workspaces"));
  const liveSmokeEnabled = getOption(options, "live-smoke", "false") === "true";
  const applyWorkspace = getOption(options, "apply-workspace", "false") === "true";
  const createBranch = getOption(options, "create-branch", "true") === "true";
  const publishBranch = getOption(options, "publish-branch", "false") === "true";
  const githubHandoffEnabled = getOption(options, "github-handoff", "false") === "true";
  let dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    backendType,
    backendFallbackType,
    executorMode,
    workspaceRoot,
  });

  if (command === "init") {
    const state = createInitialState({
      id: stateId,
      repoPath,
      repoName: path.basename(repoPath),
      userGoal: getOption(options, "goal", "Establish orchestrator MVP"),
      objective: getOption(options, "objective", "Build orchestrator MVP loop"),
      subtasks: getOption(options, "subtasks", "schemas,policies,planner,reviewer,storage,executor,cli")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      allowedFiles: getOption(options, "allowed-files", "tools/orchestrator,docs/orchestrator-runbook.md,package.json,.github/workflows")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      forbiddenFiles: getOption(
        options,
        "forbidden-files",
        "app/api/platform/notifications,/api/jobs/run,components/notification-overview-dashboard.tsx,components/notification-overview-tenant-drilldown.tsx",
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      successCriteria: getOption(
        options,
        "success-criteria",
        "MVP loop runs,schemas validate,planner and reviewer produce outputs,mock executor works,local executor smoke test works",
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      profileId: options.get("profile") ?? "default",
      profileName: options.get("profile-name") ?? null,
      repoType: options.get("repo-type") ?? null,
      autoMode: getOption(options, "auto-mode", "false") === "true",
      approvalMode: getOption(options, "approval-mode", "human_approval") as "auto" | "human_approval",
      executorMode,
      executionMode,
      executorFallbackMode,
      workspaceRoot,
      commandAllowList: getOption(options, "command-allow-list", "node,npm,git")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      executorCommand: getOption(options, "local-command", "node,-e,console.log('local-executor-ok')")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      plannerProvider: getOption(options, "planner-provider", "rule_based") as PlannerProviderKind,
      reviewerProvider: getOption(options, "reviewer-provider", "rule_based") as PlannerProviderKind,
      promotionConfig: {
        branchNameTemplate: getOption(options, "promotion-branch-template", "orchestrator/{taskId}/iter-{iteration}"),
        baseBranch: getOption(options, "promotion-base-branch", "main"),
        allowPublish: getOption(options, "promotion-allow-publish", "false") === "true",
        approvalRequired: getOption(options, "promotion-approval-required", "true") === "true",
        allowApplyWorkspace: getOption(options, "promotion-allow-apply-workspace", "false") === "true",
        requirePatchExport: getOption(options, "promotion-require-patch-export", "true") === "true",
      },
      retentionConfig: {
        recentSuccessKeep: Number.parseInt(getOption(options, "retention-success-keep", "3"), 10),
        recentFailureKeep: Number.parseInt(getOption(options, "retention-failure-keep", "5"), 10),
        staleWorkspaceTtlMinutes: Number.parseInt(getOption(options, "retention-stale-workspace-ttl", "120"), 10),
        orphanArtifactTtlMinutes: Number.parseInt(getOption(options, "retention-orphan-artifact-ttl", "240"), 10),
        preserveApprovalPending: getOption(options, "retention-preserve-approval-pending", "true") === "true",
      },
      handoffConfig: {
        githubHandoffEnabled: getOption(options, "handoff-github-enabled", "false") === "true",
        publishBranch: getOption(options, "handoff-publish-branch", "false") === "true",
        createBranch: getOption(options, "handoff-create-branch", "true") === "true",
      },
      backendType,
    });
    await dependencies.storage.saveState(state);
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }

  if (command === "event:intake") {
    const payloadPath = options.get("payload");
    if (!payloadPath) {
      throw new Error("--payload is required for event:intake.");
    }
    const payload = JSON.parse(await readFile(path.resolve(payloadPath), "utf8")) as unknown;
    const intake = await ingestGitHubEvent({
      payload,
      dependencies,
      repoPath,
      replayOverride: getOption(options, "replay", "false") === "true",
      enqueue: getOption(options, "enqueue", "true") === "true",
    });
    let updatedState = intake.state;
    let statusReport = null;
    if (getOption(options, "report-status", "true") === "true") {
      statusReport = await reportStateStatus({
        state: intake.state,
        outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
        adapter: new GhCliStatusReportingAdapter({
          enabled: getOption(options, "enabled", "true") === "true",
          token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
        }),
      });
      updatedState = applyStatusReportToState(intake.state, statusReport);
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(`${JSON.stringify({ ...intake, state: updatedState, statusReport }, null, 2)}\n`);
    return;
  }

  if (command === "webhook:intake") {
    const payloadPath = options.get("payload");
    const headersPath = options.get("headers");
    if (!payloadPath || !headersPath) {
      throw new Error("--payload and --headers are required for webhook:intake.");
    }
    const rawBody = await readFile(path.resolve(payloadPath), "utf8");
    const headers = JSON.parse(await readFile(path.resolve(headersPath), "utf8")) as Record<string, string | undefined>;
    const result = await ingestGitHubWebhook({
      rawBody,
      headers,
      secret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
      dependencies,
      repoPath,
      enqueue: getOption(options, "enqueue", "true") === "true",
      replayOverride: getOption(options, "replay", "false") === "true",
      reportStatus: getOption(options, "report-status", "true") === "true",
      statusAdapter: new GhCliStatusReportingAdapter({
        enabled: getOption(options, "enabled", "true") === "true",
        token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      }),
      statusOutputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      auditOutputRoot: getOption(options, "audit-output-root", path.join(repoPath, ".tmp", "orchestrator-inbound")),
      actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "webhook:runtime") {
    const hostingConfig = loadWebhookHostingConfig({
      repoPath,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      options: {
        host: options.get("host"),
        port: options.get("port"),
        basePath: options.get("base-path"),
        webhookPath: options.get("webhook-path"),
        webhookSecret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
        actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: getOption(options, "enabled", "true") === "true",
      },
    });
    const summary = await evaluateWebhookRuntime({
      dependencies,
      webhookSecret: hostingConfig.webhookSecret,
      actorPolicyConfigPath: hostingConfig.actorPolicyConfigPath,
      liveReportingEnabled: hostingConfig.liveReportingEnabled,
      host: hostingConfig.host,
      port: hostingConfig.port,
      basePath: hostingConfig.basePath,
      webhookPath: hostingConfig.webhookPath,
    });
    process.stdout.write(
      `${formatWebhookHostingConfig(hostingConfig)}\n${formatWebhookRuntimeSummary(summary)}\n\n${JSON.stringify(summary, null, 2)}\n`,
    );
    return;
  }

  if (command === "webhook:serve") {
    const handle = await startWebhookHosting({
      repoPath,
      dependencies,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report")),
      options: {
        host: options.get("host"),
        port: options.get("port"),
        basePath: options.get("base-path"),
        webhookPath: options.get("webhook-path"),
        webhookSecret: options.get("webhook-secret") ?? process.env.GITHUB_WEBHOOK_SECRET ?? null,
        actorPolicyConfigPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
        liveReportingEnabled: getOption(options, "enabled", "true") === "true",
        enqueue: getOption(options, "enqueue", "true") === "true",
        replayOverride: getOption(options, "replay", "false") === "true",
        reportStatus: getOption(options, "report-status", "true") === "true",
      },
    });
    process.stdout.write(`${handle.startupText}\n\n`);
    await new Promise<void>((resolve) => {
      process.once("SIGINT", async () => {
        const summary = await handle.shutdown("sigint");
        process.stdout.write(`${formatWebhookShutdownSummary(summary)}\n`);
        resolve();
      });
      process.once("SIGTERM", async () => {
        const summary = await handle.shutdown("sigterm");
        process.stdout.write(`${formatWebhookShutdownSummary(summary)}\n`);
        resolve();
      });
    });
    return;
  }

  if (command === "actor-policy:check") {
    const actor = options.get("actor") ?? "";
    const actorPolicy = await loadActorPolicyConfig({
      configPath: options.get("actor-policy-config") ?? process.env.ORCHESTRATOR_ACTOR_POLICY_CONFIG ?? null,
    });
    const commandName = options.get("command");
    const decision = resolveActorAuthorization({
      actor: actor ? { login: actor, id: null, type: "User" } : null,
      command: commandName
        ? (commandName as "run" | "dry_run" | "status" | "retry" | "approve" | "reject")
        : null,
      executionMode: options.has("execution-mode")
        ? (getOption(options, "execution-mode", "dry_run") as ExecutionMode)
        : null,
      approvalRequired: getOption(options, "approval-required", "true") === "true",
      liveRequested: getOption(options, "live", "false") === "true",
      config: actorPolicy.config,
      configVersion: actorPolicy.version,
    });
    process.stdout.write(`${JSON.stringify({ actorPolicy: describeActorPolicyConfig(actorPolicy), decision }, null, 2)}\n`);
    return;
  }

  if (command === "inbound:list") {
    const records = await listInboundAuditRecords(dependencies.storage);
    process.stdout.write(
      `${records.map((record) => `${record.id} | ${record.eventType} | ${record.actorIdentity?.login ?? "none"} | ${record.summary}`).join("\n") || "No inbound audits recorded."}\n`,
    );
    return;
  }

  if (command === "inbound:inspect") {
    const inboundId = options.get("inbound-id");
    if (!inboundId) {
      throw new Error("--inbound-id is required for inbound:inspect.");
    }
    const record = await dependencies.storage.loadInboundAudit(inboundId);
    if (!record) {
      throw new Error(`Inbound audit ${inboundId} was not found.`);
    }
    process.stdout.write(`${formatInboundAuditSummary(record)}\n\n${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  const existingState = await dependencies.storage.loadState(stateId);
  if (!existingState) {
    throw new Error(`State ${stateId} was not found. Run init first.`);
  }
  if (existingState.backendType !== dependencies.backend.backendType) {
    dependencies = createDefaultDependencies({
      repoPath,
      storageRoot,
      backendType: existingState.backendType,
      backendFallbackType,
      executorMode,
      workspaceRoot,
    });
  }

  if (command === "plan") {
    const updated = await planOrchestratorIteration(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updated.plannerDecision, null, 2)}\n`);
    return;
  }

  if (command === "review") {
    process.stdout.write(`${JSON.stringify(existingState.lastReviewVerdict, null, 2)}\n`);
    return;
  }

  if (command === "preflight") {
    const preflight = await runOrchestratorPreflight({
      repoPath,
      workspaceRoot,
      state: existingState,
    });
    process.stdout.write(`${formatPreflightSummary(preflight)}\n\n${JSON.stringify(preflight, null, 2)}\n`);
    return;
  }

  if (command === "status:report") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const result = await reportStateStatus({
      state: existingState,
      outputRoot,
      adapter: new GhCliStatusReportingAdapter({
        enabled: getOption(options, "enabled", "true") === "true",
        token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      }),
    });
    const updated = applyStatusReportToState(existingState, result);
    await dependencies.storage.saveState(updated);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "github-live-report:smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveCommentSmoke({
      state: existingState,
      outputRoot,
      adapter,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:smoke") {
    const result = await runGitHubReportPermissionSmoke({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:permissions") {
    const result = await runGitHubReportPermissionSmoke({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(
      [
        `GitHub reporting permissions: ${result.status} / ${result.permissionStatus}`,
        `Target strategy: ${result.targetStrategy}`,
        `Target: ${result.targetKind}:${result.targetId ?? "none"}`,
        `Summary: ${result.summary}`,
        `Next action: ${result.suggestedNextAction}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:target-check") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const registryResolution = resolveGitHubSandboxTarget({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      requestedProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    const result =
      registryResolution.status === "resolved"
        ? selectGitHubLiveSmokeTarget({
            state: existingState,
            requestedTarget: registryResolution.requestedTarget,
          })
        : null;
    process.stdout.write(
      [
        `Sandbox registry: ${describeGitHubSandboxTargetRegistry(sandboxRegistry)}`,
        `Registry resolution: ${registryResolution.status} / profile=${registryResolution.profileId ?? "none"} / source=${registryResolution.configSource}`,
        `Registry summary: ${registryResolution.summary}`,
        result
          ? `GitHub auth smoke target: ${result.status} / mode=${result.mode} / action=${result.attemptedAction} / target=${result.target.targetType ?? "none"} ${result.target.repository ?? "none"}#${result.target.targetNumber ?? "none"}`
          : "GitHub auth smoke target: unresolved",
        `Next action: ${result?.suggestedNextAction ?? registryResolution.suggestedNextAction}`,
        "",
        JSON.stringify({ sandboxRegistry, registryResolution, result }, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "sandbox:list") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    process.stdout.write(`${formatSandboxProfileList(sandboxRegistry)}\n\n${JSON.stringify(sandboxRegistry, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:list") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    process.stdout.write(`${formatSandboxPolicyBundleList(sandboxRegistry)}\n\n${JSON.stringify(sandboxRegistry.registry.bundles, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:show") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundle = showSandboxPolicyBundle(sandboxRegistry, options.get("sandbox-bundle") ?? null);
    process.stdout.write(`${formatSandboxPolicyBundle(bundle)}\n\n${JSON.stringify({ bundle, sandboxRegistry }, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:bundle:governance") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundleId = options.get("sandbox-bundle") ?? null;
    const decision = evaluateSandboxBundleGovernance({
      loadedRegistry: sandboxRegistry,
      bundleId,
      profileId: options.get("sandbox-profile") ?? null,
      intendedUse:
        (options.get("intended-use") as "apply" | "default" | "live_smoke" | undefined) ?? "apply",
    });
    const inspection = inspectSandboxBundleGovernance(sandboxRegistry);
    process.stdout.write(
      `${formatSandboxBundleGovernanceSummary(decision)}\nRegistry invalid bundles: ${inspection.invalidBundleIds.join(", ") || "none"}\nRegistry disabled bundles: ${inspection.disabledBundleIds.join(", ") || "none"}\n\n${JSON.stringify({ decision, inspection, sandboxRegistry }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:create") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:create.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const bundleId = options.get("sandbox-bundle") ?? null;
    const targetNumber = options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null;
    const bundleResult =
      bundleId !== null
        ? applySandboxPolicyBundle({
            loadedRegistry: sandboxRegistry,
            bundleId,
            overrides: {
              repository: options.get("target-repo") ?? undefined,
              targetType: options.has("target-type")
                ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
                : undefined,
              targetNumber: targetNumber ?? undefined,
              actionPolicy: options.get("action-policy") as "create_or_update" | "create_only" | "update_only" | undefined,
              enabled: options.has("enabled") ? getOption(options, "enabled", "true") === "true" : undefined,
              notes: options.get("notes") ?? undefined,
            },
          })
        : null;
    if (bundleId !== null) {
      const bundleGovernance = evaluateSandboxBundleGovernance({
        loadedRegistry: sandboxRegistry,
        bundleId,
        intendedUse: getOption(options, "set-default", "false") === "true" ? "default" : "apply",
      });
      if (bundleGovernance.status !== "ready") {
        process.stdout.write(`${formatSandboxBundleGovernanceSummary(bundleGovernance)}\n\n${JSON.stringify(bundleGovernance, null, 2)}\n`);
        return;
      }
    }
    if (bundleResult && bundleResult.status !== "resolved") {
      process.stdout.write(`${bundleResult.summary}\n\n${JSON.stringify(bundleResult, null, 2)}\n`);
      return;
    }
    const directRepository = options.get("target-repo");
    const directTargetType = options.get("target-type") as "issue" | "pull_request" | undefined;
    if (
      !bundleResult &&
      (!directRepository || !directTargetType || !targetNumber)
    ) {
      throw new Error("--target-repo, --target-type, and --target-number are required for sandbox:create unless --sandbox-bundle resolves them.");
    }
    const profile = bundleResult?.profile ?? {
      repository: directRepository!,
      targetType: directTargetType!,
      targetNumber: targetNumber!,
      actionPolicy: (options.get("action-policy") as "create_or_update" | "create_only" | "update_only" | undefined) ?? "create_or_update",
      enabled: getOption(options, "enabled", "true") === "true",
      notes: options.get("notes") ?? null,
    };
    const result = await createSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
      profile,
      setDefault: getOption(options, "set-default", "false") === "true",
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:update") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:update.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const existingProfile = sandboxRegistry.registry.profiles[profileId] ?? null;
    const changes: Record<string, unknown> = {};
    if (options.has("target-repo")) changes.repository = options.get("target-repo");
    if (options.has("target-type")) changes.targetType = getOption(options, "target-type", "issue");
    if (options.has("target-number")) changes.targetNumber = Number.parseInt(getOption(options, "target-number", "0"), 10);
    if (options.has("action-policy")) changes.actionPolicy = options.get("action-policy");
    if (options.has("enabled")) changes.enabled = getOption(options, "enabled", "true") === "true";
    if (options.has("notes")) changes.notes = options.get("notes");
    if (options.has("sandbox-bundle")) {
      const bundleGovernance = evaluateSandboxBundleGovernance({
        loadedRegistry: sandboxRegistry,
        bundleId: options.get("sandbox-bundle") ?? null,
        profileId,
        intendedUse: sandboxRegistry.registry.defaultProfileId === profileId ? "default" : "apply",
      });
      if (bundleGovernance.status !== "ready") {
        process.stdout.write(`${formatSandboxBundleGovernanceSummary(bundleGovernance)}\n\n${JSON.stringify(bundleGovernance, null, 2)}\n`);
        return;
      }
      const bundleResult = applySandboxPolicyBundle({
        loadedRegistry: sandboxRegistry,
        bundleId: options.get("sandbox-bundle") ?? null,
        existingProfile,
        overrides: changes,
      });
      if (bundleResult.status !== "resolved" || !bundleResult.profile) {
        process.stdout.write(`${bundleResult.summary}\n\n${JSON.stringify(bundleResult, null, 2)}\n`);
        return;
      }
      Object.assign(changes, bundleResult.profile);
    }
    const result = await updateSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
      changes,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:delete") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:delete.");
    }
    const result = await deleteSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:set-default") {
    const profileId = options.get("sandbox-profile");
    if (!profileId) {
      throw new Error("--sandbox-profile is required for sandbox:set-default.");
    }
    const result = await setDefaultSandboxProfile({
      configPath: options.get("sandbox-config") ?? null,
      profileId,
    });
    process.stdout.write(`${formatSandboxLifecycleSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:show") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const profileId = options.get("sandbox-profile") ?? sandboxRegistry.registry.defaultProfileId ?? null;
    const profile = showSandboxProfile(sandboxRegistry, profileId);
    process.stdout.write(
      [
        `Sandbox profile: ${profileId ?? "none"}`,
        `Found: ${profile ? "yes" : "no"}`,
        profile
          ? `Target: ${profile.targetType} ${profile.repository}#${profile.targetNumber} (${profile.actionPolicy})`
          : "Target: none",
        `Bundle: ${profile?.bundleId ?? "none"} / overrides=${profile?.overrideFields.join(", ") || "none"}`,
        `Default profile: ${sandboxRegistry.registry.defaultProfileId ?? "none"}`,
        `Config: ${sandboxRegistry.source}/${sandboxRegistry.version} (${sandboxRegistry.path ?? "no-path"})`,
        "",
        JSON.stringify({ profile, sandboxRegistry }, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "sandbox:validate") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const validation = validateSandboxProfile({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      profileId: options.get("sandbox-profile") ?? null,
    });
    process.stdout.write(`${formatSandboxProfileValidation(validation)}\n\n${JSON.stringify(validation, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:audit") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required for sandbox:audit.");
    }
    const audit = await listSandboxAuditRecords({
      configPath,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    process.stdout.write(`${formatSandboxAuditTrail(audit.records)}\n\n${JSON.stringify(audit, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:restore-points") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required for sandbox:restore-points.");
    }
    const restorePoints = await listSandboxRestorePoints({
      configPath,
      limit: options.has("limit") ? Number.parseInt(getOption(options, "limit", "10"), 10) : 10,
    });
    process.stdout.write(`${summarizeSandboxRestorePoints(restorePoints)}\n\n${JSON.stringify(restorePoints, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:governance") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const profileId = options.get("sandbox-profile") ?? sandboxRegistry.registry.defaultProfileId ?? null;
    const decision = evaluateSandboxProfileGovernance({
      loadedRegistry: sandboxRegistry,
      profileId,
      requireDefaultSafePolicy: sandboxRegistry.registry.defaultProfileId === profileId,
    });
    const inspection = inspectSandboxGovernance(sandboxRegistry);
    process.stdout.write(
      `${formatSandboxGovernanceSummary(decision)}\nRegistry invalid profiles: ${inspection.invalidProfileIds.join(", ") || "none"}\nRegistry disabled profiles: ${inspection.disabledProfileIds.join(", ") || "none"}\n\n${JSON.stringify({ decision, inspection, sandboxRegistry }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:guardrails") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const registryResolution = resolveGitHubSandboxTarget({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      requestedProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    const decision = evaluateSandboxGuardrails({
      state: existingState,
      loadedRegistry: sandboxRegistry,
      selectedProfileId: registryResolution.profileId,
      selectionMode: registryResolution.selectionMode,
      selectionReason: registryResolution.selectionReason,
    });
    process.stdout.write(
      `${formatSandboxGuardrailsSummary(decision)}\nSelection summary: ${registryResolution.summary}\n\n${JSON.stringify({ registryResolution, decision }, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:export") {
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const outputPath = path.resolve(
      options.get("output") ??
        path.join(repoPath, ".tmp", "orchestrator-sandbox", options.get("sandbox-profile") ? `${options.get("sandbox-profile")}.json` : "sandbox-export.json"),
    );
    const result = await exportSandboxProfiles({
      loadedRegistry: sandboxRegistry,
      outputPath,
      profileId: options.get("sandbox-profile") ?? null,
      snapshot: getOption(options, "snapshot", "false") === "true",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxImportExportStatus: result.status,
      lastSandboxImportExportSummary: result.summary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxImportExport(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:import") {
    const configPath = options.get("sandbox-config");
    const inputPath = options.get("input");
    if (!configPath || !inputPath) {
      throw new Error("--sandbox-config and --input are required for sandbox:import.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await importSandboxProfiles({
      configPath,
      inputPath,
      loadedRegistry: sandboxRegistry,
      state: existingState,
      mode: (options.get("mode") as "preview" | "apply" | undefined) ?? "preview",
      actorSource: `sandbox:import:${(options.get("mode") as "preview" | "apply" | undefined) ?? "preview"}`,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxImportExportStatus: result.status,
      lastSandboxImportExportSummary: result.summary,
      lastSandboxDiffSummary: result.diffSummary,
      lastRestorePointId: result.mode === "apply" ? result.restorePointId ?? existingState.lastRestorePointId : existingState.lastRestorePointId,
      lastRestorePointSummary:
        result.mode === "apply" ? result.restorePointSummary ?? existingState.lastRestorePointSummary : existingState.lastRestorePointSummary,
      lastSandboxApplyStatus:
        result.mode === "apply" && result.status === "imported"
          ? "applied"
          : result.mode === "apply" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxApplyStatus,
      lastSandboxApplySummary: result.mode === "apply" ? result.summary : existingState.lastSandboxApplySummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxImportExport(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:diff" || command === "sandbox:review" || command === "sandbox:apply") {
    const configPath = options.get("sandbox-config");
    const inputPath = options.get("input");
    if (!configPath || !inputPath) {
      throw new Error("--sandbox-config and --input are required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const importPreview = await importSandboxProfiles({
      configPath,
      inputPath,
      loadedRegistry: sandboxRegistry,
      state: existingState,
      mode: "preview",
      actorSource: "sandbox:review",
      commandSource: "cli",
    });
    if (command === "sandbox:diff") {
      process.stdout.write(`${summarizeSandboxImportExport(importPreview)}\n\n${JSON.stringify(importPreview, null, 2)}\n`);
      return;
    }
    const proposedRegistry = importPreview.registry ?? sandboxRegistry.registry;
    const review = await reviewSandboxRegistryChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      proposedRegistry,
      actorSource: "sandbox:review",
      commandSource: "cli",
      recordAudit: command === "sandbox:review",
    });
    if (command === "sandbox:review") {
      const updatedState = orchestratorStateSchema.parse({
        ...existingState,
        lastSandboxDiffSummary: review.diffSummary,
        lastSandboxReviewStatus: review.status,
        lastSandboxReviewSummary: review.summary,
        updatedAt: new Date().toISOString(),
      });
      await dependencies.storage.saveState(updatedState);
      process.stdout.write(`${summarizeSandboxReview(review)}\n\n${JSON.stringify(review, null, 2)}\n`);
      return;
    }
    const applied = await applySandboxRegistryChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      proposedRegistry,
      actorSource: "sandbox:apply",
      commandSource: "cli",
      applySource: "apply",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastSandboxDiffSummary: applied.diffSummary,
      lastSandboxReviewStatus: applied.status === "ready" ? "ready" : applied.status,
      lastSandboxReviewSummary: applied.summary,
      lastSandboxApplyStatus:
        applied.status === "ready"
          ? "applied"
          : applied.status,
      lastSandboxApplySummary: applied.summary,
      lastRestorePointId: applied.restorePointId ?? existingState.lastRestorePointId,
      lastRestorePointSummary: applied.restorePointSummary ?? existingState.lastRestorePointSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${summarizeSandboxReview(applied)}\n\n${JSON.stringify(applied, null, 2)}\n`);
    return;
  }

  if (command === "sandbox:batch:preview" || command === "sandbox:batch:validate" || command === "sandbox:batch:apply") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const sandboxProfiles =
      (options.get("sandbox-profiles") ?? options.get("sandbox-profile") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const result = await runSandboxBatchChange({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      profileIds: sandboxProfiles,
      bundleId: options.get("sandbox-bundle") ?? null,
      changes: {
        repository: options.get("target-repo") ?? undefined,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : undefined,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : undefined,
        actionPolicy: options.has("action-policy")
          ? (options.get("action-policy") as "create_or_update" | "create_only" | "update_only")
          : undefined,
        enabled: options.has("enabled") ? getOption(options, "enabled", "true") === "true" : undefined,
        notes: options.has("notes") ? options.get("notes") ?? null : undefined,
      },
      mode:
        command === "sandbox:batch:preview"
          ? "preview"
          : command === "sandbox:batch:validate"
            ? "validate"
            : "apply",
      allowPartial: getOption(options, "allow-partial", "false") === "true",
      actorSource: command,
      commandSource: "cli",
    });
    const nextSandboxApplyStatus =
      command !== "sandbox:batch:apply"
        ? existingState.lastSandboxApplyStatus
        : result.status === "applied" || result.status === "partially_applied"
          ? "applied"
          : result.status === "blocked" || result.status === "manual_required"
            ? result.status
            : existingState.lastSandboxApplyStatus;
    const nextSandboxReviewStatus =
      command !== "sandbox:batch:validate"
        ? existingState.lastSandboxReviewStatus
        : result.status === "validated"
          ? "ready"
          : result.status === "blocked" || result.status === "manual_required"
            ? result.status
            : existingState.lastSandboxReviewStatus;
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      bundleGovernanceStatus: result.governanceStatus,
      bundleGovernanceReason:
        result.profileDecisions.find((item) => item.status !== "ready")?.failureReason ?? existingState.bundleGovernanceReason,
      lastSandboxDiffSummary: result.diffSummary,
      lastBatchChangeStatus: result.status,
      lastBatchImpactSummary: result.impactSummary.summaryText,
      lastBatchAffectedProfiles: result.affectedProfileIds,
      lastBatchBlockedProfiles: [...result.blockedProfileIds, ...result.manualRequiredProfileIds],
      lastRestorePointId: command === "sandbox:batch:apply" ? result.restorePointId ?? existingState.lastRestorePointId : existingState.lastRestorePointId,
      lastRestorePointSummary:
        command === "sandbox:batch:apply" ? result.restorePointSummary ?? existingState.lastRestorePointSummary : existingState.lastRestorePointSummary,
      lastSandboxApplyStatus: nextSandboxApplyStatus,
      lastSandboxApplySummary: command === "sandbox:batch:apply" ? result.summary : existingState.lastSandboxApplySummary,
      lastSandboxReviewStatus: nextSandboxReviewStatus,
      lastSandboxReviewSummary:
        command === "sandbox:batch:validate" ? result.summary : existingState.lastSandboxReviewSummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${summarizeSandboxBatchChange(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "sandbox:rollback:preview" || command === "sandbox:rollback:validate" || command === "sandbox:rollback:apply") {
    const configPath = options.get("sandbox-config");
    if (!configPath) {
      throw new Error("--sandbox-config is required.");
    }
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const result = await runSandboxRollback({
      configPath,
      state: existingState,
      loadedRegistry: sandboxRegistry,
      restorePointId: options.get("restore-point-id") ?? null,
      mode:
        command === "sandbox:rollback:preview"
          ? "preview"
          : command === "sandbox:rollback:validate"
            ? "validate"
            : "apply",
      actorSource: command,
      commandSource: "cli",
    });
    const updatedState = orchestratorStateSchema.parse({
      ...existingState,
      lastRestorePointId: result.restorePointId ?? existingState.lastRestorePointId,
      lastRestorePointSummary:
        result.restorePointId && result.status !== "no_op"
          ? `Rollback source restore point '${result.restorePointId}' selected for ${result.mode}.`
          : existingState.lastRestorePointSummary,
      lastRollbackStatus: result.status,
      lastRollbackImpactSummary: result.impactSummary.summaryText,
      lastRollbackAuditId: result.auditId,
      lastSandboxDiffSummary: result.diffSummary,
      lastSandboxReviewStatus:
        result.mode === "validate" && result.status === "validated"
          ? "ready"
          : result.mode === "validate" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxReviewStatus,
      lastSandboxReviewSummary:
        result.mode === "validate" ? result.summary : existingState.lastSandboxReviewSummary,
      lastSandboxApplyStatus:
        result.mode === "apply" && result.status === "restored"
          ? "applied"
          : result.mode === "apply" && (result.status === "blocked" || result.status === "manual_required")
            ? result.status
            : existingState.lastSandboxApplyStatus,
      lastSandboxApplySummary:
        result.mode === "apply" ? result.summary : existingState.lastSandboxApplySummary,
      updatedAt: new Date().toISOString(),
    });
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(
      `${summarizeSandboxRollback(result)}\n\n${formatSandboxImpactSummary(result.impactSummary)}\n\n${JSON.stringify(result, null, 2)}\n`,
    );
    return;
  }

  if (command === "reporting:auth-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveAuthSmoke({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(
      [
        `GitHub auth smoke: ${result.result.status} / ${result.result.permissionResult}`,
        `Mode: ${result.result.mode}`,
        `Action: ${result.result.attemptedAction}`,
        `Target: ${result.result.target.targetType ?? "none"} ${result.result.target.repository ?? "none"}#${result.result.target.targetNumber ?? "none"}`,
        `Sandbox profile: ${result.state.sandboxTargetProfileId ?? "none"} / config=${result.state.sandboxTargetConfigVersion ?? "none"}`,
        `Summary: ${result.result.summary}`,
        `Next action: ${result.result.suggestedNextAction}`,
        `Evidence: ${result.evidencePath}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:precheck") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runLiveAuthOperatorFlow({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
      execute: false,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${result.summaryText}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:run-live-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runLiveAuthOperatorFlow({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
      execute: true,
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(`${result.summaryText}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "reporting:live-success-smoke") {
    const outputRoot = getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-status-report"));
    const sandboxRegistry = await loadSandboxRegistryFromOptions(options);
    const adapter = new GhCliStatusReportingAdapter({
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    const result = await runGitHubLiveAuthSmoke({
      state: existingState,
      outputRoot,
      adapter,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
      sandboxRegistry,
      sandboxProfileId: options.get("sandbox-profile") ?? null,
      requestedTarget: {
        repository: options.get("target-repo") ?? null,
        targetType: options.has("target-type")
          ? (getOption(options, "target-type", "issue") as "issue" | "pull_request")
          : null,
        targetNumber: options.has("target-number") ? Number.parseInt(getOption(options, "target-number", "0"), 10) : null,
        allowCorrelatedReuse: getOption(options, "allow-correlated-reuse", "false") === "true",
      },
    });
    await dependencies.storage.saveState(result.state);
    process.stdout.write(
      [
        `GitHub live success smoke: ${result.result.status} / ${result.result.permissionResult}`,
        `Action: ${result.result.attemptedAction}`,
        `Provider: ${result.result.providerUsed}`,
        `Sandbox profile: ${result.state.sandboxProfileId ?? result.state.sandboxTargetProfileId ?? "none"} / status=${result.state.sandboxProfileStatus} / config=${result.state.sandboxTargetConfigVersion ?? "none"}`,
        `Target: ${result.result.target.targetType ?? "none"} ${result.result.target.repository ?? "none"}#${result.result.target.targetNumber ?? "none"}`,
        `Last success at: ${result.state.lastAuthSmokeSuccessAt ?? "none"}`,
        `Summary: ${result.result.summary}`,
        `Next action: ${result.result.suggestedNextAction}`,
        `Evidence: ${result.evidencePath}`,
        "",
        JSON.stringify(result, null, 2),
      ].join("\n"),
    );
    return;
  }

  if (command === "reporting:status") {
    const summary = await inspectGitHubReportingOperatorSummary({
      state: existingState,
      enabled: getOption(options, "enabled", "true") === "true",
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    });
    process.stdout.write(`${summary.summaryText}\n\n${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (command === "reporting:audit") {
    process.stdout.write(`${formatReportDeliveryAttempts(existingState.reportDeliveryAttempts)}\n\n${JSON.stringify(existingState.reportDeliveryAttempts, null, 2)}\n`);
    return;
  }

  if (command === "status" || command === "inspect" || command === "diagnostics") {
    const diagnostics = buildDiagnosticsSummary(existingState);
    process.stdout.write(`${formatDiagnosticsSummary(diagnostics)}\n`);
    return;
  }

  if (command === "queue:enqueue") {
    const result = await enqueueStateRun({
      backend: dependencies.backend,
      state: existingState,
      priority: Number.parseInt(getOption(options, "priority", "0"), 10),
      scheduledAt: options.get("scheduled-at"),
      requestedBy: options.get("requested-by") ?? "operator",
    });
    const updatedState = orchestratorStateSchema.parse(
      applyQueueItemToState(existingState, result.item, new Date()),
    );
    await dependencies.storage.saveState(updatedState);
    process.stdout.write(`${formatRunSummary(result.item)}\n${result.deduped ? "\nDeduped existing queued/running item.\n" : ""}`);
    return;
  }

  if (command === "queue:list") {
    const queue = await listQueueRuns(dependencies.backend);
    process.stdout.write(`${formatQueueSummary(queue)}\n`);
    return;
  }

  if (command === "worker:once") {
    const summary = await runQueueWorker({
      workerId: getOption(options, "worker-id", "worker-once"),
      dependencies,
      continuous: false,
      leaseMs: Number.parseInt(getOption(options, "lease-ms", "60000"), 10),
    });
    process.stdout.write(`${formatWorkerSummary(summary)}\n`);
    return;
  }

  if (command === "worker:run") {
    const summary = await runQueueWorker({
      workerId: getOption(options, "worker-id", "worker-loop"),
      dependencies,
      continuous: true,
      daemon: true,
      pollIntervalMs: Number.parseInt(getOption(options, "poll-ms", "1000"), 10),
      maxPolls: Number.parseInt(getOption(options, "max-polls", "10"), 10),
      maxIdleCycles: Number.parseInt(getOption(options, "max-idle-cycles", "3"), 10),
      leaseMs: Number.parseInt(getOption(options, "lease-ms", "60000"), 10),
    });
    process.stdout.write(`${formatWorkerSummary(summary)}\n`);
    return;
  }

  if (command === "worker:status") {
    const summary = await getWorkerStatus(dependencies, options.get("worker-id"));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (command === "backend:inspect") {
    const inspection = await dependencies.backend.inspect();
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    return;
  }

  if (command === "backend:status") {
    const status = await dependencies.backend.status();
    process.stdout.write(`${formatBackendStatus(status)}\n\n${JSON.stringify(status, null, 2)}\n`);
    return;
  }

  if (command === "backend:live-smoke") {
    const result = await runSupabaseBackendLiveSmoke({
      repoPath,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-backend-live")),
      enabled: getOption(options, "enabled", "true") === "true",
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        backendHealthStatus:
          result.status === "passed"
            ? "ready"
            : result.status === "manual_required"
              ? "manual_required"
              : result.status === "skipped"
                ? "skipped"
                : "blocked",
        lastBackendLiveSmokeResult: result,
        updatedAt: result.ranAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:health") {
    const result = await inspectBackendHealth({
      dependencies,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        backendHealthStatus: result.status,
        lastBackendHealthSummary: result,
        updatedAt: result.inspectedAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatBackendHealth(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:repair") {
    const result = await repairBackendHealth({
      dependencies,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        repairStatus: result.status,
        lastRepairDecision: result,
        updatedAt: result.ranAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatRepairSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:export") {
    const result = await exportBackendSnapshot({
      dependencies,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-backend-transfer")),
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        transferStatus: result.status,
        lastTransferSummary: result,
        updatedAt: result.createdAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatTransferSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:import") {
    const snapshotPath = options.get("snapshot");
    if (!snapshotPath) {
      throw new Error("--snapshot is required for backend:import.");
    }
    const result = await importBackendSnapshot({
      dependencies,
      snapshotPath: path.resolve(snapshotPath),
      targetBackendType: dependencies.backend.backendType,
    });
    const state = await dependencies.storage.loadState(stateId);
    if (state) {
      const updated = orchestratorStateSchema.parse({
        ...state,
        transferStatus: result.status,
        lastTransferSummary: result,
        updatedAt: result.createdAt,
      });
      await dependencies.storage.saveState(updated);
    }
    process.stdout.write(`${formatTransferSummary(result)}\n\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:init") {
    const result = await dependencies.backend.initialize();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backend:migrate") {
    const result = await dependencies.backend.migrate();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "run:cancel") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requestCancelRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "run:pause") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requestPauseRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "run:resume" || command === "run:requeue") {
    const runId = await resolveRunId({
      stateId,
      dependencies,
      explicitRunId: options.get("run-id"),
    });
    const updatedRun = await requeueRun(dependencies.backend, runId, options.get("reason"));
    if (updatedRun) {
      const updatedState = orchestratorStateSchema.parse(applyQueueItemToState(existingState, updatedRun, new Date()));
      await dependencies.storage.saveState(updatedState);
    }
    process.stdout.write(updatedRun ? `${formatRunSummary(updatedRun)}\n` : "Run not found.\n");
    return;
  }

  if (command === "approve") {
    const updatedState = await approvePendingPlan(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "reject") {
    const updatedState = await rejectPendingPlan(stateId, dependencies, options.get("reason"));
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "approve-patch") {
    const updatedState = await approvePendingPatch(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "promote-patch") {
    const updatedState = await promoteApprovedPatch(stateId, dependencies, {
      applyWorkspace,
      createBranch,
    });
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "reject-patch") {
    const updatedState = await rejectPendingPatch(stateId, dependencies, options.get("reason"));
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "run-once" || command === "resume" || command === "dry-run") {
    const updatedState = await runOrchestratorOnce(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "run-loop") {
    const updatedState = await runOrchestratorLoop(stateId, dependencies);
    process.stdout.write(`${JSON.stringify(updatedState, null, 2)}\n`);
    return;
  }

  if (command === "workspace:cleanup") {
    const manager = new FileSystemWorkspaceManager(workspaceRoot);
    await manager.cleanupWorkspace(stateId);
    process.stdout.write(`${JSON.stringify({ cleaned: true, workspaceRoot, stateId }, null, 2)}\n`);
    return;
  }

  if (command === "cleanup") {
    const result = await cleanupStateWorkspaces(stateId, dependencies, {
      staleMinutes: options.has("stale-minutes") ? Number.parseInt(getOption(options, "stale-minutes", "120"), 10) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "artifacts:prune") {
    const result = await pruneStateArtifacts(stateId, dependencies, {
      retainRecentSuccess: options.has("retain-success") ? Number.parseInt(getOption(options, "retain-success", "3"), 10) : undefined,
      retainRecentFailure: options.has("retain-failure") ? Number.parseInt(getOption(options, "retain-failure", "5"), 10) : undefined,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-smoke") {
    const result = await runLiveSmoke({
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-smoke")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-acceptance") {
    const result = await runLiveAcceptance({
      stateId,
      dependencies,
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-acceptance")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "live-pass") {
    const result = await runLivePass({
      stateId,
      dependencies,
      repoPath,
      workspaceRoot,
      outputRoot: getOption(options, "output-root", path.join(repoPath, ".tmp", "orchestrator-live-pass")),
      model: options.get("model"),
      enabled: liveSmokeEnabled || getOption(options, "enabled", "true") === "true",
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "handoff") {
    const result = await prepareHandoff(stateId, dependencies, {
      publishBranch,
      createBranch,
      githubHandoffEnabled,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      "Usage:",
      "  node cli.js init --state-id default --goal \"...\"",
      "  node cli.js plan --state-id default",
      "  node cli.js event:intake --payload path/to/event.json --enqueue true --report-status true",
      "  node cli.js webhook:intake --payload path/to/payload.json --headers path/to/headers.json --enqueue true",
      "  node cli.js webhook:runtime --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github",
      "  node cli.js webhook:serve --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github",
      "  node cli.js actor-policy:check --actor orchestrator-admin --command run",
      "  node cli.js inbound:list",
      "  node cli.js inbound:inspect --inbound-id delivery-123",
      "  node cli.js status:report --state-id default",
      "  node cli.js github-live-report:smoke --state-id default",
      "  node cli.js reporting:smoke --state-id default",
      "  node cli.js reporting:permissions --state-id default",
      "  node cli.js sandbox:create --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --target-repo example/bige --target-type issue --target-number 101 --set-default true",
      "  node cli.js sandbox:update --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --enabled true --notes \"safe smoke target\"",
      "  node cli.js sandbox:delete --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:set-default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:target-check --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:list --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:bundle:list --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:bundle:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only",
      "  node cli.js sandbox:bundle:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only --sandbox-profile default",
      "  node cli.js sandbox:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:validate --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:audit --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:restore-points --sandbox-config .tmp/orchestrator-sandbox.json",
      "  node cli.js sandbox:guardrails --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js sandbox:export --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --output .tmp/sandbox-default.json",
      "  node cli.js sandbox:import --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json --mode preview",
      "  node cli.js sandbox:diff --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:review --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:apply --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json",
      "  node cli.js sandbox:batch:preview --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only",
      "  node cli.js sandbox:batch:validate --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only",
      "  node cli.js sandbox:batch:apply --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only --allow-partial false",
      "  node cli.js sandbox:rollback:preview --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js sandbox:rollback:validate --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js sandbox:rollback:apply --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...",
      "  node cli.js reporting:precheck --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:auth-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:run-live-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:live-success-smoke --state-id default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default",
      "  node cli.js reporting:status --state-id default",
      "  node cli.js reporting:audit --state-id default",
      "  node cli.js queue:enqueue --state-id default --priority 10",
      "  node cli.js queue:list",
      "  node cli.js run-once --state-id default --executor openai_responses --execution-mode dry_run",
      "  node cli.js run-loop --state-id default --executor mock",
      "  node cli.js worker:once --worker-id worker-1",
      "  node cli.js worker:run --worker-id worker-1 --poll-ms 1000 --max-polls 10",
      "  node cli.js worker:status --worker-id worker-1",
      "  node cli.js backend:init --backend-type supabase",
      "  node cli.js backend:migrate --backend-type supabase",
      "  node cli.js backend:status --backend-type sqlite",
      "  node cli.js backend:live-smoke --backend-type supabase",
      "  node cli.js backend:health --backend-type supabase",
      "  node cli.js backend:repair --backend-type supabase",
      "  node cli.js backend:export --backend-type file",
      "  node cli.js backend:import --backend-type supabase --snapshot path/to/export.json",
      "  node cli.js backend:inspect",
      "  node cli.js run:pause --state-id default",
      "  node cli.js run:resume --state-id default",
      "  node cli.js run:cancel --state-id default",
      "  node cli.js run:requeue --state-id default",
      "  node cli.js approve --state-id default",
      "  node cli.js reject --state-id default --reason \"...\"",
      "  node cli.js approve-patch --state-id default",
      "  node cli.js promote-patch --state-id default --create-branch true --apply-workspace false",
      "  node cli.js reject-patch --state-id default --reason \"...\"",
      "  node cli.js handoff --state-id default --publish-branch false --github-handoff false",
      "  node cli.js preflight --state-id default",
      "  node cli.js inspect --state-id default",
      "  node cli.js diagnostics --state-id default",
      "  node cli.js resume --state-id default",
      "  node cli.js workspace:cleanup --state-id default --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js cleanup --state-id default --stale-minutes 120",
      "  node cli.js artifacts:prune --state-id default --retain-success 3 --retain-failure 5",
      "  node cli.js live-smoke --enabled true --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js live-acceptance --state-id default --enabled true",
      "  node cli.js live-pass --state-id default --enabled true",
      "  node cli.js review --state-id default",
      "  node cli.js dry-run --state-id default --executor mock",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
