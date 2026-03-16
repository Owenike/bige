import test from "node:test";
import assert from "node:assert/strict";

import { applySandboxOperatorAction } from "../../src/sandbox-operator-actions";
import { buildSandboxCloseoutRecoveryClearanceHistory } from "../../src/sandbox-closeout-recovery-clearance-history";
import { buildSandboxCloseoutRecoveredReentryAudit } from "../../src/sandbox-closeout-recovered-reentry-audit";
import { createSandboxConfig, createSandboxState } from "./helpers/sandbox-fixtures";
import { prepareCloseoutCompletionContext } from "./helpers/prepare-closeout-completion";

test("buildSandboxCloseoutRecoveredReentryAudit detects cleared cases that re-enter governance", async () => {
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
    reason: "cleared case re-entered governance",
  });

  const audit = await buildSandboxCloseoutRecoveredReentryAudit({
    configPath,
    state,
  });

  assert.equal(audit.reentryDetected, true);
  assert.equal(audit.reentryCount >= 1, true);
  assert.equal(
    audit.latestReentryStatus === "reopened_after_cleared" ||
      audit.latestReentryStatus === "recovered_then_regressed",
    true,
  );
  assert.equal(audit.reentryRemainsActive, true);
});
