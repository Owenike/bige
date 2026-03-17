import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { ingestGptCodeReportIntoState } from "../../src/gpt-code-report-bridge";
import { inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("intake marks low-evidence inspection slices as needs_manual_review and persists state", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-intake-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-intake",
    repoPath,
    repoName: "bige",
    userGoal: "Ingest GPT CODE report text",
    objective: "Persist a machine-readable intake result",
    subtasks: ["schema", "parser", "normalize", "bridge"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["intake result saved"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  const result = await ingestGptCodeReportIntoState({
    stateId: state.id,
    reportText: inspectionSliceReport,
    dependencies,
    actualGitStatusShort: " M package-lock.json",
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result.status, "needs_manual_review");
  assert.equal(updated?.lastReviewVerdict?.canAutoContinue, false);
  assert.equal(updated?.stopReason, "Report intake requires manual review.");
  assert.equal(updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "gpt_code_report_instruction"), true);
});
