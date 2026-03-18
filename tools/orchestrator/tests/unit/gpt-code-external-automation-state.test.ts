import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState } from "../../src/orchestrator";
import { runGptCodeExternalAutomationFromWebhook } from "../../src/gpt-code-external-automation";
import { inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("external automation state records manual review when gating blocks auto dispatch", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-automation-state-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-automation-state",
      repoPath,
      repoName: "bige",
      userGoal: "Track external automation state",
      objective: "Persist manual review metadata when auto dispatch is blocked",
      subtasks: ["external-source", "state"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["manual review state is persisted"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: 44,
      prNumber: null,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "issue_opened from example/bige#44",
    },
  };
  await dependencies.storage.saveState(state);

  const result = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "created",
      issue: {
        number: 44,
        title: "Transport MVP",
      },
      comment: {
        id: 9922,
        body: inspectionSliceReport,
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-manual",
    payloadPath: "C:/tmp/report-manual-payload.json",
    headersPath: "C:/tmp/report-manual-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      async dispatchNextInstruction() {
        throw new Error("should not dispatch when gating blocks auto dispatch");
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result?.outcome, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceLaneClassification, "github_issue_comment_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.fallbackDecision, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.dispatchReliabilityOutcome, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.externalAutomationOutcome, "manual_required");
  assert.equal((updated?.lastGptCodeAutomationState?.manualReviewReason?.length ?? 0) > 0, true);
});

test("external automation state records live smoke routing facts for a pull request body lane", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "gpt-code-external-live-smoke-state-"));
  const repoPath = process.cwd();
  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
  });
  const state = {
    ...createInitialState({
      id: "external-live-smoke-state",
      repoPath,
      repoName: "bige",
      userGoal: "Track external automation live smoke lane state",
      objective: "Persist live smoke routing metadata for a pull request body source",
      subtasks: ["external-source", "state"],
      allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows"],
      forbiddenFiles: ["app/api/platform/notifications"],
      successCriteria: ["live smoke routing state is persisted"],
      autoMode: true,
      approvalMode: "auto",
    }),
    sourceEventSummary: {
      repository: "example/bige",
      branch: "main",
      issueNumber: null,
      prNumber: 78,
      commentId: null,
      label: null,
      headSha: null,
      command: null,
      triggerReason: "pull_request_opened from example/bige#78",
    },
  };
  await dependencies.storage.saveState(state);

  const result = await runGptCodeExternalAutomationFromWebhook({
    payload: {
      action: "edited",
      pull_request: {
        id: 78,
        number: 78,
        title: "Live smoke lane state",
        body: inspectionSliceReport,
        updated_at: "2026-03-18T00:00:00.000Z",
      },
      repository: {
        full_name: "example/bige",
      },
    },
    deliveryId: "delivery-report-live-smoke-state",
    payloadPath: "C:/tmp/report-live-smoke-state-payload.json",
    headersPath: "C:/tmp/report-live-smoke-state-headers.json",
    receivedAt: "2026-03-18T00:00:00.000Z",
    dependencies,
    actualGitStatusShort: " M package-lock.json",
    externalTargetAdapter: {
      kind: "github_issue_comment",
      async dispatchNextInstruction() {
        throw new Error("should not dispatch when gating blocks auto dispatch");
      },
    },
  });
  const updated = await dependencies.storage.loadState(state.id);

  assert.equal(result?.outcome, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceType, "github_pull_request_body");
  assert.equal(updated?.lastGptCodeAutomationState?.sourceLaneClassification, "github_pull_request_body_lane");
  assert.equal(updated?.lastGptCodeAutomationState?.targetAdapterStatus, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.routingDecision, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.fallbackDecision, "manual_required");
  assert.equal(updated?.lastGptCodeAutomationState?.externalAutomationOutcome, "manual_required");
});
