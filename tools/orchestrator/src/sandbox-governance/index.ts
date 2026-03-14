import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type {
  BlockedReason,
  GitHubSandboxActionPolicy,
  GitHubSandboxTargetProfile,
  OrchestratorState,
} from "../schemas";

export type SandboxGovernanceDecision = {
  status: "ready" | "blocked" | "manual_required";
  profileId: string | null;
  reason: BlockedReason | null;
  summary: string;
  invalidProfileIds: string[];
  disabledProfileIds: string[];
};

export type SandboxGuardrailsDecision = {
  status: "ready" | "blocked" | "manual_required";
  profileId: string | null;
  summary: string;
  reason: BlockedReason | null;
  selectedProfileId: string | null;
  selectionMode: OrchestratorState["sandboxProfileSelectionMode"];
  invalidProfileIds: string[];
  disabledProfileIds: string[];
};

function buildReason(params: {
  code: string;
  summary: string;
  missingPrerequisites?: string[];
  recoverable?: boolean;
  suggestedNextAction: string;
}): BlockedReason {
  return {
    code: params.code,
    summary: params.summary,
    missingPrerequisites: params.missingPrerequisites ?? [],
    recoverable: params.recoverable ?? true,
    suggestedNextAction: params.suggestedNextAction,
  };
}

function isAllowed<T extends string>(allowed: T[], value: T) {
  return allowed.length === 0 || allowed.includes(value);
}

function evaluateProfileRule(params: {
  profileId: string;
  profile: GitHubSandboxTargetProfile;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  requireDefaultSafePolicy: boolean;
}) {
  const { profileId, profile, loadedRegistry, requireDefaultSafePolicy } = params;
  const governance = loadedRegistry.registry.governance;
  if (profile.enabled === false) {
    return buildReason({
      code: "sandbox_profile_disabled",
      summary: `Sandbox profile '${profileId}' is disabled.`,
      missingPrerequisites: [`Enable sandbox profile '${profileId}'`],
      suggestedNextAction: "Enable the sandbox profile before using it for live smoke.",
    });
  }
  if (!isAllowed(governance.allowedRepositories, profile.repository)) {
    return buildReason({
      code: "sandbox_profile_repository_not_allowed",
      summary: `Sandbox profile '${profileId}' targets repository '${profile.repository}', which is not allowed by sandbox governance.`,
      missingPrerequisites: [`Add '${profile.repository}' to sandbox governance allow-list`],
      suggestedNextAction: "Update sandbox governance allowedRepositories or choose an approved sandbox repository.",
    });
  }
  if (!isAllowed(governance.allowedTargetTypes, profile.targetType)) {
    return buildReason({
      code: "sandbox_profile_target_type_not_allowed",
      summary: `Sandbox profile '${profileId}' uses target type '${profile.targetType}', which is blocked by sandbox governance.`,
      missingPrerequisites: [`Allow target type '${profile.targetType}' or change the profile target type`],
      suggestedNextAction: "Update sandbox governance allowedTargetTypes or choose an allowed target type.",
    });
  }
  if (!isAllowed(governance.allowedActionPolicies, profile.actionPolicy)) {
    return buildReason({
      code: "sandbox_profile_action_policy_not_allowed",
      summary: `Sandbox profile '${profileId}' uses action policy '${profile.actionPolicy}', which is blocked by sandbox governance.`,
      missingPrerequisites: [`Allow action policy '${profile.actionPolicy}' or change the profile action policy`],
      suggestedNextAction: "Update sandbox governance allowedActionPolicies or switch the sandbox profile to a safe action policy.",
    });
  }
  if (requireDefaultSafePolicy && !isAllowed(governance.defaultAllowedActionPolicies, profile.actionPolicy)) {
    return buildReason({
      code: "sandbox_default_profile_not_safe",
      summary: `Sandbox profile '${profileId}' cannot become the default because action policy '${profile.actionPolicy}' is not allowed for default profiles.`,
      missingPrerequisites: [`Change action policy for '${profileId}' or update defaultAllowedActionPolicies`],
      suggestedNextAction: "Use create_or_update or create_only for the default sandbox profile, or adjust governance if that is intentional.",
    });
  }
  return null;
}

export function inspectSandboxGovernance(loadedRegistry: LoadedGitHubSandboxTargetRegistry) {
  const invalidProfileIds: string[] = [];
  const disabledProfileIds: string[] = [];
  for (const [profileId, profile] of Object.entries(loadedRegistry.registry.profiles)) {
    if (profile.enabled === false) {
      disabledProfileIds.push(profileId);
    }
    const violation = evaluateProfileRule({
      profileId,
      profile,
      loadedRegistry,
      requireDefaultSafePolicy: loadedRegistry.registry.defaultProfileId === profileId,
    });
    if (violation) {
      invalidProfileIds.push(profileId);
    }
  }
  return {
    invalidProfileIds,
    disabledProfileIds,
  };
}

export function evaluateSandboxProfileGovernance(params: {
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  profileId: string | null;
  requireDefaultSafePolicy?: boolean;
}) {
  const { invalidProfileIds, disabledProfileIds } = inspectSandboxGovernance(params.loadedRegistry);
  if (!params.profileId) {
    const reason = buildReason({
      code: "sandbox_profile_required",
      summary: "Sandbox governance requires a selected sandbox profile before live smoke can run.",
      missingPrerequisites: ["selected sandbox profile"],
      suggestedNextAction: "Choose an explicit sandbox profile, set a default sandbox profile, or configure a repository-matched fallback profile.",
    });
    return {
      status: "manual_required",
      profileId: null,
      reason,
      summary: reason.summary,
      invalidProfileIds,
      disabledProfileIds,
    } satisfies SandboxGovernanceDecision;
  }

  const profile = params.loadedRegistry.registry.profiles[params.profileId];
  if (!profile) {
    const reason = buildReason({
      code: "sandbox_profile_missing",
      summary: `Sandbox profile '${params.profileId}' does not exist.`,
      missingPrerequisites: [`sandbox profile '${params.profileId}'`],
      suggestedNextAction: "Create the sandbox profile first or choose an existing profile.",
    });
    return {
      status: "manual_required",
      profileId: params.profileId,
      reason,
      summary: reason.summary,
      invalidProfileIds,
      disabledProfileIds,
    } satisfies SandboxGovernanceDecision;
  }

  const violation = evaluateProfileRule({
    profileId: params.profileId,
    profile,
    loadedRegistry: params.loadedRegistry,
    requireDefaultSafePolicy: params.requireDefaultSafePolicy ?? params.loadedRegistry.registry.defaultProfileId === params.profileId,
  });
  if (violation) {
    return {
      status: violation.code === "sandbox_profile_disabled" ? "blocked" : "manual_required",
      profileId: params.profileId,
      reason: violation,
      summary: violation.summary,
      invalidProfileIds,
      disabledProfileIds,
    } satisfies SandboxGovernanceDecision;
  }

  return {
    status: "ready",
    profileId: params.profileId,
    reason: null,
    summary: `Sandbox profile '${params.profileId}' passed governance checks.`,
    invalidProfileIds,
    disabledProfileIds,
  } satisfies SandboxGovernanceDecision;
}

export function evaluateSandboxGuardrails(params: {
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry | null;
  selectedProfileId: string | null;
  selectionMode: OrchestratorState["sandboxProfileSelectionMode"];
  selectionReason: string;
}) {
  if (!params.loadedRegistry) {
    const reason = buildReason({
      code: "sandbox_registry_required",
      summary: "Sandbox guardrails require a registry-backed sandbox profile before live smoke can run.",
      missingPrerequisites: ["sandbox target registry"],
      suggestedNextAction: "Configure a sandbox registry file and select a governed sandbox profile before running live smoke.",
    });
    return {
      status: "manual_required",
      profileId: null,
      summary: reason.summary,
      reason,
      selectedProfileId: null,
      selectionMode: params.selectionMode,
      invalidProfileIds: [],
      disabledProfileIds: [],
    } satisfies SandboxGuardrailsDecision;
  }

  const governance = evaluateSandboxProfileGovernance({
    loadedRegistry: params.loadedRegistry,
    profileId: params.selectedProfileId,
    requireDefaultSafePolicy: params.selectionMode === "default",
  });
  if (governance.status !== "ready") {
    return {
      status: governance.status,
      profileId: governance.profileId,
      summary: `${params.selectionReason} Guardrails blocked live smoke: ${governance.summary}`,
      reason: governance.reason,
      selectedProfileId: params.selectedProfileId,
      selectionMode: params.selectionMode,
      invalidProfileIds: governance.invalidProfileIds,
      disabledProfileIds: governance.disabledProfileIds,
    } satisfies SandboxGuardrailsDecision;
  }

  return {
    status: "ready",
    profileId: params.selectedProfileId,
    summary: `Sandbox guardrails passed for profile '${params.selectedProfileId}'.`,
    reason: null,
    selectedProfileId: params.selectedProfileId,
    selectionMode: params.selectionMode,
    invalidProfileIds: governance.invalidProfileIds,
    disabledProfileIds: governance.disabledProfileIds,
  } satisfies SandboxGuardrailsDecision;
}

export function formatSandboxGovernanceSummary(decision: SandboxGovernanceDecision) {
  return [
    `Sandbox governance: ${decision.status}`,
    `Profile: ${decision.profileId ?? "none"}`,
    `Summary: ${decision.summary}`,
    `Reason: ${decision.reason?.code ?? "none"}`,
    `Next action: ${decision.reason?.suggestedNextAction ?? "none"}`,
    `Disabled profiles: ${decision.disabledProfileIds.join(", ") || "none"}`,
    `Invalid profiles: ${decision.invalidProfileIds.join(", ") || "none"}`,
  ].join("\n");
}

export function formatSandboxGuardrailsSummary(decision: SandboxGuardrailsDecision) {
  return [
    `Sandbox guardrails: ${decision.status}`,
    `Selected profile: ${decision.selectedProfileId ?? "none"} / mode=${decision.selectionMode}`,
    `Summary: ${decision.summary}`,
    `Reason: ${decision.reason?.code ?? "none"}`,
    `Next action: ${decision.reason?.suggestedNextAction ?? "none"}`,
    `Disabled profiles: ${decision.disabledProfileIds.join(", ") || "none"}`,
    `Invalid profiles: ${decision.invalidProfileIds.join(", ") || "none"}`,
  ].join("\n");
}
