import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import {
  runGptCodeReportTransportWatcher,
  submitGptCodeReportTransportEntry,
} from "../../src/gpt-code-report-transport";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

test("GPT CODE report transport can intake, bridge, dispatch, and persist output artifacts end to end", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-auto-dispatch-e2e-"));
  const bridgeRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-auto-dispatch-e2e-bridge-"));
  const dispatchRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-auto-dispatch-e2e-dispatch-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-auto-dispatch-e2e",
    repoPath,
    repoName: "bige",
    userGoal: "Move A closer to repo-local auto dispatch",
    objective: "Produce a watcher-consumable next instruction artifact",
    subtasks: ["intake", "bridge", "dispatch", "state_writeback"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["end-to-end transport flow completes"],
    autoMode: true,
    approvalMode: "auto",
  });
  await dependencies.storage.saveState(state);

  await submitGptCodeReportTransportEntry({
    stateId: state.id,
    reportText: completedSliceReport,
    source: "test",
    dependencies,
  });

  const watcherSummary = await runGptCodeReportTransportWatcher({
    dependencies,
    stateId: state.id,
    bridgeOutputRootByStateId: {
      [state.id]: bridgeRoot,
    },
    dispatchRootByStateId: {
      [state.id]: dispatchRoot,
    },
    actualGitStatusShortByStateId: {
      [state.id]: " M package-lock.json\n M app/forgot-password/page.tsx",
    },
  });
  const updated = await dependencies.storage.loadState(state.id);
  const payload = JSON.parse(
    await readFile(updated?.lastGptCodeAutomationState?.outputPayloadPath ?? "", "utf8"),
  ) as { reviewVerdict: string; nextInstruction: string };
  const dispatchEnvelope = JSON.parse(
    await readFile(updated?.lastGptCodeAutomationState?.dispatchArtifactPath ?? "", "utf8"),
  ) as { nextInstruction: string; consumer: string };

  assert.deepEqual(watcherSummary.processedStateIds, [state.id]);
  assert.deepEqual(watcherSummary.dispatchedStateIds, [state.id]);
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchTarget, "repo_local_outbox");
  assert.equal(payload.reviewVerdict, "revise");
  assert.equal(dispatchEnvelope.consumer, "gpt_code_report_transport_watcher");
  assert.equal(dispatchEnvelope.nextInstruction.trim(), payload.nextInstruction.trim());
  assert.equal(
    updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "gpt_code_dispatch_result"),
    true,
  );
});
