import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import {
  consumeQueuedGptCodeReportTransport,
  submitGptCodeReportTransportEntry,
} from "../../src/gpt-code-report-transport";
import { inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("dispatch outcome state records manual_required when the report cannot be safely auto-dispatched", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-dispatch-outcome-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-dispatch-outcome",
    repoPath,
    repoName: "bige",
    userGoal: "Keep unsafe reports out of auto dispatch",
    objective: "Persist manual review outcome state",
    subtasks: ["manual_review", "dispatch_state"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["manual review state persisted"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  await submitGptCodeReportTransportEntry({
    stateId: state.id,
    reportText: inspectionSliceReport,
    source: "test",
    dependencies,
  });

  const result = await consumeQueuedGptCodeReportTransport({
    stateId: state.id,
    dependencies,
    bridgeOutputRoot: await mkdtemp(path.join(tmpdir(), "gpt-code-manual-bridge-")),
    dispatchRoot: await mkdtemp(path.join(tmpdir(), "gpt-code-manual-dispatch-")),
    actualGitStatusShort: " M package-lock.json",
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result.dispatchStatus, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.intakeStatus, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.bridgeStatus, "needs_manual_review");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchStatus, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchOutcome, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchArtifactPath, null);
  assert.equal(typeof updated?.lastGptCodeAutomationState?.manualReviewReason, "string");
  assert.equal((updated?.lastGptCodeAutomationState?.manualReviewReason?.length ?? 0) > 0, true);
  assert.equal((updated?.lastGptCodeAutomationState?.nextInstructionPath?.length ?? 0) > 0, true);
});
