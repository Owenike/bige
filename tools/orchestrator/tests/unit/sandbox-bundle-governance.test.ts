import assert from "node:assert/strict";
import test from "node:test";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { evaluateSandboxBundleGovernance } from "../../src/sandbox-bundle-governance";

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-bundle-governance-v1",
      defaultProfileId: "default",
      governance: {
        allowedRepositories: ["example/bige-sandbox"],
        allowedTargetTypes: ["issue", "pull_request"],
        allowedActionPolicies: ["create_or_update", "create_only", "update_only"],
        defaultAllowedActionPolicies: ["create_or_update", "create_only"],
      },
      bundles: {
        safe: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          actionPolicy: "create_or_update",
          enabled: true,
          allowAsDefault: true,
          allowLiveSmoke: true,
          allowedProfileTargetTypes: ["issue", "pull_request"],
          enabledByDefault: true,
          governanceDefaults: {},
          liveSmokeDefaults: {
            allowCorrelatedReuse: true,
            preferredSelectionMode: "default",
          },
          notes: null,
        },
        disabled: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          actionPolicy: "create_or_update",
          enabled: false,
          allowAsDefault: true,
          allowLiveSmoke: true,
          allowedProfileTargetTypes: ["issue", "pull_request"],
          enabledByDefault: false,
          governanceDefaults: {},
          liveSmokeDefaults: {
            allowCorrelatedReuse: true,
            preferredSelectionMode: null,
          },
          notes: null,
        },
        "no-default": {
          repository: "example/bige-sandbox",
          targetType: "issue",
          actionPolicy: "create_or_update",
          enabled: true,
          allowAsDefault: false,
          allowLiveSmoke: true,
          allowedProfileTargetTypes: ["issue", "pull_request"],
          enabledByDefault: true,
          governanceDefaults: {},
          liveSmokeDefaults: {
            allowCorrelatedReuse: true,
            preferredSelectionMode: null,
          },
          notes: null,
        },
        "issue-only": {
          repository: "example/bige-sandbox",
          targetType: "issue",
          actionPolicy: "create_only",
          enabled: true,
          allowAsDefault: true,
          allowLiveSmoke: true,
          allowedProfileTargetTypes: ["issue"],
          enabledByDefault: true,
          governanceDefaults: {},
          liveSmokeDefaults: {
            allowCorrelatedReuse: false,
            preferredSelectionMode: "explicit",
          },
          notes: null,
        },
      },
      profiles: {
        default: {
          repository: "example/bige-sandbox",
          targetType: "issue",
          targetNumber: 101,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: "safe",
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
    },
    version: "sandbox-bundle-governance-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("sandbox bundle governance accepts safe bundle", () => {
  const result = evaluateSandboxBundleGovernance({
    loadedRegistry: createRegistry(),
    bundleId: "safe",
    profileId: "default",
    intendedUse: "default",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.reason, null);
});

test("sandbox bundle governance blocks disabled bundle", () => {
  const result = evaluateSandboxBundleGovernance({
    loadedRegistry: createRegistry(),
    bundleId: "disabled",
    profileId: "default",
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason?.code, "sandbox_bundle_disabled");
});

test("sandbox bundle governance blocks default-unsafe bundle", () => {
  const result = evaluateSandboxBundleGovernance({
    loadedRegistry: createRegistry(),
    bundleId: "no-default",
    profileId: "default",
    intendedUse: "default",
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.reason?.code, "sandbox_bundle_default_not_allowed");
});

test("sandbox bundle governance blocks incompatible target type", () => {
  const result = evaluateSandboxBundleGovernance({
    loadedRegistry: createRegistry(),
    bundleId: "issue-only",
    profileId: "review",
    intendedUse: "apply",
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.reason?.code, "sandbox_bundle_target_type_not_allowed");
});
