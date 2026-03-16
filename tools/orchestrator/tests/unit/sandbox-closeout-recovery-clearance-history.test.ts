import test from "node:test";
import assert from "node:assert/strict";

import { applySandboxOperatorAction } from "../../src/sandbox-operator-actions";
import { buildSandboxCloseoutRecoveryClearanceHistory } from "../../src/sandbox-closeout-recovery-clearance-history";
import { createSandboxConfig, createSandboxState } from "./helpers/sandbox-fixtures";
import { prepareCloseoutCompletionContext } from "./helpers/prepare-closeout-completion";

test("buildSandboxCloseoutRecoveryClearanceHistory retains regressed clearance patterns", async () => {
  const configPath = await createSandboxConfig();
  const state = createSandboxState();

  await prepareCloseoutCompletionContext({
    configPath,
    state,
    reviewAction: "approve_closeout",
  });

  await applySandboxOperatorAction({
    configPath,
    state,
    action: "confirm_closeout_complete",
    reason: "closeout confirmed",
  });

  state.lastCloseoutRecoveryClearanceHistory =
    await buildSandboxCloseoutRecoveryClearanceHistory({
      configPath,
      state,
    });

  await applySandboxOperatorAction({
    configPath,
    state,
    action: "reopen_completion",
    reason: "recovered case regressed after clearance",
  });

  const history = await buildSandboxCloseoutRecoveryClearanceHistory({
    configPath,
    state,
  });

  assert.equal(
    history.latestClearanceStatus.startsWith("clearance_blocked"),
    true,
  );
  assert.equal(
    history.previousClearanceAuditEntry?.recoveryClearanceStatus,
    "clearance_allowed",
  );
  assert.equal(history.repeatedClearanceThenRegressedPatterns.length > 0, true);
});
