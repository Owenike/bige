import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGptCodeReportFromFile } from "../../src/gpt-code-report-bridge";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

test("report transport bridge can ingest a Chinese report file and emit next-instruction artifacts", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-transport-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-transport",
    repoPath,
    repoName: "bige",
    userGoal: "Bridge GPT CODE reports into repo-local transport artifacts",
    objective: "Produce a stable output payload from a report file",
    subtasks: ["intake", "bridge", "transport"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["next-instruction artifact written"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const reportPath = path.join(storageRoot, "input-report.md");
  const outputRoot = path.join(storageRoot, "bridge-output", state.id, "latest");
  await writeFile(reportPath, completedSliceReport, "utf8");

  const result = await ingestGptCodeReportFromFile({
    stateId: state.id,
    reportPath,
    dependencies,
    outputRoot,
  });

  assert.equal(result.stateId, state.id);
  assert.equal(result.outputTarget.artifactRoot, outputRoot);
  assert.match(result.outputPayload.nextInstruction, /本輪實際要推進的方向/);
});
