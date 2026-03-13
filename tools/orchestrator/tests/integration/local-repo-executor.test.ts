import assert from "node:assert/strict";
import test from "node:test";
import { LocalRepoExecutor } from "../../src/executor-adapters";

test("LocalRepoExecutor runs allow-listed local command and returns normalized report", async () => {
  const executor = new LocalRepoExecutor();
  const run = await executor.submitTask({
    iterationNumber: 1,
    prompt: "Run local smoke command",
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    acceptanceCommands: ["npm run test:orchestrator:integration"],
    repoPath: process.cwd(),
    metadata: {
      localCommand: ["node", "-e", "process.stdout.write('local-executor-ok')"],
    },
  });

  assert.equal(run.status, "running");
  const result = await executor.collectResult(run.runId);
  assert.equal(result.artifacts[0]?.value, "local-executor-ok");
  assert.equal(result.blockers.length, 0);
});
