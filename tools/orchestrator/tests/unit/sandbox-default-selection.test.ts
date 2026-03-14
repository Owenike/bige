import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { resolveGitHubSandboxTarget, type LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createState(profileId = "default", repository: string | null = null) {
  const state = createInitialState({
    id: `sandbox-default-selection-${profileId}-${repository ?? "none"}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Resolve sandbox defaults safely",
    objective: "Use explicit, default, or fallback sandbox profiles",
    subtasks: ["sandbox-default-selection"],
    successCriteria: ["sandbox profile selection is deterministic"],
  });
  return {
    ...state,
    task: {
      ...state.task,
      profileId,
    },
    sourceEventSummary: repository
      ? {
          repository,
          branch: "main",
          issueNumber: 11,
          prNumber: null,
          commentId: null,
          label: null,
          headSha: null,
          command: null,
          triggerReason: `repo:${repository}`,
        }
      : state.sourceEventSummary,
  };
}

function createRegistry(params?: {
  defaultProfileId?: string | null;
  includeTaskProfile?: boolean;
  includeRepoFallback?: boolean;
}): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-selection-v1",
      defaultProfileId: params?.defaultProfileId === undefined ? "default" : params.defaultProfileId,
      bundles: {},
      governance: {
        allowedRepositories: [],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
      profiles: {
        default: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
        ...(params?.includeTaskProfile
          ? {
              review: {
              repository: "example/bige",
              targetType: "pull_request" as const,
              targetNumber: 202,
              actionPolicy: "update_only" as const,
              enabled: true,
              bundleId: null,
              overrideFields: [],
              notes: null,
            },
            }
          : {}),
        ...(params?.includeRepoFallback
          ? {
              repo_fallback: {
              repository: "example/other-repo",
              targetType: "issue" as const,
              targetNumber: 303,
              actionPolicy: "create_or_update" as const,
              enabled: true,
              bundleId: null,
              overrideFields: [],
              notes: null,
            },
            }
          : {}),
      },
    },
    version: "sandbox-selection-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("sandbox default selection prefers explicit override", () => {
  const resolved = resolveGitHubSandboxTarget({
    state: createState(),
    loadedRegistry: createRegistry({ includeTaskProfile: true }),
    requestedProfileId: "review",
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.profileId, "review");
  assert.equal(resolved.selectionMode, "explicit");
});

test("sandbox default selection uses the configured default profile", () => {
  const resolved = resolveGitHubSandboxTarget({
    state: createState("review"),
    loadedRegistry: createRegistry({ includeTaskProfile: true }),
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.profileId, "default");
  assert.equal(resolved.selectionMode, "default");
});

test("sandbox default selection falls back to a repo-matched profile", () => {
  const resolved = resolveGitHubSandboxTarget({
    state: createState("missing-profile", "example/other-repo"),
    loadedRegistry: createRegistry({
      defaultProfileId: null,
      includeRepoFallback: true,
    }),
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.profileId, "repo_fallback");
  assert.equal(resolved.selectionMode, "fallback");
});

test("sandbox default selection blocks when no valid profile exists", () => {
  const resolved = resolveGitHubSandboxTarget({
    state: createState("missing-profile", "example/missing"),
    loadedRegistry: {
      registry: {
        version: "empty-v1",
        defaultProfileId: null,
        bundles: {},
        governance: {
          allowedRepositories: [],
          allowedTargetTypes: ["issue", "pull_request"],
          allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
          defaultAllowedActionPolicies: ["create_or_update", "create_only"],
        },
        profiles: {},
      },
      version: "empty-v1",
      source: "default",
      path: null,
    },
  });

  assert.equal(resolved.status, "manual_required");
  assert.equal(resolved.selectionMode, "blocked");
  assert.equal(resolved.failureReason, "github_auth_smoke_missing_sandbox_target_profile");
});
