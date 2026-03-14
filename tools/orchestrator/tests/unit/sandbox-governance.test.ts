import assert from "node:assert/strict";
import test from "node:test";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { evaluateSandboxProfileGovernance } from "../../src/sandbox-governance";

function createRegistry(overrides?: Partial<LoadedGitHubSandboxTargetRegistry["registry"]>): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-governance-v1",
      defaultProfileId: "default",
      bundles: {},
      profiles: {
        default: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
        review: {
          repository: "example/bige-sandbox",
          targetType: "pull_request",
          targetNumber: 202,
          actionPolicy: "update_only",
          enabled: true,
          bundleId: null,
          overrideFields: [],
          notes: null,
        },
      },
      governance: {
        allowedRepositories: ["example/bige-sandbox"],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
      ...overrides,
    },
    version: "sandbox-governance-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("sandbox governance accepts enabled safe profiles", () => {
  const result = evaluateSandboxProfileGovernance({
    loadedRegistry: createRegistry(),
    profileId: "default",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.reason, null);
});

test("sandbox governance blocks disabled profiles", () => {
  const registry = createRegistry();
  registry.registry.profiles.default.enabled = false;

  const result = evaluateSandboxProfileGovernance({
    loadedRegistry: registry,
    profileId: "default",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason?.code, "sandbox_profile_disabled");
});

test("sandbox governance blocks repositories outside the allow-list", () => {
  const registry = createRegistry();
  registry.registry.profiles.default.repository = "example/unsafe";

  const result = evaluateSandboxProfileGovernance({
    loadedRegistry: registry,
    profileId: "default",
  });

  assert.equal(result.status, "manual_required");
  assert.equal(result.reason?.code, "sandbox_profile_repository_not_allowed");
});

test("sandbox governance blocks unsafe default profile action policy", () => {
  const registry = createRegistry({
    defaultProfileId: "review",
  });

  const result = evaluateSandboxProfileGovernance({
    loadedRegistry: registry,
    profileId: "review",
    requireDefaultSafePolicy: true,
  });

  assert.equal(result.status, "manual_required");
  assert.equal(result.reason?.code, "sandbox_default_profile_not_safe");
});
