import assert from "node:assert/strict";
import test from "node:test";
import { applySandboxPolicyBundle, listSandboxPolicyBundles, showSandboxPolicyBundle } from "../../src/sandbox-policy-bundles";
import type { LoadedGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

function createRegistry(): LoadedGitHubSandboxTargetRegistry {
  return {
    registry: {
      version: "sandbox-bundles-v1",
      defaultProfileId: "default",
      bundles: {
        "repo-safe": {
          repository: "example/bige",
          targetType: "issue",
          actionPolicy: "create_or_update",
          enabledByDefault: true,
          governanceDefaults: {},
          liveSmokeDefaults: {
            allowCorrelatedReuse: true,
            preferredSelectionMode: "default",
          },
          notes: "repo safe bundle",
        },
      },
      governance: {
        allowedRepositories: ["example/bige"],
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
          bundleId: "repo-safe",
          overrideFields: ["targetNumber"],
          notes: null,
        },
      },
    },
    version: "sandbox-bundles-v1",
    source: "file",
    path: "sandbox-targets.json",
  };
}

test("sandbox policy bundles list built-in and registry bundles", () => {
  const bundles = listSandboxPolicyBundles(createRegistry());
  assert.ok(bundles.some((bundle) => bundle.bundleId === "default" && bundle.source === "builtin"));
  assert.ok(bundles.some((bundle) => bundle.bundleId === "repo-safe" && bundle.source === "registry"));
});

test("sandbox policy bundle show returns built-in and registry bundles", () => {
  assert.equal(showSandboxPolicyBundle(createRegistry(), "create-only")?.source, "builtin");
  assert.equal(showSandboxPolicyBundle(createRegistry(), "repo-safe")?.source, "registry");
});

test("sandbox policy bundle apply resolves profile with overrides", () => {
  const applied = applySandboxPolicyBundle({
    loadedRegistry: createRegistry(),
    bundleId: "create-only",
    overrides: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 303,
      notes: "bundle override",
    },
  });
  assert.equal(applied.status, "resolved");
  assert.equal(applied.profile?.actionPolicy, "create_only");
  assert.equal(applied.profile?.bundleId, "create-only");
  assert.equal(applied.profile?.targetNumber, 303);
  assert.ok(applied.overrideFields.includes("targetNumber"));
});

test("sandbox policy bundle apply blocks missing target requirements", () => {
  const applied = applySandboxPolicyBundle({
    loadedRegistry: createRegistry(),
    bundleId: "repo-specific",
    overrides: {
      repository: "example/bige",
    },
  });
  assert.equal(applied.status, "manual_required");
  assert.equal(applied.failureReason, "sandbox_bundle_incomplete_target");
});
