import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutWatchlistResolutionSummary } from "../../src/sandbox-closeout-watchlist-resolution-summary";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout watchlist resolution summary keeps reopened threads retained", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-watchlist-resolution-summary-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-watchlist-resolution-summary",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Decide whether watchlist can be resolved",
    objective: "closeout watchlist resolution summary",
    subtasks: ["sandbox-closeout-watchlist-resolution-summary"],
    successCriteria: ["re-added watchlist case is not resolved"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-watchlist-resolution-summary",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-watchlist-resolution-summary",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-watchlist-resolution-summary",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "watchlist must stay retained after reopen",
  });

  const summary = await buildSandboxCloseoutWatchlistResolutionSummary({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(summary.watchlistCanBeResolved, false);
  assert.equal(summary.watchlistMustRemainRetained, true);
  assert.equal(summary.watchlistWasReAdded, true);
  assert.equal(summary.resolutionStatus, "watchlist_readded");
  assert.equal(summary.recurrenceRemainsActive, true);
});
