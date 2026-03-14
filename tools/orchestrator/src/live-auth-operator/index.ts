import type { StatusReportingAdapter, GitHubReportPermissionSmokeResult } from "../status-reporting";
import { runGitHubReportPermissionSmoke } from "../status-reporting";
import type { OrchestratorState } from "../schemas";
import { orchestratorStateSchema } from "../schemas";
import { runGitHubLiveAuthSmoke } from "../github-live-auth";
import { selectGitHubLiveSmokeTarget, type RequestedGitHubSandboxTarget } from "../github-live-targets";
import { resolveGitHubSandboxTarget, type LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import { listSandboxAuditRecords } from "../sandbox-audit";
import { evaluateSandboxGuardrails } from "../sandbox-governance";
import { evaluateSandboxBundleGovernance } from "../sandbox-bundle-governance";

export type LiveAuthOperatorFlowResult = {
  readinessStatus: "ready" | "degraded" | "blocked" | "manual_required";
  selectedSandboxProfileId: string | null;
  sandboxProfileSelectionMode: "explicit" | "default" | "fallback" | "blocked";
  sandboxProfileSelectionReason: string;
  targetSummary: string;
  permissionSummary: string;
  suggestedNextAction: string;
  selection:
    | ReturnType<typeof selectGitHubLiveSmokeTarget>
    | null;
  registryResolution: ReturnType<typeof resolveGitHubSandboxTarget>;
  permissionSmoke: GitHubReportPermissionSmokeResult | null;
  smokeExecution: Awaited<ReturnType<typeof runGitHubLiveAuthSmoke>> | null;
  state: OrchestratorState;
  summaryText: string;
};

function applyTargetToState(state: OrchestratorState, selection: ReturnType<typeof selectGitHubLiveSmokeTarget>) {
  const target = selection.target;
  return orchestratorStateSchema.parse({
    ...state,
    sourceEventSummary:
      target.repository && target.targetType && target.targetNumber
        ? {
            repository: target.repository,
            branch: state.sourceEventSummary?.branch ?? null,
            issueNumber: target.targetType === "issue" ? target.targetNumber : null,
            prNumber: target.targetType === "pull_request" ? target.targetNumber : null,
            commentId: target.commentId,
            label: state.sourceEventSummary?.label ?? null,
            headSha: state.sourceEventSummary?.headSha ?? null,
            command: state.sourceEventSummary?.command ?? null,
            triggerReason: `github_auth_operator:${target.repository}#${target.targetNumber}`,
          }
        : state.sourceEventSummary,
    selectedSandboxProfileId: state.selectedSandboxProfileId,
    sandboxProfileSelectionMode: state.sandboxProfileSelectionMode,
    sandboxProfileSelectionReason: state.sandboxProfileSelectionReason,
  });
}

function applySelectionMetadata(
  state: OrchestratorState,
  loadedRegistry: LoadedGitHubSandboxTargetRegistry | null,
  registryResolution: ReturnType<typeof resolveGitHubSandboxTarget>,
  selection: ReturnType<typeof selectGitHubLiveSmokeTarget> | null,
) {
  const selectedProfile =
    loadedRegistry && registryResolution.profileId
      ? loadedRegistry.registry.profiles[registryResolution.profileId] ?? null
      : null;
  const bundleGovernance =
    selectedProfile?.bundleId && loadedRegistry
      ? evaluateSandboxBundleGovernance({
          loadedRegistry,
          bundleId: selectedProfile.bundleId,
          profileId: registryResolution.profileId,
          intendedUse: "live_smoke",
        })
      : null;
  return orchestratorStateSchema.parse({
    ...state,
    selectedSandboxProfileId: registryResolution.profileId,
    sandboxProfileSelectionMode: registryResolution.selectionMode,
    sandboxProfileSelectionReason: registryResolution.selectionReason,
    sandboxProfileId: registryResolution.profileId,
    sandboxProfileStatus:
      registryResolution.status === "resolved"
        ? "resolved"
        : registryResolution.status === "blocked"
          ? "blocked"
          : "manual_required",
    sandboxBundleId: selectedProfile?.bundleId ?? state.sandboxBundleId,
    sandboxBundleOverrideFields: selectedProfile?.overrideFields ?? state.sandboxBundleOverrideFields,
    sandboxTargetProfileId: registryResolution.profileId,
    sandboxTargetConfigVersion: loadedRegistry?.version ?? state.sandboxTargetConfigVersion,
    lastLiveSmokeTarget: selection?.target ?? state.lastLiveSmokeTarget,
    profileGovernanceStatus: state.profileGovernanceStatus,
    profileGovernanceReason: state.profileGovernanceReason,
    profileGovernanceSuggestedNextAction: state.profileGovernanceSuggestedNextAction,
    bundleGovernanceStatus: bundleGovernance?.status ?? state.bundleGovernanceStatus,
    bundleGovernanceReason: bundleGovernance?.reason?.summary ?? state.bundleGovernanceReason,
    bundleGovernanceSuggestedNextAction:
      bundleGovernance?.reason?.suggestedNextAction ?? state.bundleGovernanceSuggestedNextAction,
    lastSandboxAuditId: state.lastSandboxAuditId,
    lastSandboxGuardrailsStatus: state.lastSandboxGuardrailsStatus,
    lastSandboxGuardrailsReason: state.lastSandboxGuardrailsReason,
    lastSandboxGuardrailsSuggestedNextAction: state.lastSandboxGuardrailsSuggestedNextAction,
    recentSandboxAuditSummaries: state.recentSandboxAuditSummaries,
  });
}

export async function runLiveAuthOperatorFlow(params: {
  state: OrchestratorState;
  outputRoot: string;
  adapter: StatusReportingAdapter;
  enabled: boolean;
  token: string | null;
  sandboxRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  sandboxProfileId?: string | null;
  requestedTarget?: RequestedGitHubSandboxTarget | null;
  execute?: boolean;
  execFileImpl?: (
    file: string,
    args: readonly string[],
    options?: {
      windowsHide?: boolean;
    },
  ) => Promise<{
    stdout: string;
    stderr: string;
  }>;
}) {
  const registryResolution = resolveGitHubSandboxTarget({
    state: params.state,
    loadedRegistry: params.sandboxRegistry ?? null,
    requestedTarget: params.requestedTarget ?? null,
    requestedProfileId: params.sandboxProfileId ?? null,
  });

  const selection =
    registryResolution.status === "resolved"
      ? selectGitHubLiveSmokeTarget({
          state: params.state,
          requestedTarget: registryResolution.requestedTarget,
        })
      : null;

  let stateWithSelection = applySelectionMetadata(params.state, params.sandboxRegistry ?? null, registryResolution, selection);
  const guardrails =
    registryResolution.status === "resolved"
      ? evaluateSandboxGuardrails({
          state: stateWithSelection,
          loadedRegistry: params.sandboxRegistry ?? null,
          selectedProfileId: registryResolution.profileId,
          selectionMode: registryResolution.selectionMode,
          selectionReason: registryResolution.selectionReason,
        })
      : null;
  const recentSandboxAudit =
    params.sandboxRegistry?.path
      ? await listSandboxAuditRecords({
          configPath: params.sandboxRegistry.path,
          limit: 5,
        })
      : null;
  const recentSandboxAuditSummaries = recentSandboxAudit?.records.map((record) => `${record.changedAt} ${record.action} ${record.profileId ?? "none"}`) ?? [];
  stateWithSelection = orchestratorStateSchema.parse({
    ...stateWithSelection,
    profileGovernanceStatus: guardrails?.status ?? stateWithSelection.profileGovernanceStatus,
    profileGovernanceReason: guardrails?.reason?.summary ?? stateWithSelection.profileGovernanceReason,
    profileGovernanceSuggestedNextAction:
      guardrails?.reason?.suggestedNextAction ?? stateWithSelection.profileGovernanceSuggestedNextAction,
    lastSandboxGuardrailsStatus: guardrails?.status ?? stateWithSelection.lastSandboxGuardrailsStatus,
    lastSandboxGuardrailsReason: guardrails?.reason?.summary ?? stateWithSelection.lastSandboxGuardrailsReason,
    lastSandboxGuardrailsSuggestedNextAction:
      guardrails?.reason?.suggestedNextAction ?? stateWithSelection.lastSandboxGuardrailsSuggestedNextAction,
    lastSandboxAuditId: recentSandboxAudit?.records[0]?.id ?? stateWithSelection.lastSandboxAuditId,
    recentSandboxAuditSummaries,
  });

  const permissionSmoke =
    selection &&
    selection.status !== "blocked" &&
    selection.status !== "manual_required" &&
    guardrails?.status === "ready"
      ? await runGitHubReportPermissionSmoke({
          state: applyTargetToState(stateWithSelection, selection),
          enabled: params.enabled,
          token: params.token,
          execFileImpl: params.execFileImpl,
        })
      : null;

  const shouldExecute =
    params.execute !== false &&
    registryResolution.status === "resolved" &&
    selection !== null &&
    selection.status !== "blocked" &&
    selection.status !== "manual_required" &&
    guardrails?.status === "ready" &&
    permissionSmoke?.status === "ready";

  const smokeExecution = shouldExecute
    ? await runGitHubLiveAuthSmoke({
        state: stateWithSelection,
        outputRoot: params.outputRoot,
        adapter: params.adapter,
        enabled: params.enabled,
        token: params.token,
        sandboxRegistry: params.sandboxRegistry ?? null,
        sandboxProfileId: params.sandboxProfileId ?? null,
        requestedTarget: params.requestedTarget ?? null,
        execFileImpl: params.execFileImpl,
      })
    : null;

  const finalState = smokeExecution?.state ?? stateWithSelection;
  const readinessStatus =
    smokeExecution?.result.status === "passed"
      ? "ready"
      : guardrails?.status === "blocked"
        ? "blocked"
        : guardrails?.status === "manual_required"
          ? "manual_required"
          : registryResolution.status === "blocked"
            ? "blocked"
            : registryResolution.status === "manual_required"
              ? "manual_required"
              : permissionSmoke?.status === "blocked"
                ? "blocked"
                : permissionSmoke?.status === "degraded"
                  ? "degraded"
                  : "ready";
  const targetSummary = selection
    ? `${selection.target.targetType ?? "none"} ${selection.target.repository ?? "none"}#${selection.target.targetNumber ?? "none"} / action=${selection.attemptedAction}`
    : "none";
  const permissionSummary = permissionSmoke
    ? `${permissionSmoke.status} / ${permissionSmoke.permissionStatus} / ${permissionSmoke.targetStrategy}`
    : guardrails
      ? `${guardrails.status} / ${guardrails.reason?.code ?? "guardrails_passed"} / guardrails`
      : registryResolution.status === "resolved"
        ? "not_run"
        : registryResolution.status;
  const suggestedNextAction =
    smokeExecution?.result.suggestedNextAction ??
    guardrails?.reason?.suggestedNextAction ??
    permissionSmoke?.suggestedNextAction ??
    registryResolution.suggestedNextAction;

  const summaryText = [
    `Live auth operator flow: ${readinessStatus}`,
    `Selected sandbox profile: ${registryResolution.profileId ?? "none"} / mode=${registryResolution.selectionMode}`,
    `Selection reason: ${registryResolution.selectionReason}`,
    `Guardrails: ${guardrails?.status ?? "not_run"} / ${guardrails?.reason?.code ?? "none"}`,
    `Target: ${targetSummary}`,
    `Permission: ${permissionSummary}`,
    `Executed: ${smokeExecution ? `${smokeExecution.result.status} / ${smokeExecution.result.attemptedAction}` : "no"}`,
    `Recent sandbox audit: ${recentSandboxAuditSummaries[recentSandboxAuditSummaries.length - 1] ?? "none"}`,
    `Next action: ${suggestedNextAction}`,
  ].join("\n");

  return {
    readinessStatus,
    selectedSandboxProfileId: registryResolution.profileId,
    sandboxProfileSelectionMode: registryResolution.selectionMode,
    sandboxProfileSelectionReason: registryResolution.selectionReason,
    targetSummary,
    permissionSummary,
    suggestedNextAction,
    selection,
    registryResolution,
    permissionSmoke,
    smokeExecution,
    state: finalState,
    summaryText,
  } satisfies LiveAuthOperatorFlowResult;
}
