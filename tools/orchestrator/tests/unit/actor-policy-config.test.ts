import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveActorAuthorization } from "../../src/actor-policy";
import { loadActorPolicyConfig } from "../../src/actor-policy-config";

test("actor policy can load file-backed config and expose versioned matching rules", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-actor-policy-config-"));
  const configPath = path.join(root, "actor-policy.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: "team-local-v2",
        runActors: ["alice"],
        approverActors: ["carol"],
        statusActors: ["bob", "carol"],
        liveActors: ["carol"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const loaded = await loadActorPolicyConfig({ configPath });
  assert.equal(loaded.version, "team-local-v2");
  assert.equal(loaded.source, "file");

  const allowed = resolveActorAuthorization({
    actor: {
      login: "alice",
      id: 1,
      type: "User",
    },
    command: "run",
    executionMode: "dry_run",
    approvalRequired: true,
    config: loaded.config,
    configVersion: loaded.version,
  });
  assert.equal(allowed.status, "authorized");
  assert.equal(allowed.matchedRule, "runActors");
  assert.equal(allowed.configVersion, "team-local-v2");

  const rejected = resolveActorAuthorization({
    actor: {
      login: "bob",
      id: 2,
      type: "User",
    },
    command: "run",
    executionMode: "dry_run",
    approvalRequired: true,
    config: loaded.config,
    configVersion: loaded.version,
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.matchedRule, "statusActors");
  assert.equal(rejected.blockedReason?.code, "actor_command_not_authorized");
});
