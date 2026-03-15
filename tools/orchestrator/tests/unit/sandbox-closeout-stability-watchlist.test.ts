import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutStabilityWatchlist } from "../../src/sandbox-closeout-stability-watchlist";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout stability watchlist retains reopened finalized threads", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-stability-watchlist-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-stability-watchlist",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Keep risky finalized threads on watchlist",
    objective: "closeout stability watchlist",
    subtasks: ["sandbox-closeout-stability-watchlist"],
    successCriteria: ["reopened finalized threads stay on watchlist"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-stability-watchlist",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-stability-watchlist",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-stability-watchlist",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "watchlist should retain reopened finalized case",
  });

  const watchlist = await buildSandboxCloseoutStabilityWatchlist({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.notEqual(watchlist.watchlistStatus, "empty");
  assert.equal(watchlist.reopenRecurrenceFlag, true);
  assert.equal(watchlist.driftRiskFlag, true);
  assert.equal(watchlist.stableFinalComplete, false);
  assert.equal(watchlist.entries.length > 0, true);
});
