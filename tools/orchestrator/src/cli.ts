import path from "node:path";
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
import type { ExecutionMode, ExecutorFallbackMode, ExecutorProviderKind, PlannerProviderKind } from "./schemas";
import { FileSystemWorkspaceManager } from "./workspace";
import { runOrchestratorPreflight, formatPreflightSummary } from "./preflight";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "./diagnostics";

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

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const repoPath = getOption(options, "repo", process.cwd());
  const stateId = getOption(options, "state-id", "default");
  const storageRoot = getOption(options, "storage-root", path.join(repoPath, ".tmp", "orchestrator-state"));
  const executorMode = getOption(options, "executor", "mock") as ExecutorProviderKind;
  const executionMode = getOption(options, "execution-mode", executorMode === "mock" ? "mock" : "dry_run") as ExecutionMode;
  const executorFallbackMode = getOption(options, "executor-fallback", "blocked") as ExecutorFallbackMode;
  const workspaceRoot = getOption(options, "workspace-root", path.join(repoPath, ".tmp", "orchestrator-workspaces"));
  const liveSmokeEnabled = getOption(options, "live-smoke", "false") === "true";
  const applyWorkspace = getOption(options, "apply-workspace", "false") === "true";
  const createBranch = getOption(options, "create-branch", "true") === "true";
  const publishBranch = getOption(options, "publish-branch", "false") === "true";
  const githubHandoffEnabled = getOption(options, "github-handoff", "false") === "true";
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
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
    });
    await dependencies.storage.saveState(state);
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }

  const existingState = await dependencies.storage.loadState(stateId);
  if (!existingState) {
    throw new Error(`State ${stateId} was not found. Run init first.`);
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

  if (command === "status" || command === "inspect" || command === "diagnostics") {
    const diagnostics = buildDiagnosticsSummary(existingState);
    process.stdout.write(`${formatDiagnosticsSummary(diagnostics)}\n`);
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
      "  node cli.js run-once --state-id default --executor openai_responses --execution-mode dry_run",
      "  node cli.js run-loop --state-id default --executor mock",
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
