import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { buildSandboxCloseoutWatchlistExitAudit } from "../../src/sandbox-closeout-watchlist-exit-audit";
import {
  createCloseoutCompletionSandboxConfig,
  prepareCloseoutCompletionContext,
  runCloseoutCompletionDecision,
} from "./helpers/prepare-closeout-completion";

test("sandbox closeout watchlist exit audit records resolved watchlist exits as allowed", async () => {
  const { configPath } = await createCloseoutCompletionSandboxConfig(
    "orchestrator-sandbox-closeout-watchlist-exit-audit-",
  );
  const state = createInitialState({
    id: "sandbox-closeout-watchlist-exit-audit",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Audit when watchlist cases can leave governance",
    objective: "closeout watchlist exit audit",
    subtasks: ["sandbox-closeout-watchlist-exit-audit"],
    successCriteria: ["resolved watchlist exits are explicit"],
  });
  const context = await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
    actorSource: "test-sandbox-closeout-watchlist-exit-audit",
  });

  await runCloseoutCompletionDecision({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    action: "confirm_closeout_complete",
    actorSource: "test-sandbox-closeout-watchlist-exit-audit",
    commandSource: "sandbox:closeout:completion:confirm-closeout",
    completionAuditId: context.completionAudit.id,
  });

  const audit = await buildSandboxCloseoutWatchlistExitAudit({
    configPath,
    state,
    loadedRegistry: context.loadedRegistry,
    limit: 20,
  });

  assert.equal(audit.exitAllowed, true);
  assert.equal(audit.exitStatus, "exit_allowed");
  assert.equal(audit.caseRemovedFromWatchlist, true);
  assert.equal(audit.caseTreatedAsRecovered, true);
  assert.equal(audit.latestWatchlistStatus, "empty");
});
