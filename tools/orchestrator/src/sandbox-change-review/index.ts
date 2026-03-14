import type { LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";
import type { OrchestratorState, GitHubSandboxTargetRegistry } from "../schemas";
import { appendSandboxAuditRecord } from "../sandbox-audit";
import { evaluateSandboxProfileGovernance, evaluateSandboxGuardrails } from "../sandbox-governance";
import {
  cloneSandboxRegistry,
  saveSandboxRegistry,
} from "../sandbox-profile-lifecycle";
import { showSandboxPolicyBundle } from "../sandbox-policy-bundles";

export type SandboxDiffItem = {
  profileId: string | null;
  action: "create" | "update" | "delete" | "set_default";
  changedFields: string[];
  summary: string;
};

export type SandboxChangeReviewResult = {
  status: "ready" | "blocked" | "manual_required";
  affectedProfileIds: string[];
  diffSummary: string[];
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  governanceStatus: "ready" | "blocked" | "manual_required";
  guardrailsStatus: "ready" | "blocked" | "manual_required";
  auditId: string | null;
};

const PROFILE_FIELDS = [
  "repository",
  "targetType",
  "targetNumber",
  "actionPolicy",
  "enabled",
  "bundleId",
  "overrideFields",
  "notes",
] as const;

function changedFieldsForProfile(
  current: GitHubSandboxTargetRegistry["profiles"][string] | undefined,
  proposed: GitHubSandboxTargetRegistry["profiles"][string] | undefined,
) {
  const changed = new Set<string>();
  for (const field of PROFILE_FIELDS) {
    const currentValue = current?.[field] ?? null;
    const proposedValue = proposed?.[field] ?? null;
    if (JSON.stringify(currentValue) !== JSON.stringify(proposedValue)) {
      changed.add(field);
    }
  }
  return Array.from(changed).sort();
}

export function buildSandboxRegistryDiff(current: GitHubSandboxTargetRegistry, proposed: GitHubSandboxTargetRegistry) {
  const profileIds = new Set<string>([
    ...Object.keys(current.profiles),
    ...Object.keys(proposed.profiles),
  ]);
  const diffs: SandboxDiffItem[] = [];
  for (const profileId of Array.from(profileIds).sort()) {
    const currentProfile = current.profiles[profileId];
    const proposedProfile = proposed.profiles[profileId];
    if (!currentProfile && proposedProfile) {
      diffs.push({
        profileId,
        action: "create",
        changedFields: ["profile_created", ...changedFieldsForProfile(undefined, proposedProfile)],
        summary: `Create sandbox profile '${profileId}' targeting ${proposedProfile.repository}#${proposedProfile.targetNumber}.`,
      });
      continue;
    }
    if (currentProfile && !proposedProfile) {
      diffs.push({
        profileId,
        action: "delete",
        changedFields: ["profile_deleted"],
        summary: `Delete sandbox profile '${profileId}'.`,
      });
      continue;
    }
    const changedFields = changedFieldsForProfile(currentProfile, proposedProfile);
    if (changedFields.length > 0) {
      diffs.push({
        profileId,
        action: "update",
        changedFields,
        summary: `Update sandbox profile '${profileId}' fields: ${changedFields.join(", ")}.`,
      });
    }
  }
  if ((current.defaultProfileId ?? null) !== (proposed.defaultProfileId ?? null)) {
    diffs.push({
      profileId: proposed.defaultProfileId ?? current.defaultProfileId ?? null,
      action: "set_default",
      changedFields: ["defaultProfileId"],
      summary: `Switch default sandbox profile from '${current.defaultProfileId ?? "none"}' to '${proposed.defaultProfileId ?? "none"}'.`,
    });
  }
  return diffs;
}

function validateBundleReferences(loadedRegistry: LoadedGitHubSandboxTargetRegistry, proposed: GitHubSandboxTargetRegistry) {
  const invalidProfileIds = Object.entries(proposed.profiles)
    .filter(([, profile]) => profile.bundleId && !showSandboxPolicyBundle(loadedRegistry, profile.bundleId))
    .map(([profileId]) => profileId);
  if (invalidProfileIds.length === 0) {
    return null;
  }
  return {
    status: "manual_required" as const,
    failureReason: "sandbox_bundle_missing",
    summary: `Sandbox profiles reference unknown bundles: ${invalidProfileIds.join(", ")}.`,
    suggestedNextAction: "Create the missing bundle definitions or remove the invalid bundle references before apply.",
  };
}

function validateDefaultProfile(proposed: GitHubSandboxTargetRegistry) {
  if (Object.keys(proposed.profiles).length === 0) {
    return null;
  }
  if (proposed.defaultProfileId) {
    return null;
  }
  return {
    status: "manual_required" as const,
    failureReason: "sandbox_default_profile_required",
    summary: "Sandbox profiles exist but no default profile is configured.",
    suggestedNextAction: "Set a safe default sandbox profile before applying the change set.",
  };
}

export async function reviewSandboxRegistryChange(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  proposedRegistry: GitHubSandboxTargetRegistry;
  actorSource: string;
  commandSource?: string | null;
  recordAudit?: boolean;
}) {
  const currentRegistry = cloneSandboxRegistry(params.loadedRegistry.registry);
  const proposedRegistry = cloneSandboxRegistry(params.proposedRegistry);
  const diffs = buildSandboxRegistryDiff(currentRegistry, proposedRegistry);
  const diffSummary = diffs.map((item) => item.summary);
  const affectedProfileIds = diffs
    .map((item) => item.profileId)
    .filter((value): value is string => Boolean(value));

  const bundleValidation = validateBundleReferences(params.loadedRegistry, proposedRegistry);
  if (bundleValidation) {
    return {
      status: bundleValidation.status,
      affectedProfileIds,
      diffSummary,
      summary: bundleValidation.summary,
      failureReason: bundleValidation.failureReason,
      suggestedNextAction: bundleValidation.suggestedNextAction,
      governanceStatus: "manual_required",
      guardrailsStatus: "manual_required",
      auditId: null,
    } satisfies SandboxChangeReviewResult;
  }

  const defaultValidation = validateDefaultProfile(proposedRegistry);
  if (defaultValidation) {
    return {
      status: defaultValidation.status,
      affectedProfileIds,
      diffSummary,
      summary: defaultValidation.summary,
      failureReason: defaultValidation.failureReason,
      suggestedNextAction: defaultValidation.suggestedNextAction,
      governanceStatus: "manual_required",
      guardrailsStatus: "manual_required",
      auditId: null,
    } satisfies SandboxChangeReviewResult;
  }

  const proposedLoadedRegistry: LoadedGitHubSandboxTargetRegistry = {
    registry: proposedRegistry,
    version: proposedRegistry.version,
    source: "file",
    path: params.loadedRegistry.path,
  };

  const governanceFailures = affectedProfileIds
    .map((profileId) =>
      evaluateSandboxProfileGovernance({
        loadedRegistry: proposedLoadedRegistry,
        profileId,
        requireDefaultSafePolicy: proposedRegistry.defaultProfileId === profileId,
      }),
    )
    .filter((decision) => decision.status !== "ready");

  if (governanceFailures.length > 0) {
    const first = governanceFailures[0];
    return {
      status: first.status,
      affectedProfileIds,
      diffSummary,
      summary: first.summary,
      failureReason: first.reason?.code ?? "sandbox_governance_failed",
      suggestedNextAction: first.reason?.suggestedNextAction ?? "Fix the sandbox governance issue before applying the change set.",
      governanceStatus: first.status,
      guardrailsStatus: "manual_required",
      auditId: null,
    } satisfies SandboxChangeReviewResult;
  }

  const guardrails = evaluateSandboxGuardrails({
    state: params.state,
    loadedRegistry: proposedLoadedRegistry,
    selectedProfileId: proposedRegistry.defaultProfileId,
    selectionMode: proposedRegistry.defaultProfileId ? "default" : "blocked",
    selectionReason: proposedRegistry.defaultProfileId
      ? `Default sandbox profile '${proposedRegistry.defaultProfileId}' was selected for change review.`
      : "No default sandbox profile is configured.",
  });

  if (guardrails.status !== "ready") {
    return {
      status: guardrails.status,
      affectedProfileIds,
      diffSummary,
      summary: guardrails.summary,
      failureReason: guardrails.reason?.code ?? "sandbox_guardrails_failed",
      suggestedNextAction: guardrails.reason?.suggestedNextAction ?? "Fix the sandbox guardrails failure before apply.",
      governanceStatus: "ready",
      guardrailsStatus: guardrails.status,
      auditId: null,
    } satisfies SandboxChangeReviewResult;
  }

  let auditId: string | null = null;
  if (params.recordAudit) {
    const audit = await appendSandboxAuditRecord({
      configPath: params.configPath,
      action: "review",
      profileId: null,
      previousRegistry: currentRegistry,
      nextRegistry: proposedRegistry,
      actorSource: params.actorSource,
      commandSource: params.commandSource ?? null,
    });
    auditId = audit.record.id;
  }

  return {
    status: "ready",
    affectedProfileIds,
    diffSummary,
    summary: diffSummary.length === 0 ? "Sandbox review found no changes." : `Sandbox review passed for ${affectedProfileIds.length} affected profile(s).`,
    failureReason: null,
    suggestedNextAction: diffSummary.length === 0 ? "No apply is needed." : "Review the diff summary and run sandbox:apply if the change set is intentional.",
    governanceStatus: "ready",
    guardrailsStatus: "ready",
    auditId,
  } satisfies SandboxChangeReviewResult;
}

export async function applySandboxRegistryChange(params: {
  configPath: string;
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  proposedRegistry: GitHubSandboxTargetRegistry;
  actorSource: string;
  commandSource?: string | null;
}) {
  const review = await reviewSandboxRegistryChange({
    ...params,
    recordAudit: true,
  });
  if (review.status !== "ready") {
    return {
      ...review,
      appliedRegistry: null,
      applyAuditId: null,
    };
  }

  const saved = await saveSandboxRegistry(params.configPath, params.proposedRegistry);
  const applyAudit = await appendSandboxAuditRecord({
    configPath: params.configPath,
    action: "import-apply",
    profileId: null,
    previousRegistry: params.loadedRegistry.registry,
    nextRegistry: saved,
    actorSource: params.actorSource,
    commandSource: params.commandSource ?? null,
  });
  return {
    ...review,
    summary: review.diffSummary.length === 0 ? "Sandbox apply skipped because the registry already matched the reviewed change set." : `Sandbox change set applied to ${review.affectedProfileIds.length} profile(s).`,
    suggestedNextAction: review.diffSummary.length === 0 ? "No further sandbox apply work is needed." : "Re-run sandbox governance or sandbox validate if you want a post-apply verification.",
    appliedRegistry: saved,
    applyAuditId: applyAudit.record.id,
  };
}
