import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { GhCliDraftPullRequestAdapter } from "../../src/github-handoff";

async function createRequestRoot() {
  return mkdtemp(path.join(tmpdir(), "orchestrator-github-handoff-"));
}

test("GitHub handoff skips explicitly when token is missing", async () => {
  const payloadRoot = await createRequestRoot();
  const adapter = new GhCliDraftPullRequestAdapter({
    enabled: true,
    token: null,
  });

  const result = await adapter.createDraftPullRequest({
    repoPath: process.cwd(),
    title: "draft title",
    body: "draft body",
    headBranch: "orchestrator/test/iter-1",
    baseBranch: "main",
    payloadRoot,
    stateId: "handoff-skip",
    iterationNumber: 1,
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.summary.includes("GITHUB_TOKEN"), true);
  assert.equal(Boolean(result.requestPayloadPath), true);
});

test("GitHub handoff can record a draft PR request when gh succeeds", async () => {
  const payloadRoot = await createRequestRoot();
  const adapter = new GhCliDraftPullRequestAdapter({
    enabled: true,
    token: "test-token",
    execFileImpl: async () => ({
      stdout: "https://github.com/example/repo/pull/123\n",
      stderr: "",
    }),
  });

  const result = await adapter.createDraftPullRequest({
    repoPath: process.cwd(),
    title: "draft title",
    body: "draft body",
    headBranch: "orchestrator/test/iter-2",
    baseBranch: "main",
    payloadRoot,
    stateId: "handoff-success",
    iterationNumber: 2,
  });

  assert.equal(result.status, "draft_created");
  assert.equal(result.draftUrl, "https://github.com/example/repo/pull/123");
  assert.equal(Boolean(result.requestPayloadPath), true);
  const payload = JSON.parse(await readFile(result.requestPayloadPath!, "utf8")) as { headBranch: string };
  assert.equal(payload.headBranch, "orchestrator/test/iter-2");
});
