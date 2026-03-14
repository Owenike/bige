import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { BlockedReason } from "../schemas";
import { showSandboxPolicyBundle } from "../sandbox-policy-bundles";

export type SandboxBundleGovernanceDecision = {
  status: "ready" | "blocked" | "manual_required";
  bundleId: string | null;
  reason: BlockedReason | null;
  summary: string;
  invalidBundleIds: string[];
  disabledBundleIds: string[];
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

export function inspectSandboxBundleGovernance(loadedRegistry: LoadedGitHubSandboxTargetRegistry) {
  const invalidBundleIds: string[] = [];
  const disabledBundleIds: string[] = [];
  for (const [bundleId, bundle] of Object.entries(loadedRegistry.registry.bundles)) {
    if (bundle.enabled === false) {
      disabledBundleIds.push(bundleId);
      invalidBundleIds.push(bundleId);
      continue;
    }
    if (bundle.allowAsDefault === false && loadedRegistry.registry.defaultProfileId) {
      const defaultProfile = loadedRegistry.registry.profiles[loadedRegistry.registry.defaultProfileId];
      if (defaultProfile?.bundleId === bundleId) {
        invalidBundleIds.push(bundleId);
      }
    }
  }
  return {
    invalidBundleIds: Array.from(new Set(invalidBundleIds)).sort(),
    disabledBundleIds: Array.from(new Set(disabledBundleIds)).sort(),
  };
}

export function evaluateSandboxBundleGovernance(params: {
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  bundleId: string | null;
  profileId?: string | null;
  intendedUse?: "apply" | "default" | "live_smoke";
}) {
  const inspection = inspectSandboxBundleGovernance(params.loadedRegistry);
  if (!params.bundleId) {
    const reason = buildReason({
      code: "sandbox_bundle_required",
      summary: "Sandbox bundle governance requires a selected bundle.",
      missingPrerequisites: ["sandbox bundle"],
      suggestedNextAction: "Choose a sandbox bundle before applying bundle governance checks.",
    });
    return {
      status: "manual_required",
      bundleId: null,
      reason,
      summary: reason.summary,
      invalidBundleIds: inspection.invalidBundleIds,
      disabledBundleIds: inspection.disabledBundleIds,
    } satisfies SandboxBundleGovernanceDecision;
  }

  const bundle = showSandboxPolicyBundle(params.loadedRegistry, params.bundleId);
  if (!bundle) {
    const reason = buildReason({
      code: "sandbox_bundle_missing",
      summary: `Sandbox bundle '${params.bundleId}' does not exist.`,
      missingPrerequisites: [`sandbox bundle '${params.bundleId}'`],
      suggestedNextAction: "Choose an existing built-in or registry-defined sandbox bundle.",
    });
    return {
      status: "manual_required",
      bundleId: params.bundleId,
      reason,
      summary: reason.summary,
      invalidBundleIds: inspection.invalidBundleIds,
      disabledBundleIds: inspection.disabledBundleIds,
    } satisfies SandboxBundleGovernanceDecision;
  }

  if (bundle.enabled === false) {
    const reason = buildReason({
      code: "sandbox_bundle_disabled",
      summary: `Sandbox bundle '${params.bundleId}' is disabled.`,
      missingPrerequisites: [`Enable sandbox bundle '${params.bundleId}'`],
      suggestedNextAction: "Enable the sandbox bundle or choose a different bundle.",
    });
    return {
      status: "blocked",
      bundleId: params.bundleId,
      reason,
      summary: reason.summary,
      invalidBundleIds: inspection.invalidBundleIds,
      disabledBundleIds: inspection.disabledBundleIds,
    } satisfies SandboxBundleGovernanceDecision;
  }

  const intendedUse = params.intendedUse ?? "apply";
  if (intendedUse === "default" && bundle.allowAsDefault === false) {
    const reason = buildReason({
      code: "sandbox_bundle_default_not_allowed",
      summary: `Sandbox bundle '${params.bundleId}' cannot be used for a default sandbox profile.`,
      missingPrerequisites: [`Choose a default-safe bundle instead of '${params.bundleId}'`],
      suggestedNextAction: "Use a bundle with allowAsDefault=true or keep the current default profile unchanged.",
    });
    return {
      status: "manual_required",
      bundleId: params.bundleId,
      reason,
      summary: reason.summary,
      invalidBundleIds: inspection.invalidBundleIds,
      disabledBundleIds: inspection.disabledBundleIds,
    } satisfies SandboxBundleGovernanceDecision;
  }

  if (intendedUse === "live_smoke" && bundle.allowLiveSmoke === false) {
    const reason = buildReason({
      code: "sandbox_bundle_live_smoke_not_allowed",
      summary: `Sandbox bundle '${params.bundleId}' is not allowed for live smoke.`,
      missingPrerequisites: [`Choose a live-smoke-safe bundle instead of '${params.bundleId}'`],
      suggestedNextAction: "Pick a bundle that explicitly allows live smoke or update the bundle governance rule if intentional.",
    });
    return {
      status: "manual_required",
      bundleId: params.bundleId,
      reason,
      summary: reason.summary,
      invalidBundleIds: inspection.invalidBundleIds,
      disabledBundleIds: inspection.disabledBundleIds,
    } satisfies SandboxBundleGovernanceDecision;
  }

  if (params.profileId) {
    const profile = params.loadedRegistry.registry.profiles[params.profileId];
    if (!profile) {
      const reason = buildReason({
        code: "sandbox_profile_missing",
        summary: `Sandbox profile '${params.profileId}' does not exist.`,
        missingPrerequisites: [`sandbox profile '${params.profileId}'`],
        suggestedNextAction: "Create the sandbox profile first or choose another profile.",
      });
      return {
        status: "manual_required",
        bundleId: params.bundleId,
        reason,
        summary: reason.summary,
        invalidBundleIds: inspection.invalidBundleIds,
        disabledBundleIds: inspection.disabledBundleIds,
      } satisfies SandboxBundleGovernanceDecision;
    }

    if (!bundle.allowedProfileTargetTypes.includes(profile.targetType)) {
      const reason = buildReason({
        code: "sandbox_bundle_target_type_not_allowed",
        summary: `Sandbox bundle '${params.bundleId}' does not allow target type '${profile.targetType}' for profile '${params.profileId}'.`,
        missingPrerequisites: [`Use an allowed target type bundle for '${params.profileId}'`],
        suggestedNextAction: "Choose a bundle that allows the profile target type or change the profile target type first.",
      });
      return {
        status: "manual_required",
        bundleId: params.bundleId,
        reason,
        summary: reason.summary,
        invalidBundleIds: inspection.invalidBundleIds,
        disabledBundleIds: inspection.disabledBundleIds,
      } satisfies SandboxBundleGovernanceDecision;
    }

    if (bundle.repository && bundle.repository !== profile.repository) {
      const reason = buildReason({
        code: "sandbox_bundle_repository_mismatch",
        summary: `Sandbox bundle '${params.bundleId}' is pinned to repository '${bundle.repository}', but profile '${params.profileId}' targets '${profile.repository}'.`,
        missingPrerequisites: [`Use a bundle that matches '${profile.repository}'`],
        suggestedNextAction: "Choose a repository-matched bundle or update the profile repository intentionally before apply.",
      });
      return {
        status: "manual_required",
        bundleId: params.bundleId,
        reason,
        summary: reason.summary,
        invalidBundleIds: inspection.invalidBundleIds,
        disabledBundleIds: inspection.disabledBundleIds,
      } satisfies SandboxBundleGovernanceDecision;
    }
  }

  return {
    status: "ready",
    bundleId: params.bundleId,
    reason: null,
    summary: `Sandbox bundle '${params.bundleId}' passed bundle governance checks.`,
    invalidBundleIds: inspection.invalidBundleIds,
    disabledBundleIds: inspection.disabledBundleIds,
  } satisfies SandboxBundleGovernanceDecision;
}

export function formatSandboxBundleGovernanceSummary(decision: SandboxBundleGovernanceDecision) {
  return [
    `Sandbox bundle governance: ${decision.status}`,
    `Bundle: ${decision.bundleId ?? "none"}`,
    `Summary: ${decision.summary}`,
    `Reason: ${decision.reason?.code ?? "none"}`,
    `Next action: ${decision.reason?.suggestedNextAction ?? "none"}`,
    `Disabled bundles: ${decision.disabledBundleIds.join(", ") || "none"}`,
    `Invalid bundles: ${decision.invalidBundleIds.join(", ") || "none"}`,
  ].join("\n");
}
