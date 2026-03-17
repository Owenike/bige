import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import {
  consumeQueuedGptCodeReportTransport,
  submitGptCodeReportTransportEntry,
} from "../../src/gpt-code-report-transport";
import { completedSliceReport } from "./helpers/gpt-code-report-fixtures";

test("auto dispatch consumes a queued GPT CODE report and writes a repo-local outbox payload", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-auto-dispatch-"));
  const bridgeRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-bridge-out-"));
  const dispatchRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-dispatch-out-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = createInitialState({
    id: "gpt-code-auto-dispatch",
    repoPath,
    repoName: "bige",
    userGoal: "Auto-dispatch a next instruction after report intake",
    objective: "Write a consumer-readable dispatch envelope",
    subtasks: ["transport", "dispatch"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["next instruction dispatched to repo-local outbox"],
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

  const result = await consumeQueuedGptCodeReportTransport({
    stateId: state.id,
    dependencies,
    bridgeOutputRoot: bridgeRoot,
    dispatchRoot,
    actualGitStatusShort: " M package-lock.json\n M app/forgot-password/page.tsx",
  });
  const updated = await dependencies.storage.loadState(state.id);
  const envelopeText = await readFile(result.dispatchArtifactPath ?? "", "utf8");
  const nextInstruction = await readFile(result.nextInstructionPath ?? "", "utf8");
  const envelope = JSON.parse(envelopeText) as {
    dispatchTarget: string;
    consumer: string;
    nextInstruction: string;
  };

  await access(result.dispatchArtifactPath ?? "");
  await access(result.nextInstructionPath ?? "");

  assert.equal(result.dispatchStatus, "dispatched");
  assert.equal(result.dispatchTarget, "repo_local_outbox");
  assert.equal(envelope.dispatchTarget, "repo_local_outbox");
  assert.equal(envelope.consumer, "gpt_code_report_transport_watcher");
  assert.equal(envelope.nextInstruction.trim(), nextInstruction.trim());
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchStatus, "dispatched");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchOutcome, "success");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchTarget, "repo_local_outbox");
  assert.equal(
    updated?.lastExecutionReport?.artifacts.some((artifact) => artifact.kind === "gpt_code_dispatch_envelope"),
    true,
  );
});
