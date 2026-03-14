import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { reviewSandboxRegistryChange, applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-review-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-review-v1",
        defaultProfileId: "default",
        bundles: {},
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
            bundleId: null,
            overrideFields: [],
            notes: null,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { root, configPath };
}

function createState() {
  return createInitialState({
    id: "sandbox-change-review",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Review sandbox changes safely",
    objective: "preview sandbox diffs and apply safe changes",
    subtasks: ["sandbox-change-review"],
    successCriteria: ["unsafe changes are blocked"],
  });
}

test("sandbox change review summarizes safe diffs and applies them", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const proposedRegistry = {
    ...loadedRegistry.registry,
    profiles: {
      ...loadedRegistry.registry.profiles,
      default: {
        ...loadedRegistry.registry.profiles.default,
        targetNumber: 303,
        overrideFields: ["targetNumber"],
      },
    },
  };

  const review = await reviewSandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry,
    actorSource: "test-review",
    recordAudit: true,
  });
  assert.equal(review.status, "ready");
  assert.match(review.diffSummary.join(" "), /targetNumber/);

  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry,
    actorSource: "test-apply",
  });
  assert.equal(applied.status, "ready");
  assert.equal(applied.appliedRegistry?.profiles.default?.targetNumber, 303);
});

test("sandbox change review blocks unsafe default profile changes", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const proposedRegistry = {
    ...loadedRegistry.registry,
    profiles: {
      ...loadedRegistry.registry.profiles,
      default: {
        ...loadedRegistry.registry.profiles.default,
        actionPolicy: "update_only" as const,
      },
    },
  };

  const review = await reviewSandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry,
    proposedRegistry,
    actorSource: "test-review",
  });
  assert.equal(review.status, "manual_required");
  assert.equal(review.failureReason, "sandbox_default_profile_not_safe");
});
