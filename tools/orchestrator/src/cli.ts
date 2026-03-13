import path from "node:path";
import {
  approvePendingPatch,
  approvePendingPlan,
  createDefaultDependencies,
  createInitialState,
  planOrchestratorIteration,
  pruneStateArtifacts,
  rejectPendingPatch,
  rejectPendingPlan,
  runLiveSmoke,
  runOrchestratorLoop,
  runOrchestratorOnce,
} from "./orchestrator";
import type { ExecutionMode, ExecutorFallbackMode, ExecutorProviderKind, PlannerProviderKind } from "./schemas";
import { FileSystemWorkspaceManager } from "./workspace";

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
      autoMode: getOption(options, "auto-mode", "false") === "true",
      approvalMode: getOption(options, "approval-mode", "human_approval") as "auto" | "human_approval",
      executorMode,
      executionMode,
      executorFallbackMode,
      workspaceRoot,
      executorCommand: getOption(options, "local-command", "node,-e,console.log('local-executor-ok')")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      plannerProvider: getOption(options, "planner-provider", "rule_based") as PlannerProviderKind,
      reviewerProvider: getOption(options, "reviewer-provider", "rule_based") as PlannerProviderKind,
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

  if (command === "artifacts:prune") {
    const result = await pruneStateArtifacts(stateId, dependencies, {
      retainRecentSuccess: Number.parseInt(getOption(options, "retain-success", "3"), 10),
      retainRecentFailure: Number.parseInt(getOption(options, "retain-failure", "5"), 10),
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
      "  node cli.js reject-patch --state-id default --reason \"...\"",
      "  node cli.js resume --state-id default",
      "  node cli.js workspace:cleanup --state-id default --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js artifacts:prune --state-id default --retain-success 3 --retain-failure 5",
      "  node cli.js live-smoke --enabled true --workspace-root .tmp/orchestrator-workspaces",
      "  node cli.js review --state-id default",
      "  node cli.js dry-run --state-id default --executor mock",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
