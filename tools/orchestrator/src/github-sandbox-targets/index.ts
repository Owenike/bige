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
  profiles: {},
});

function parseTargetNumber(value: string | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
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
      profiles: {
        [profileId]: {
          repository,
          targetType,
          targetNumber,
          actionPolicy,
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

function resolveProfileId(state: OrchestratorState, loaded: LoadedGitHubSandboxTargetRegistry, requestedProfileId: string | null) {
  if (requestedProfileId && loaded.registry.profiles[requestedProfileId]) {
    return requestedProfileId;
  }
  if (loaded.registry.profiles[state.task.profileId]) {
    return state.task.profileId;
  }
  if (loaded.registry.defaultProfileId && loaded.registry.profiles[loaded.registry.defaultProfileId]) {
    return loaded.registry.defaultProfileId;
  }
  if (loaded.registry.profiles.default) {
    return "default";
  }
  return null;
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
      configVersion: null,
      configSource: "default",
      actionPolicy: null,
      summary: "GitHub live auth smoke is blocked until an explicit sandbox target or safe correlated target is provided.",
      failureReason: "github_auth_smoke_missing_sandbox_target",
      suggestedNextAction: "Provide an explicit sandbox target, allow correlated reuse, or configure a sandbox target registry.",
    } satisfies ResolvedGitHubSandboxTarget;
  }

  const profileId = resolveProfileId(params.state, loaded, params.requestedProfileId ?? null);
  if (!profileId) {
    return {
      status: "manual_required",
      requestedTarget: null,
      profileId: null,
      configVersion: loaded.version,
      configSource: loaded.source,
      actionPolicy: null,
      summary: "GitHub live auth smoke has no safe sandbox target for the current profile.",
      failureReason: "github_auth_smoke_missing_sandbox_target_profile",
      suggestedNextAction: "Add a default or profile-specific sandbox target, or pass an explicit sandbox override.",
    } satisfies ResolvedGitHubSandboxTarget;
  }

  const profile = loaded.registry.profiles[profileId];
  return {
    status: "resolved",
    requestedTarget: {
      repository: profile.repository,
      targetType: profile.targetType,
      targetNumber: profile.targetNumber,
      allowCorrelatedReuse: profile.actionPolicy !== "create_only",
    },
    profileId,
    configVersion: loaded.version,
    configSource: loaded.source,
    actionPolicy: profile.actionPolicy,
    summary: `GitHub live auth smoke will use sandbox target profile '${profileId}'.`,
    failureReason: null,
    suggestedNextAction: "Run the auth smoke against the configured sandbox target profile.",
  } satisfies ResolvedGitHubSandboxTarget;
}

export function describeGitHubSandboxTargetRegistry(loaded: LoadedGitHubSandboxTargetRegistry) {
  const profiles = Object.entries(loaded.registry.profiles)
    .map(([profileId, profile]) => `${profileId}=${profile.repository}#${profile.targetNumber}(${profile.targetType},${profile.actionPolicy})`)
    .join("; ");

  return [
    `source=${loaded.source}`,
    `version=${loaded.version}`,
    `path=${loaded.path ?? "none"}`,
    `default=${loaded.registry.defaultProfileId ?? "none"}`,
    `profiles=${profiles || "none"}`,
  ].join(" | ");
}
