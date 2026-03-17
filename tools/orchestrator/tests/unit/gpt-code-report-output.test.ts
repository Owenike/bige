import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGptCodeReportIntoState } from "../../src/gpt-code-report-bridge";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("output target writes stable latest artifacts that can be rediscovered from state", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-output-"));
  const outputRoot = path.join(storageRoot, "report-output", "state-1", "latest");
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "state-1",
    repoPath,
    repoName: "bige",
    userGoal: "Persist output artifacts",
    objective: "Write a stable next-instruction location",
    subtasks: ["output"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["output artifact exists"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const result = await ingestGptCodeReportIntoState({
    stateId: state.id,
    reportText: completedSliceReport,
    dependencies,
    outputRoot,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
  });
  const updated = await dependencies.storage.loadState(state.id);

  await access(result.outputTarget.nextInstructionPath);
  await access(result.outputTarget.outputPayloadPath);
  const payloadText = await readFile(result.outputTarget.outputPayloadPath, "utf8");

  assert.equal(result.outputTarget.artifactRoot, outputRoot);
  assert.equal(updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.path === result.outputTarget.nextInstructionPath), true);
  assert.match(payloadText, /recommendedNextStep/);
});
