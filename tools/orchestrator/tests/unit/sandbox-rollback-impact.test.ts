import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { applySandboxRegistryChange } from "../../src/sandbox-change-review";
import { runSandboxRollback } from "../../src/sandbox-rollback";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-rollback-impact-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-rollback-impact-v1",
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
          review: {
            repository: "example/bige",
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
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { configPath };
}

function createState() {
  return createInitialState({
    id: "sandbox-rollback-impact",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Summarize rollback impact clearly",
    objective: "produce readable rollback impact summary",
    subtasks: ["sandbox-rollback-impact"],
    successCriteria: ["rollback impact summary is readable"],
  });
}

test("sandbox rollback preview reports changed fields and affected profile count", async () => {
  const { configPath } = await createSandboxConfig();
  const initialRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const proposedRegistry = {
    ...initialRegistry.registry,
    profiles: {
      ...initialRegistry.registry.profiles,
      default: {
        ...initialRegistry.registry.profiles.default,
        targetNumber: 303,
        overrideFields: ["targetNumber"],
      },
      review: {
        ...initialRegistry.registry.profiles.review,
        targetNumber: 404,
        notes: "rollback me",
        overrideFields: ["targetNumber", "notes"],
      },
    },
  };
  const applied = await applySandboxRegistryChange({
    configPath,
    state: createState(),
    loadedRegistry: initialRegistry,
    proposedRegistry,
    actorSource: "test-rollback-impact-setup",
    applySource: "batch",
    auditAction: "batch-apply",
  });
  assert.equal(applied.status, "ready");

  const changedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const preview = await runSandboxRollback({
    configPath,
    state: createState(),
    loadedRegistry: changedRegistry,
    restorePointId: applied.restorePointId,
    mode: "preview",
    actorSource: "test-rollback-impact-preview",
  });

  assert.equal(preview.status, "previewed");
  assert.equal(preview.impactSummary.profileCount, 2);
  assert.ok(preview.impactSummary.changedFields.includes("targetNumber"));
  assert.ok(preview.impactSummary.changedFields.includes("notes"));
  assert.match(preview.impactSummary.summaryText, /Affected profiles: 2/);
});
