import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createSandboxProfile,
  deleteSandboxProfile,
  setDefaultSandboxProfile,
  updateSandboxProfile,
} from "../../src/sandbox-profile-lifecycle";

async function createConfigPath() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-lifecycle-"));
  return path.join(root, "sandbox-targets.json");
}

test("sandbox profile lifecycle can create update delete and set default", async () => {
  const configPath = await createConfigPath();

  const createdDefault = await createSandboxProfile({
    configPath,
    profileId: "default",
    profile: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 101,
      actionPolicy: "create_or_update",
      notes: "initial default",
    },
    setDefault: true,
  });
  assert.equal(createdDefault.status, "updated");
  assert.equal(createdDefault.defaultProfileId, "default");

  const createdReview = await createSandboxProfile({
    configPath,
    profileId: "review",
    profile: {
      repository: "example/bige",
      targetType: "pull_request",
      targetNumber: 202,
      actionPolicy: "update_only",
      enabled: true,
      notes: "review smoke",
    },
  });
  assert.equal(createdReview.status, "updated");
  assert.equal(createdReview.registry?.profiles.review?.targetType, "pull_request");

  const updatedReview = await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      enabled: false,
      notes: "temporarily disabled",
    },
  });
  assert.equal(updatedReview.status, "updated");
  assert.equal(updatedReview.registry?.profiles.review?.enabled, false);

  const blockedDefault = await setDefaultSandboxProfile({
    configPath,
    profileId: "review",
  });
  assert.equal(blockedDefault.status, "blocked");
  assert.equal(blockedDefault.failureReason, "sandbox_profile_disabled");

  await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      enabled: true,
      notes: "reactivated",
    },
  });

  const blockedUnsafeDefault = await setDefaultSandboxProfile({
    configPath,
    profileId: "review",
  });
  assert.equal(blockedUnsafeDefault.status, "manual_required");
  assert.equal(blockedUnsafeDefault.failureReason, "sandbox_default_profile_not_safe");

  await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      actionPolicy: "create_or_update",
      notes: "reactivated and safe for default",
    },
  });

  const switchedDefault = await setDefaultSandboxProfile({
    configPath,
    profileId: "review",
  });
  assert.equal(switchedDefault.status, "updated");
  assert.equal(switchedDefault.defaultProfileId, "review");

  const deletedDefault = await deleteSandboxProfile({
    configPath,
    profileId: "review",
  });
  assert.equal(deletedDefault.status, "updated");
  assert.equal(deletedDefault.defaultProfileId, "default");

  const persisted = JSON.parse(await readFile(configPath, "utf8")) as {
    defaultProfileId: string | null;
    profiles: Record<string, { notes: string | null }>;
  };
  assert.equal(persisted.defaultProfileId, "default");
  assert.equal(persisted.profiles.default?.notes, "initial default");
  assert.equal("review" in persisted.profiles, false);
});

test("sandbox profile lifecycle rejects missing profiles and duplicate create", async () => {
  const configPath = await createConfigPath();

  await createSandboxProfile({
    configPath,
    profileId: "default",
    profile: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 42,
      actionPolicy: "create_or_update",
    },
  });

  const duplicate = await createSandboxProfile({
    configPath,
    profileId: "default",
    profile: {
      repository: "example/bige",
      targetType: "issue",
      targetNumber: 43,
      actionPolicy: "create_or_update",
    },
  });
  assert.equal(duplicate.status, "blocked");
  assert.equal(duplicate.failureReason, "sandbox_profile_already_exists");

  const missingUpdate = await updateSandboxProfile({
    configPath,
    profileId: "missing",
    changes: {
      enabled: true,
    },
  });
  assert.equal(missingUpdate.status, "manual_required");
  assert.equal(missingUpdate.failureReason, "sandbox_profile_missing");

  const missingDelete = await deleteSandboxProfile({
    configPath,
    profileId: "missing",
  });
  assert.equal(missingDelete.status, "manual_required");
  assert.equal(missingDelete.failureReason, "sandbox_profile_missing");
});
