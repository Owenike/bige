import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { submitGptCodeReportTransportEntry } from "../../src/gpt-code-report-transport";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("transport entry queues a GPT CODE report without requiring a fixed pre-existing file", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-transport-entry-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-transport-entry",
    repoPath,
    repoName: "bige",
    userGoal: "Queue a GPT CODE report transport entry",
    objective: "Persist an incoming report artifact",
    subtasks: ["transport", "entry"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["incoming report queued"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const result = await submitGptCodeReportTransportEntry({
    stateId: state.id,
    reportText: completedSliceReport,
    source: "test",
    dependencies,
  });
  const updated = await dependencies.storage.loadState(state.id);
  const queuedText = await readFile(result.intakeArtifactPath, "utf8");

  await access(result.intakeArtifactPath);
  assert.equal(result.status, "queued");
  assert.equal(updated?.lastGptCodeAutomationState?.intakeStatus, "queued");
  assert.equal(updated?.lastGptCodeAutomationState?.transportSource, "test");
  assert.match(queuedText, /commit/i);
});
