import {
  githubSandboxTargetProfileSchema,
  type GitHubSandboxActionPolicy,
  type GitHubSandboxTargetRegistry,
  type OrchestratorState,
} from "../schemas";
import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import { evaluateSandboxBundleGovernance } from "../sandbox-bundle-governance";
import { buildSandboxRegistryDiff, reviewSandboxRegistryChange, applySandboxRegistryChange } from "../sandbox-change-review";
import { buildSandboxImpactSummary, type SandboxImpactSummary } from "../sandbox-impact-summary";
import { applySandboxPolicyBundle } from "../sandbox-policy-bundles";
import { cloneSandboxRegistry } from "../sandbox-profile-lifecycle";

export type SandboxBatchChangeStatus =
  | "previewed"
  | "validated"
  | "applied"
  | "partially_applied"
  | "blocked"
  | "manual_required"
  | "failed";

export type SandboxBatchProfileDecision = {
  profileId: string;
  status: "ready" | "blocked" | "manual_required";
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  changedFields: string[];
};

export type SandboxBatchChangeResult = {
  status: SandboxBatchChangeStatus;
  mode: "preview" | "validate" | "apply";
  affectedProfileIds: string[];
  blockedProfileIds: string[];
  manualRequiredProfileIds: string[];
  diffSummary: string[];
  impactSummary: SandboxImpactSummary;
  profileDecisions: SandboxBatchProfileDecision[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  governanceStatus: "ready" | "blocked" | "manual_required";
  guardrailsStatus: "ready" | "blocked" | "manual_required";
  proposedRegistry: GitHubSandboxTargetRegistry | null;
  appliedRegistry: GitHubSandboxTargetRegistry | null;
};

type BatchProfileChanges = {
  repository?: string;
  targetType?: "issue" | "pull_request";
  targetNumber?: number;
  actionPolicy?: GitHubSandboxActionPolicy;
  enabled?: boolean;
  notes?: string | null;
};

function mergeProfileChanges(params: {
  current: GitHubSandboxTargetRegistry["profiles"][string];
  bundleId: string | null;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  changes: BatchProfileChanges;
}) {
  if (params.bundleId) {
    return applySandboxPolicyBundle({
      loadedRegistry: params.loadedRegistry,
      bundleId: params.bundleId,
      existingProfile: params.current,
      overrides: params.changes,
    });
  }
  return {
    status: "resolved" as const,
    bundleId: params.current.bundleId,
    source: "none" as const,
    profile: githubSandboxTargetProfileSchema.parse({
      ...params.current,
      ...params.changes,
    }),
    overrideFields: params.current.overrideFields,
    summary: "Sandbox profile changes resolved successfully.",
    failureReason: null,
    suggestedNextAction: "Review the sandbox profile diff before applying the batch change.",
  };
}

function classifyProfileFailure(
  profileId: string,
  status: "blocked" | "manual_required",
  summary: string,
  failureReason: string | null,
  suggestedNextAction: string,
) {
  return {
    profileId,
    status,
    summary,
    failureReason,
    suggestedNextAction,
    changedFields: [],
  } satisfies SandboxBatchProfileDecision;
}

export async function runSandboxBatchChange(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  profileIds: string[];
  bundleId?: string | null;
  changes?: BatchProfileChanges;
  mode: "preview" | "validate" | "apply";
  allowPartial?: boolean;
  actorSource: string;
  commandSource?: string | null;
}) {
  const requestedProfileIds = Array.from(new Set(params.profileIds.map((value) => value.trim()).filter(Boolean))).sort();
  if (requestedProfileIds.length === 0) {
    const impactSummary = buildSandboxImpactSummary({
      diffs: [],
      affectedProfileIds: [],
    });
    return {
      status: "manual_required",
      mode: params.mode,
      affectedProfileIds: [],
      blockedProfileIds: [],
      manualRequiredProfileIds: [],
      diffSummary: [],
      impactSummary,
      profileDecisions: [],
      summary: "Sandbox batch change requires at least one selected profile.",
      failureReason: "sandbox_batch_profiles_required",
      suggestedNextAction: "Pass one or more sandbox profile ids to batch preview/validate/apply.",
      governanceStatus: "manual_required",
      guardrailsStatus: "manual_required",
      proposedRegistry: null,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  const currentRegistry = cloneSandboxRegistry(params.loadedRegistry.registry);
  const proposedRegistry = cloneSandboxRegistry(params.loadedRegistry.registry);
  const partialRegistry = cloneSandboxRegistry(params.loadedRegistry.registry);
  const profileDecisions: SandboxBatchProfileDecision[] = [];
  const readyProfileIds: string[] = [];

  for (const profileId of requestedProfileIds) {
    const currentProfile = currentRegistry.profiles[profileId];
    if (!currentProfile) {
      profileDecisions.push(
        classifyProfileFailure(
          profileId,
          "manual_required",
          `Sandbox profile '${profileId}' does not exist.`,
          "sandbox_profile_missing",
          "Create the sandbox profile first or remove it from the batch selection.",
        ),
      );
      continue;
    }

    if (params.bundleId) {
      const bundleGovernance = evaluateSandboxBundleGovernance({
        loadedRegistry: params.loadedRegistry,
        bundleId: params.bundleId,
        profileId,
        intendedUse: currentRegistry.defaultProfileId === profileId ? "default" : "apply",
      });
      if (bundleGovernance.status !== "ready") {
        profileDecisions.push(
          classifyProfileFailure(
            profileId,
            bundleGovernance.status,
            bundleGovernance.summary,
            bundleGovernance.reason?.code ?? "sandbox_bundle_governance_failed",
            bundleGovernance.reason?.suggestedNextAction ?? "Fix bundle governance before batch apply.",
          ),
        );
        continue;
      }
    }

    const resolved = mergeProfileChanges({
      current: currentProfile,
      bundleId: params.bundleId ?? null,
      loadedRegistry: params.loadedRegistry,
      changes: params.changes ?? {},
    });
    if (resolved.status !== "resolved" || !resolved.profile) {
      profileDecisions.push(
        classifyProfileFailure(
          profileId,
          "manual_required",
          resolved.summary,
          resolved.failureReason,
          resolved.suggestedNextAction,
        ),
      );
      continue;
    }

    proposedRegistry.profiles[profileId] = resolved.profile;
    partialRegistry.profiles[profileId] = resolved.profile;
    readyProfileIds.push(profileId);
    profileDecisions.push({
      profileId,
      status: "ready",
      summary: `Sandbox profile '${profileId}' is ready for batch ${params.mode}.`,
      failureReason: null,
      suggestedNextAction: "Review the batch impact summary before applying the change set.",
      changedFields: [],
    });
  }

  const blockedProfileIds = profileDecisions.filter((item) => item.status === "blocked").map((item) => item.profileId);
  const manualRequiredProfileIds = profileDecisions.filter((item) => item.status === "manual_required").map((item) => item.profileId);

  const activeProposedRegistry =
    params.allowPartial && readyProfileIds.length > 0 && blockedProfileIds.length + manualRequiredProfileIds.length > 0
      ? partialRegistry
      : proposedRegistry;
  const diffs = buildSandboxRegistryDiff(currentRegistry, activeProposedRegistry);
  const impactSummary = buildSandboxImpactSummary({
    diffs,
    affectedProfileIds: requestedProfileIds,
    blockedProfileIds,
    manualRequiredProfileIds,
    defaultProfileId: currentRegistry.defaultProfileId,
  });

  if (readyProfileIds.length === 0) {
    return {
      status: blockedProfileIds.length > 0 ? "blocked" : "manual_required",
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary: "Sandbox batch change could not prepare any valid profile updates.",
      failureReason: blockedProfileIds.length > 0 ? "sandbox_batch_blocked" : "sandbox_batch_manual_required",
      suggestedNextAction: "Fix the blocked/manual_required profiles before retrying the batch change.",
      governanceStatus: blockedProfileIds.length > 0 ? "blocked" : "manual_required",
      guardrailsStatus: blockedProfileIds.length > 0 ? "blocked" : "manual_required",
      proposedRegistry: null,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  const review = await reviewSandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry: activeProposedRegistry,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
    recordAudit: params.mode === "validate",
  });

  if (params.mode === "preview") {
    return {
      status: "previewed",
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary:
        blockedProfileIds.length + manualRequiredProfileIds.length > 0
          ? `Sandbox batch preview prepared ${readyProfileIds.length} change(s) and flagged ${blockedProfileIds.length + manualRequiredProfileIds.length} profile(s).`
          : `Sandbox batch preview prepared ${readyProfileIds.length} safe change(s).`,
      failureReason: review.failureReason,
      suggestedNextAction:
        blockedProfileIds.length + manualRequiredProfileIds.length > 0
          ? "Resolve blocked/manual_required profiles or re-run with --allow-partial true if partial apply is intended."
          : "Run sandbox:batch:validate or sandbox:batch:apply after reviewing the impact summary.",
      governanceStatus: review.governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      proposedRegistry: activeProposedRegistry,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  if (review.status !== "ready") {
    return {
      status: review.status,
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary: review.summary,
      failureReason: review.failureReason,
      suggestedNextAction: review.suggestedNextAction,
      governanceStatus: review.governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      proposedRegistry: activeProposedRegistry,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  if (params.mode === "validate") {
    return {
      status: "validated",
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary:
        blockedProfileIds.length + manualRequiredProfileIds.length > 0
          ? `Sandbox batch validation passed for ${readyProfileIds.length} profile(s); ${blockedProfileIds.length + manualRequiredProfileIds.length} profile(s) still require operator attention.`
          : `Sandbox batch validation passed for ${readyProfileIds.length} profile(s).`,
      failureReason: null,
      suggestedNextAction:
        blockedProfileIds.length + manualRequiredProfileIds.length > 0
          ? "Fix the blocked/manual_required profiles or re-run with --allow-partial true before apply."
          : "Run sandbox:batch:apply when you are ready to persist the validated batch change.",
      governanceStatus: review.governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      proposedRegistry: activeProposedRegistry,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  if (!params.allowPartial && (blockedProfileIds.length > 0 || manualRequiredProfileIds.length > 0)) {
    return {
      status: blockedProfileIds.length > 0 ? "blocked" : "manual_required",
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary: "Sandbox batch apply stopped because allowPartial is disabled and some profiles were blocked/manual_required.",
      failureReason: blockedProfileIds.length > 0 ? "sandbox_batch_apply_blocked" : "sandbox_batch_apply_manual_required",
      suggestedNextAction: "Fix the flagged profiles or re-run with --allow-partial true if partial apply is acceptable.",
      governanceStatus: review.governanceStatus,
      guardrailsStatus: review.guardrailsStatus,
      proposedRegistry: activeProposedRegistry,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  const applied = await applySandboxRegistryChange({
    configPath: params.configPath,
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    proposedRegistry: activeProposedRegistry,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
  });

  if (applied.status !== "ready" || !applied.appliedRegistry) {
    return {
      status: applied.status,
      mode: params.mode,
      affectedProfileIds: requestedProfileIds,
      blockedProfileIds,
      manualRequiredProfileIds,
      diffSummary: diffs.map((item) => item.summary),
      impactSummary,
      profileDecisions,
      summary: applied.summary,
      failureReason: applied.failureReason,
      suggestedNextAction: applied.suggestedNextAction,
      governanceStatus: applied.governanceStatus,
      guardrailsStatus: applied.guardrailsStatus,
      proposedRegistry: activeProposedRegistry,
      appliedRegistry: null,
    } satisfies SandboxBatchChangeResult;
  }

  return {
    status: blockedProfileIds.length > 0 || manualRequiredProfileIds.length > 0 ? "partially_applied" : "applied",
    mode: params.mode,
    affectedProfileIds: requestedProfileIds,
    blockedProfileIds,
    manualRequiredProfileIds,
    diffSummary: diffs.map((item) => item.summary),
    impactSummary,
    profileDecisions,
    summary:
      blockedProfileIds.length > 0 || manualRequiredProfileIds.length > 0
        ? `Sandbox batch apply partially applied ${readyProfileIds.length} profile(s) and left ${blockedProfileIds.length + manualRequiredProfileIds.length} profile(s) unchanged.`
        : `Sandbox batch apply completed for ${readyProfileIds.length} profile(s).`,
    failureReason: null,
    suggestedNextAction:
      blockedProfileIds.length > 0 || manualRequiredProfileIds.length > 0
        ? "Review the blocked/manual_required profiles before the next batch apply."
        : "Run sandbox governance or diagnostics if you want a post-apply verification.",
    governanceStatus: applied.governanceStatus,
    guardrailsStatus: applied.guardrailsStatus,
    proposedRegistry: activeProposedRegistry,
    appliedRegistry: applied.appliedRegistry,
  } satisfies SandboxBatchChangeResult;
}
