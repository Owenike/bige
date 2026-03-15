import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutWatchlistLifecycle } from "../../src/sandbox-closeout-watchlist-lifecycle";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout watchlist lifecycle marks reopened finalized cases as re-added", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-watchlist-lifecycle-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-watchlist-lifecycle",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Track watchlist lifecycle state changes",
    objective: "closeout watchlist lifecycle",
    subtasks: ["sandbox-closeout-watchlist-lifecycle"],
    successCriteria: ["re-added lifecycle stays explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-watchlist-lifecycle",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-watchlist-lifecycle",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });
  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "reopen_completion",
    actorSource: "test-sandbox-closeout-watchlist-lifecycle",
    commandSource: "sandbox:closeout:completion:reopen",
    completionAuditId: context.completionAudit.id,
    reason: "watchlist was resolved once and then re-added",
  });

  const lifecycle = await buildSandboxCloseoutWatchlistLifecycle({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(lifecycle.watchlistActive, true);
  assert.equal(lifecycle.watchlistResolved, false);
  assert.equal(lifecycle.watchlistReAdded, true);
  assert.equal(lifecycle.lifecycleStatus, "re_added");
  assert.equal(lifecycle.watchlistHeldByReopenRecurrence, true);
});
