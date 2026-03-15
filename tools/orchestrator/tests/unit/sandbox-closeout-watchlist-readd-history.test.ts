import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutWatchlistReAddHistory } from "../../src/sandbox-closeout-watchlist-readd-history";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout watchlist re-add history keeps resolved-then-readded patterns", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-watchlist-readd-history-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-watchlist-readd-history",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track watchlist cases that leave and re-enter governance",
    objective: "closeout watchlist readd history",
    subtasks: ["sandbox-closeout-watchlist-readd-history"],
    successCriteria: ["watchlist re-add patterns remain visible"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-watchlist-readd-history",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-watchlist-readd-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-watchlist-readd-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "resolved watchlist case drifted again",
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-watchlist-readd-history",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-watchlist-readd-history",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "resolved watchlist case was re-added again",
  });

  const history = await buildSandboxCloseoutWatchlistReAddHistory({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(history.reAddCount >= 2, true);
  assert.equal(history.latestReAddReason, "reopened_after_finalization");
  assert.equal(history.recurrenceSeverity, "high");
  assert.equal(history.latestReAddEntry?.reAddPattern, "resolved_then_readded");
  assert.equal(history.repeatedExitThenReopenPatterns.length > 0, true);
});
