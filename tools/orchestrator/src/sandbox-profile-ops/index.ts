import type { OrchestratorState } from "../schemas";
import { resolveGitHubSandboxTarget, type LoadedGitHubSandboxTargetRegistry } from "../github-sandbox-targets";

export type SandboxProfileRecord = {
  profileId: string;
  isDefault: boolean;
  repository: string;
  targetType: "issue" | "pull_request";
  targetNumber: number;
  actionPolicy: "create_or_update" | "create_only" | "update_only";
};

export type SandboxProfileValidationResult = {
  status: "resolved" | "manual_required" | "blocked";
  profileId: string | null;
  isDefault: boolean;
  repository: string | null;
  targetType: "issue" | "pull_request" | null;
  targetNumber: number | null;
  actionPolicy: "create_or_update" | "create_only" | "update_only" | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
  configVersion: string;
  configSource: "default" | "env" | "file";
  configPath: string | null;
};

export function listSandboxProfiles(loaded: LoadedGitHubSandboxTargetRegistry): SandboxProfileRecord[] {
  return Object.entries(loaded.registry.profiles).map(([profileId, profile]) => ({
    profileId,
    isDefault: loaded.registry.defaultProfileId === profileId,
    repository: profile.repository,
    targetType: profile.targetType,
    targetNumber: profile.targetNumber,
    actionPolicy: profile.actionPolicy,
  }));
}

export function showSandboxProfile(loaded: LoadedGitHubSandboxTargetRegistry, profileId: string | null) {
  if (!profileId) {
    return null;
  }
  const profile = loaded.registry.profiles[profileId];
  if (!profile) {
    return null;
  }
  return {
    profileId,
    isDefault: loaded.registry.defaultProfileId === profileId,
    repository: profile.repository,
    targetType: profile.targetType,
    targetNumber: profile.targetNumber,
    actionPolicy: profile.actionPolicy,
    configVersion: loaded.version,
    configSource: loaded.source,
    configPath: loaded.path,
  };
}

export function validateSandboxProfile(params: {
  state: OrchestratorState;
  loadedRegistry: LoadedGitHubSandboxTargetRegistry;
  profileId?: string | null;
}) {
  const resolution = resolveGitHubSandboxTarget({
    state: params.state,
    loadedRegistry: params.loadedRegistry,
    requestedProfileId: params.profileId ?? null,
  });
  const requestedProfileId = params.profileId ?? null;
  const shownProfileId = resolution.profileId ?? requestedProfileId;
  const shownProfile = shownProfileId ? params.loadedRegistry.registry.profiles[shownProfileId] ?? null : null;

  return {
    status: resolution.status,
    profileId: shownProfileId,
    isDefault: Boolean(shownProfileId && params.loadedRegistry.registry.defaultProfileId === shownProfileId),
    repository: shownProfile?.repository ?? resolution.requestedTarget?.repository ?? null,
    targetType: shownProfile?.targetType ?? resolution.requestedTarget?.targetType ?? null,
    targetNumber: shownProfile?.targetNumber ?? resolution.requestedTarget?.targetNumber ?? null,
    actionPolicy: shownProfile?.actionPolicy ?? resolution.actionPolicy ?? null,
    summary: resolution.summary,
    failureReason: resolution.failureReason,
    suggestedNextAction: resolution.suggestedNextAction,
    configVersion: params.loadedRegistry.version,
    configSource: params.loadedRegistry.source,
    configPath: params.loadedRegistry.path,
  } satisfies SandboxProfileValidationResult;
}

export function formatSandboxProfileList(loaded: LoadedGitHubSandboxTargetRegistry) {
  const profiles = listSandboxProfiles(loaded);
  const lines = [
    `Sandbox registry: source=${loaded.source} version=${loaded.version} path=${loaded.path ?? "none"} default=${loaded.registry.defaultProfileId ?? "none"}`,
  ];
  if (profiles.length === 0) {
    lines.push("Profiles: none");
    return lines.join("\n");
  }
  lines.push("Profiles:");
  for (const profile of profiles) {
    lines.push(
      `- ${profile.profileId}${profile.isDefault ? " (default)" : ""}: ${profile.repository}#${profile.targetNumber} (${profile.targetType}, ${profile.actionPolicy})`,
    );
  }
  return lines.join("\n");
}

export function formatSandboxProfileValidation(result: SandboxProfileValidationResult) {
  return [
    `Sandbox profile: ${result.profileId ?? "none"}${result.isDefault ? " (default)" : ""}`,
    `Status: ${result.status}`,
    `Target: ${result.targetType ?? "none"} ${result.repository ?? "none"}#${result.targetNumber ?? "none"}`,
    `Action policy: ${result.actionPolicy ?? "none"}`,
    `Config: ${result.configSource}/${result.configVersion} (${result.configPath ?? "no-path"})`,
    `Summary: ${result.summary}`,
    `Failure: ${result.failureReason ?? "none"}`,
    `Next action: ${result.suggestedNextAction}`,
  ].join("\n");
}
