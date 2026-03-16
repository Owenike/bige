import test from "node:test";
import assert from "node:assert/strict";

import { applySandboxOperatorAction } from "../../src/sandbox-operator-actions";
import { buildSandboxCloseoutRecoveredLifecycleHistory } from "../../src/sandbox-closeout-recovered-lifecycle-history";
import { createSandboxConfig, createSandboxState } from "./helpers/sandbox-fixtures";
import { prepareCloseoutCompletionContext } from "./helpers/prepare-closeout-completion";

test("buildSandboxCloseoutRecoveredLifecycleHistory retains lifecycle transitions", async () => {
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

  state.lastCloseoutRecoveredLifecycleHistory =
    await buildSandboxCloseoutRecoveredLifecycleHistory({
      configPath,
      state,
    });

  await applySandboxOperatorAction({
    configPath,
    state,
    action: "reopen_completion",
    reason: "recovered lifecycle regressed after clearance",
  });

  const history = await buildSandboxCloseoutRecoveredLifecycleHistory({
    configPath,
    state,
  });

  assert.equal(history.latestLifecycleStatus, "recovered_regressed");
  assert.equal(
    history.previousLifecycleEntry?.lifecycleStatus,
    "recovered_cleared",
  );
  assert.equal(
    history.lifecycleTransitionSummary.includes(
      "recovered_cleared->recovered_regressed",
    ),
    true,
  );
});
