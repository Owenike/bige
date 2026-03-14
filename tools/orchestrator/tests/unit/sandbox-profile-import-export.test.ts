import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInitialState } from "../../src/orchestrator";
import { loadGitHubSandboxTargetRegistry } from "../../src/github-sandbox-targets";
import { exportSandboxProfiles, importSandboxProfiles } from "../../src/sandbox-import-export";

async function createSandboxConfig() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-import-export-"));
  const configPath = path.join(root, "sandbox-targets.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "sandbox-import-export-v1",
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
            notes: "default target",
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
    id: "sandbox-import-export",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Manage sandbox profile imports",
    objective: "preview and apply sandbox profile imports",
    subtasks: ["sandbox-import-export"],
    successCriteria: ["preview and apply are safe"],
  });
}

test("sandbox import export can export single profile and snapshot registry", async () => {
  const { root, configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });

  const singlePath = path.join(root, "default-profile.json");
  const single = await exportSandboxProfiles({
    loadedRegistry,
    outputPath: singlePath,
    profileId: "default",
  });
  assert.equal(single.status, "exported");
  const singlePayload = JSON.parse(await readFile(singlePath, "utf8")) as { kind: string; profileId: string };
  assert.equal(singlePayload.kind, "profile");
  assert.equal(singlePayload.profileId, "default");

  const snapshotPath = path.join(root, "snapshot.json");
  const snapshot = await exportSandboxProfiles({
    loadedRegistry,
    outputPath: snapshotPath,
    snapshot: true,
  });
  assert.equal(snapshot.status, "snapshot_created");
  const snapshotPayload = JSON.parse(await readFile(snapshotPath, "utf8")) as { kind: string };
  assert.equal(snapshotPayload.kind, "snapshot");
});

test("sandbox import export supports preview and apply", async () => {
  const { root, configPath } = await createSandboxConfig();
  const loadedRegistry = await loadGitHubSandboxTargetRegistry({ configPath });
  const inputPath = path.join(root, "profile-import.json");
  await writeFile(
    inputPath,
    `${JSON.stringify(
      {
        kind: "profile",
        profileId: "default",
        profile: {
          repository: "example/bige",
          targetType: "issue",
          targetNumber: 202,
          actionPolicy: "create_or_update",
          enabled: true,
          bundleId: null,
          overrideFields: ["targetNumber"],
          notes: "updated target",
        },
        setDefault: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const preview = await importSandboxProfiles({
    configPath,
    inputPath,
    loadedRegistry,
    state: createState(),
    mode: "preview",
    actorSource: "test-preview",
  });
  assert.equal(preview.status, "previewed");
  assert.match(preview.diffSummary.join(" "), /Update sandbox profile 'default'/);

  const applied = await importSandboxProfiles({
    configPath,
    inputPath,
    loadedRegistry,
    state: createState(),
    mode: "apply",
    actorSource: "test-apply",
  });
  assert.equal(applied.status, "imported");
  const persisted = await loadGitHubSandboxTargetRegistry({ configPath });
  assert.equal(persisted.registry.profiles.default?.targetNumber, 202);
});
