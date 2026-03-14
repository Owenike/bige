import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { runSandboxBatchChange } from "../../src/sandbox-batch-change";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-batch-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-batch-v1",
        defaultProfileId: "default",
        bundles: {
          "create-only": {
            repository: "example/bige",
            targetType: "issue",
            actionPolicy: "create_only",
            enabled: true,
            allowAsDefault: true,
            allowLiveSmoke: true,
            allowedProfileTargetTypes: ["issue", "pull_request"],
            enabledByDefault: true,
            governanceDefaults: {},
            liveSmokeDefaults: {
              allowCorrelatedReuse: false,
              preferredSelectionMode: "default",
            },
            notes: "create only bundle",
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
    id: "sandbox-batch-change",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Batch change sandbox profiles safely",
    objective: "preview and apply safe sandbox batch changes",
    subtasks: ["sandbox-batch-change"],
    successCriteria: ["batch changes are previewed before apply"],
  });
}

test("sandbox batch preview summarizes affected profiles and changed fields", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const result = await runSandboxBatchChange({
    configPath,
    state: createState(),
    loadedRegistry,
    profileIds: ["default", "review"],
    bundleId: "create-only",
    mode: "preview",
    actorSource: "test-batch-preview",
  });

  assert.equal(result.status, "previewed");
  assert.equal(result.impactSummary.profileCount, 2);
  assert.ok(result.impactSummary.changedFields.includes("actionPolicy"));
});

test("sandbox batch validate blocks when selected profile is missing", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const result = await runSandboxBatchChange({
    configPath,
    state: createState(),
    loadedRegistry,
    profileIds: ["missing"],
    bundleId: "create-only",
    mode: "validate",
    actorSource: "test-batch-validate",
  });

  assert.equal(result.status, "manual_required");
  assert.deepEqual(result.manualRequiredProfileIds, ["missing"]);
});

test("sandbox batch apply supports partial apply when allowed", async () => {
  const { configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const result = await runSandboxBatchChange({
    configPath,
    state: createState(),
    loadedRegistry,
    profileIds: ["default", "missing"],
    bundleId: "create-only",
    mode: "apply",
    allowPartial: true,
    actorSource: "test-batch-apply",
  });

  assert.equal(result.status, "partially_applied");
  assert.equal(result.appliedRegistry?.profiles.default?.actionPolicy, "create_only");
  assert.deepEqual(result.manualRequiredProfileIds, ["missing"]);
});
