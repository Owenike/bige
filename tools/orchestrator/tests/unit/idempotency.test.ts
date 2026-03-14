import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies } from "../../src/orchestrator";
import { ingestGitHubEvent } from "../../src/github-events";

function issuePayload() {
  return {
    action: "opened",
    issue: {
      id: 404,
      number: 88,
      title: "Idempotent intake",
      body: "Do not duplicate orchestrator runs.",
      labels: [{ name: "orchestrator" }],
    },
    repository: {
      full_name: "example/bige",
      name: "bige",
      default_branch: "main",
    },
  };
}

test("idempotent intake links duplicate events to an existing state and only replays on override", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-idempotency-"));
  const dependencies = createDefaultDependencies({
    repoPath: process.cwd(),
    storageRoot,
  });

  const created = await ingestGitHubEvent({
    payload: issuePayload(),
    dependencies,
    repoPath: process.cwd(),
    enqueue: true,
    now: new Date("2026-03-14T00:00:00.000Z"),
  });
  const duplicate = await ingestGitHubEvent({
    payload: issuePayload(),
    dependencies,
    repoPath: process.cwd(),
    enqueue: true,
    now: new Date("2026-03-14T00:00:05.000Z"),
  });
  const replayed = await ingestGitHubEvent({
    payload: issuePayload(),
    dependencies,
    repoPath: process.cwd(),
    enqueue: true,
    replayOverride: true,
    now: new Date("2026-03-14T00:00:10.000Z"),
  });

  const stateIds = await dependencies.storage.listStateIds();
  assert.equal(created.status, "created");
  assert.equal(duplicate.status, "linked_existing");
  assert.equal(duplicate.state.id, created.state.id);
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.state.duplicateOfStateId, created.state.id);
  assert.equal(stateIds.length, 2);
});
