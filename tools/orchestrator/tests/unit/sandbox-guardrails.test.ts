import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { resolveGitHubSandboxTarget, type LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { evaluateSandboxGuardrails } from "../../src/sandbox-governance";

function createState(profileId = "default", repository: string | null = null) {
  const state = createInitialState({
    id: `sandbox-guardrails-${profileId}-${repository ?? "none"}`,
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Enforce sandbox guardrails",
    objective: "Validate sandbox profile before live smoke",
    subtasks: ["sandbox-guardrails"],
    successCriteria: ["unsafe sandbox profiles are blocked before live smoke"],
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
          issueNumber: 9,
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

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-guardrails-v1",
      defaultProfileId: "default",
      profiles: {
        default: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          notes: null,
        },
        repo_fallback: {
          repository: "example/other-sandbox",
          targetType: "issue",
          targetNumber: 303,
          actionPolicy: "create_or_update",
          enabled: true,
          notes: null,
        },
        disabled: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          targetNumber: 404,
          actionPolicy: "create_or_update",
          enabled: false,
          notes: null,
        },
      },
      governance: {
        allowedRepositories: ["example/bige-sandbox", "example/other-sandbox"],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
    },
    version: "sandbox-guardrails-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("sandbox guardrails accept an explicit safe profile", () => {
  const state = createState();
  const registry = createRegistry();
  const resolution = resolveGitHubSandboxTarget({
    state,
    loadedRegistry: registry,
    requestedProfileId: "default",
  });

  const decision = evaluateSandboxGuardrails({
    state,
    loadedRegistry: registry,
    selectedProfileId: resolution.profileId,
    selectionMode: resolution.selectionMode,
    selectionReason: resolution.selectionReason,
  });

  assert.equal(decision.status, "ready");
});

test("sandbox guardrails accept repository fallback when governance passes", () => {
  const state = createState("missing", "example/other-sandbox");
  const registry = createRegistry();
  registry.registry.defaultProfileId = null;
  const resolution = resolveGitHubSandboxTarget({
    state,
    loadedRegistry: registry,
  });

  const decision = evaluateSandboxGuardrails({
    state,
    loadedRegistry: registry,
    selectedProfileId: resolution.profileId,
    selectionMode: resolution.selectionMode,
    selectionReason: resolution.selectionReason,
  });

  assert.equal(resolution.profileId, "repo_fallback");
  assert.equal(decision.status, "ready");
});

test("sandbox guardrails block disabled selected profiles", () => {
  const state = createState();
  const registry = createRegistry();

  const decision = evaluateSandboxGuardrails({
    state,
    loadedRegistry: registry,
    selectedProfileId: "disabled",
    selectionMode: "explicit",
    selectionReason: "Requested sandbox profile 'disabled' was selected explicitly.",
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.reason?.code, "sandbox_profile_disabled");
});

test("sandbox guardrails require a governed profile when no selection is available", () => {
  const state = createState("missing", "example/missing");
  const registry = createRegistry();
  registry.registry.defaultProfileId = null;

  const decision = evaluateSandboxGuardrails({
    state,
    loadedRegistry: registry,
    selectedProfileId: null,
    selectionMode: "blocked",
    selectionReason: "No enabled sandbox profile matched the current request.",
  });

  assert.equal(decision.status, "manual_required");
  assert.equal(decision.reason?.code, "sandbox_profile_required");
});
