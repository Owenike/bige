import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGptCodeReportIntoState } from "../../src/gpt-code-report-bridge";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("bridge reuses planner and reviewer to create next-iteration state and output payload", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-bridge-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-bridge",
    repoPath,
    repoName: "bige",
    userGoal: "Bridge report intake into next-round instructions",
    objective: "Generate a worker-consumable output payload",
    subtasks: ["intake", "bridge", "output"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["next iteration payload exists"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const result = await ingestGptCodeReportIntoState({
    stateId: state.id,
    reportText: completedSliceReport,
    dependencies,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result.outputPayload.reviewVerdict, "revise");
  assert.equal(updated?.plannerDecision?.objective.length ? true : false, true);
  assert.equal(updated?.nextIterationPlan?.iterationNumber, 1);
  assert.match(result.outputPayload.nextInstruction, /本輪目標/);
});
