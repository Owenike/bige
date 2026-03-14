import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createSandboxProfile,
  deleteSandboxProfile,
  setDefaultSandboxProfile,
  updateSandboxProfile,
} from "../../src/sandbox-profile-lifecycle";
import { listSandboxAuditRecords } from "../../src/sandbox-audit";

async function createConfigPath() {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-sandbox-audit-"));
  return path.join(root, "sandbox-targets.json");
}

test("sandbox audit trail records create update enable disable set-default and delete", async () => {
  const configPath = await createConfigPath();

  await createSandboxProfile({
    configPath,
    profileId: "default",
    profile: {
      repository: "example/bige-sandbox",
      targetType: "issue",
      targetNumber: 101,
      actionPolicy: "create_or_update",
    },
    setDefault: true,
  });
  await createSandboxProfile({
    configPath,
    profileId: "review",
    profile: {
      repository: "example/bige-sandbox",
      targetType: "pull_request",
      targetNumber: 202,
      actionPolicy: "create_or_update",
    },
  });
  await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      notes: "updated",
    },
  });
  await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      enabled: false,
    },
  });
  await updateSandboxProfile({
    configPath,
    profileId: "review",
    changes: {
      enabled: true,
    },
  });
  await setDefaultSandboxProfile({
    configPath,
    profileId: "review",
  });
  await deleteSandboxProfile({
    configPath,
    profileId: "review",
  });

  const audit = await listSandboxAuditRecords({
    configPath,
    limit: 10,
  });

  assert.deepEqual(
    audit.records.map((record) => record.action),
    ["delete", "set-default", "enable", "disable", "update", "create", "create"],
  );
  assert.equal(audit.records[0]?.profileId, "review");
  assert.equal(audit.records[audit.records.length - 1]?.profileId, "default");
});
