import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import {
  runGptCodeReportTransportWatcher,
  submitGptCodeReportTransportEntry,
} from "../../src/gpt-code-report-transport";
import { completedSliceReport, inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("transport watcher splits queued states into dispatched and manual review outcomes", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-transport-watcher-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const dispatchableState = createInitialState({
    id: "gpt-code-watcher-dispatch",
    repoPath,
    repoName: "bige",
    userGoal: "Dispatch from watcher",
    objective: "Watcher dispatches a revise slice",
    subtasks: ["watcher", "dispatch"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["watcher dispatches one state"],
    autoMode: true,
    approvalMode: "auto",
  });
  const manualReviewState = createInitialState({
    id: "gpt-code-watcher-manual",
    repoPath,
    repoName: "bige",
    userGoal: "Route low-confidence report to manual review",
    objective: "Watcher keeps unsafe reports out of auto dispatch",
    subtasks: ["watcher", "manual_review"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["watcher does not auto dispatch low-confidence reports"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(dispatchableState);
  await dependencies.storage.saveState(manualReviewState);

  await submitGptCodeReportTransportEntry({
    stateId: dispatchableState.id,
    reportText: completedSliceReport,
    source: "test",
    dependencies,
  });
  await submitGptCodeReportTransportEntry({
    stateId: manualReviewState.id,
    reportText: inspectionSliceReport,
    source: "test",
    dependencies,
  });

  const summary = await runGptCodeReportTransportWatcher({
    dependencies,
    bridgeOutputRootByStateId: {
      [dispatchableState.id]: await mkdtemp(path.join(tmpdir(), "gpt-code-watcher-bridge-1-")),
      [manualReviewState.id]: await mkdtemp(path.join(tmpdir(), "gpt-code-watcher-bridge-2-")),
    },
    dispatchRootByStateId: {
      [dispatchableState.id]: await mkdtemp(path.join(tmpdir(), "gpt-code-watcher-dispatch-1-")),
      [manualReviewState.id]: await mkdtemp(path.join(tmpdir(), "gpt-code-watcher-dispatch-2-")),
    },
    actualGitStatusShortByStateId: {
      [dispatchableState.id]: " M package-lock.json\n M app/forgot-password/page.tsx",
      [manualReviewState.id]: " M package-lock.json",
    },
  });
  const updatedDispatchable = await dependencies.storage.loadState(dispatchableState.id);
  const updatedManual = await dependencies.storage.loadState(manualReviewState.id);

  assert.deepEqual(summary.processedStateIds.sort(), [dispatchableState.id, manualReviewState.id].sort());
  assert.deepEqual(summary.dispatchedStateIds, [dispatchableState.id]);
  assert.deepEqual(summary.manualReviewStateIds, [manualReviewState.id]);
  assert.deepEqual(summary.failedStateIds, []);
  assert.equal(updatedDispatchable?.lastGptCodeAutomationState?.dispatchOutcome, "success");
  assert.equal(updatedManual?.lastGptCodeAutomationState?.dispatchOutcome, "manual_required");
});
