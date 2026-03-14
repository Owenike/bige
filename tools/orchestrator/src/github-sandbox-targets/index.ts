import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  githubSandboxTargetRegistrySchema,
  type GitHubSandboxActionPolicy,
  type GitHubSandboxTargetRegistry,
  type OrchestratorState,
} from "../schemas";
import type { RequestedGitHubSandboxTarget } from "../github-live-targets";

export type GitHubSandboxTargetRule = GitHubSandboxTargetRegistry["profiles"][string];

export type LoadedGitHubSandboxTargetRegistry = {
  registry: GitHubSandboxTargetRegistry;
  version: string;
  source: "default" | "env" | "file";
  path: string | null;
};

export type ResolvedGitHubSandboxTarget = {
  status: "resolved" | "manual_required" | "blocked";
  requestedTarget: RequestedGitHubSandboxTarget | null;
  profileId: string | null;
  selectionMode: "explicit" | "default" | "fallback" | "blocked";
  selectionReason: string;
  configVersion: string | null;
  configSource: "default" | "env" | "file" | "explicit_override";
  actionPolicy: GitHubSandboxActionPolicy | null;
  summary: string;
  failureReason: string | null;
  suggestedNextAction: string;
};

const DEFAULT_REGISTRY = githubSandboxTargetRegistrySchema.parse({
  version: "default-empty-v1",
  defaultProfileId: null,
  bundles: {},
  profiles: {},
});

function parseTargetNumber(value: string | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolveSourceRepository(state: OrchestratorState) {
  return state.sourceEventSummary?.repository ?? state.lastStatusReportTarget?.repository ?? null;
}

function isEnabledProfile(
  loaded: LoadedGitHubSandboxTargetRegistry,
  profileId: string | null,
): profileId is string {
  if (!profileId) {
    return false;
  }
  const profile = loaded.registry.profiles[profileId];
  return Boolean(profile && profile.enabled !== false);
}

export function loadGitHubSandboxTargetRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): LoadedGitHubSandboxTargetRegistry {
  const repository = env.ORCHESTRATOR_GITHUB_SANDBOX_REPO ?? null;
  const targetType =
    env.ORCHESTRATOR_GITHUB_SANDBOX_TARGET_TYPE === "pull_request" || env.ORCHESTRATOR_GITHUB_SANDBOX_TARGET_TYPE === "issue"
      ? env.ORCHESTRATOR_GITHUB_SANDBOX_TARGET_TYPE
      : null;
  const targetNumber = parseTargetNumber(env.ORCHESTRATOR_GITHUB_SANDBOX_TARGET_NUMBER);
  const actionPolicy =
    env.ORCHESTRATOR_GITHUB_SANDBOX_ACTION_POLICY === "create_only" || env.ORCHESTRATOR_GITHUB_SANDBOX_ACTION_POLICY === "update_only"
      ? env.ORCHESTRATOR_GITHUB_SANDBOX_ACTION_POLICY
      : "create_or_update";
  const profileId = env.ORCHESTRATOR_GITHUB_SANDBOX_PROFILE ?? "default";

  if (!repository || !targetType || !targetNumber) {
    return {
      registry: DEFAULT_REGISTRY,
      version: "env-default-empty-v1",
      source: "default",
      path: null,
    };
  }

  return {
    registry: githubSandboxTargetRegistrySchema.parse({
      version: "env-sandbox-targets-v1",
      defaultProfileId: profileId,
      bundles: {},
      profiles: {
        [profileId]: {
          repository,
          targetType,
          targetNumber,
          actionPolicy,
          bundleId: null,
          overrideFields: [],
        },
      },
    }),
    version: "env-sandbox-targets-v1",
    source: "env",
    path: null,
  };
}

export async function loadGitHubSandboxTargetRegistry(params?: {
  configPath?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params?.env ?? process.env;
  const requestedPath = params?.configPath ?? env.ORCHESTRATOR_GITHUB_SANDBOX_TARGETS_CONFIG ?? null;
  if (!requestedPath) {
    return loadGitHubSandboxTargetRegistryFromEnv(env);
  }

  const resolvedPath = path.resolve(requestedPath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = githubSandboxTargetRegistrySchema.parse(JSON.parse(raw));
  return {
    registry: parsed,
    version: parsed.version,
    source: "file" as const,
    path: resolvedPath,
  };
}

function resolveProfileSelection(state: OrchestratorState, loaded: LoadedGitHubSandboxTargetRegistry, requestedProfileId: string | null) {
  if (requestedProfileId) {
    const requested = loaded.registry.profiles[requestedProfileId];
    if (!requested) {
      return {
        status: "manual_required" as const,
        profileId: null,
        selectionMode: "blocked" as const,
        selectionReason: `Requested sandbox profile '${requestedProfileId}' does not exist.`,
        failureReason: "github_auth_smoke_requested_sandbox_profile_missing",
        suggestedNextAction: "Choose an existing sandbox profile, create it first, or pass an explicit sandbox target override.",
      };
    }
    if (requested.enabled === false) {
      return {
        status: "blocked" as const,
        profileId: requestedProfileId,
        selectionMode: "blocked" as const,
        selectionReason: `Requested sandbox profile '${requestedProfileId}' is disabled.`,
        failureReason: "github_auth_smoke_requested_sandbox_profile_disabled",
        suggestedNextAction: "Enable the sandbox profile, choose another profile, or pass an explicit sandbox target override.",
      };
    }
    return {
      status: "resolved" as const,
      profileId: requestedProfileId,
      selectionMode: "explicit" as const,
      selectionReason: `Requested sandbox profile '${requestedProfileId}' was selected explicitly.`,
      failureReason: null,
      suggestedNextAction: "Run the auth smoke against the explicitly selected sandbox profile.",
    };
  }

  if (isEnabledProfile(loaded, loaded.registry.defaultProfileId)) {
    return {
      status: "resolved" as const,
      profileId: loaded.registry.defaultProfileId,
      selectionMode: "default" as const,
      selectionReason: `Default sandbox profile '${loaded.registry.defaultProfileId}' was selected.`,
      failureReason: null,
      suggestedNextAction: "Run the auth smoke against the default sandbox profile.",
    };
  }

  if (isEnabledProfile(loaded, state.task.profileId)) {
    return {
      status: "resolved" as const,
      profileId: state.task.profileId,
      selectionMode: "fallback" as const,
      selectionReason: `Task profile '${state.task.profileId}' matched a sandbox profile.`,
      failureReason: null,
      suggestedNextAction: "Run the auth smoke against the task-matched sandbox profile.",
    };
  }

  const sourceRepository = resolveSourceRepository(state);
  if (sourceRepository) {
    const repoMatch = Object.entries(loaded.registry.profiles).find(([, profile]) => profile.enabled !== false && profile.repository === sourceRepository)?.[0] ?? null;
    if (repoMatch) {
      return {
        status: "resolved" as const,
        profileId: repoMatch,
        selectionMode: "fallback" as const,
        selectionReason: `Repository '${sourceRepository}' matched sandbox profile '${repoMatch}'.`,
        failureReason: null,
        suggestedNextAction: "Run the auth smoke against the repository-matched sandbox profile.",
      };
    }
  }

  return {
    status: "manual_required" as const,
    profileId: null,
    selectionMode: "blocked" as const,
    selectionReason: "No enabled sandbox profile matched the current request, default, or repository fallback.",
    failureReason: "github_auth_smoke_missing_sandbox_target_profile",
    suggestedNextAction: "Set a default sandbox profile, create a repository-matched profile, or pass an explicit sandbox target override.",
  };
}

export function resolveGitHubSandboxTarget(params: {
  state: OrchestratorState;
  loadedRegistry?: LoadedGitHubSandboxTargetRegistry | null;
  requestedTarget?: RequestedGitHubSandboxTarget | null;
  requestedProfileId?: string | null;
}) {
  const requested = params.requestedTarget ?? null;

  if (requested?.repository || requested?.targetType || requested?.targetNumber) {
    if (!(requested.repository && requested.targetType && requested.targetNumber)) {
      return {
        status: "manual_required",
      requestedTarget: null,
      profileId: null,
      selectionMode: "blocked",
      selectionReason: "Explicit override is incomplete.",
      configVersion: null,
      configSource: "explicit_override",
      actionPolicy: null,
        summary: "GitHub live auth smoke requires repository, target type, and target number for an explicit sandbox override.",
        failureReason: "github_auth_smoke_incomplete_target",
        suggestedNextAction: "Provide --target-repo, --target-type, and --target-number together.",
      } satisfies ResolvedGitHubSandboxTarget;
    }

    return {
      status: "resolved",
      requestedTarget: {
        repository: requested.repository,
        targetType: requested.targetType,
        targetNumber: requested.targetNumber,
        allowCorrelatedReuse: requested.allowCorrelatedReuse ?? false,
      },
      profileId: params.requestedProfileId ?? null,
      selectionMode: "explicit",
      selectionReason: "Explicit sandbox target override was provided.",
      configVersion: null,
      configSource: "explicit_override",
      actionPolicy: null,
      summary: "GitHub live auth smoke will use the explicit sandbox override target.",
      failureReason: null,
      suggestedNextAction: "Run the auth smoke against the explicit sandbox target.",
    } satisfies ResolvedGitHubSandboxTarget;
  }

  if (requested?.allowCorrelatedReuse) {
    return {
      status: "resolved",
      requestedTarget: {
        repository: null,
        targetType: null,
        targetNumber: null,
        allowCorrelatedReuse: true,
      },
      profileId: params.requestedProfileId ?? null,
      selectionMode: "explicit",
      selectionReason: "Explicit correlated target reuse was allowed.",
      configVersion: null,
      configSource: "explicit_override",
      actionPolicy: null,
      summary: "GitHub live auth smoke will reuse the explicitly allowed correlated target.",
      failureReason: null,
      suggestedNextAction: "Run the auth smoke against the existing correlated target.",
    } satisfies ResolvedGitHubSandboxTarget;
  }

  const loaded = params.loadedRegistry ?? null;
  if (!loaded) {
    return {
      status: "manual_required",
      requestedTarget: null,
      profileId: null,
      selectionMode: "blocked",
      selectionReason: "No registry or explicit target was provided.",
      configVersion: null,
      configSource: "default",
      actionPolicy: null,
      summary: "GitHub live auth smoke is blocked until an explicit sandbox target or safe correlated target is provided.",
      failureReason: "github_auth_smoke_missing_sandbox_target",
      suggestedNextAction: "Provide an explicit sandbox target, allow correlated reuse, or configure a sandbox target registry.",
    } satisfies ResolvedGitHubSandboxTarget;
  }

  const profileSelection = resolveProfileSelection(params.state, loaded, params.requestedProfileId ?? null);
  if (profileSelection.status !== "resolved" || !profileSelection.profileId) {
    return {
      status: profileSelection.status,
      requestedTarget: null,
      profileId: profileSelection.profileId,
      selectionMode: profileSelection.selectionMode,
      selectionReason: profileSelection.selectionReason,
      configVersion: loaded.version,
      configSource: loaded.source,
      actionPolicy: null,
      summary: profileSelection.selectionReason,
      failureReason: profileSelection.failureReason,
      suggestedNextAction: profileSelection.suggestedNextAction,
    } satisfies ResolvedGitHubSandboxTarget;
  }

  const profile = loaded.registry.profiles[profileSelection.profileId];
  if (!profile) {
    return {
      status: "manual_required",
      requestedTarget: null,
      profileId: null,
      selectionMode: "blocked",
      selectionReason: `Sandbox profile '${profileSelection.profileId}' was selected but no longer exists in the registry.`,
      configVersion: loaded.version,
      configSource: loaded.source,
      actionPolicy: null,
      summary: `Sandbox profile '${profileSelection.profileId}' is missing from the loaded registry.`,
      failureReason: "github_auth_smoke_selected_sandbox_profile_missing",
      suggestedNextAction: "Refresh the sandbox registry, recreate the missing profile, or choose another sandbox profile.",
    } satisfies ResolvedGitHubSandboxTarget;
  }
  return {
    status: "resolved",
    requestedTarget: {
      repository: profile.repository,
      targetType: profile.targetType,
      targetNumber: profile.targetNumber,
      allowCorrelatedReuse: profile.actionPolicy !== "create_only",
    },
    profileId: profileSelection.profileId,
    selectionMode: profileSelection.selectionMode,
    selectionReason: profileSelection.selectionReason,
    configVersion: loaded.version,
    configSource: loaded.source,
    actionPolicy: profile.actionPolicy,
    summary: `GitHub live auth smoke will use sandbox target profile '${profileSelection.profileId}'.`,
    failureReason: null,
    suggestedNextAction: "Run the auth smoke against the configured sandbox target profile.",
  } satisfies ResolvedGitHubSandboxTarget;
}

export function describeGitHubSandboxTargetRegistry(loaded: LoadedGitHubSandboxTargetRegistry) {
  const profiles = Object.entries(loaded.registry.profiles)
    .map(
      ([profileId, profile]) =>
        `${profileId}=${profile.repository}#${profile.targetNumber}(${profile.targetType},${profile.actionPolicy},enabled=${profile.enabled !== false})`,
    )
    .join("; ");

  return [
    `source=${loaded.source}`,
    `version=${loaded.version}`,
    `path=${loaded.path ?? "none"}`,
    `default=${loaded.registry.defaultProfileId ?? "none"}`,
    `profiles=${profiles || "none"}`,
  ].join(" | ");
}
