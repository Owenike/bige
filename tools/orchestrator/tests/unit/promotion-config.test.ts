import assert from "node:assert/strict";
import test from "node:test";
import { approvePendingPatch, promoteApprovedPatch } from "../../src/orchestrator";
import { buildPromotionMetadata, validatePublishPreconditions } from "../../src/promotion";
import { createPromotionReadyFixture } from "./promotion.fixture";

test("promotion config can disable branch publish even after approval", async () => {
  const { dependencies } = await createPromotionReadyFixture("promotion-config-disabled");
  const state = await dependencies.storage.loadState("promotion-config-disabled");
  assert.ok(state);
  await dependencies.storage.saveState({
    ...state,
    task: {
      ...state.task,
      promotionConfig: {
        ...state.task.promotionConfig,
        allowPublish: false,
      },
    },
  });

  await approvePendingPatch("promotion-config-disabled", dependencies);
  await assert.rejects(
    () =>
      promoteApprovedPatch("promotion-config-disabled", dependencies, {
        createBranch: true,
        applyWorkspace: false,
      }),
    /disabled by configuration/i,
  );
});

test("promotion config controls branch naming strategy", async () => {
  const { dependencies } = await createPromotionReadyFixture("promotion-config-branch");
  const state = await dependencies.storage.loadState("promotion-config-branch");
  assert.ok(state);
  const updated = {
    ...state,
    task: {
      ...state.task,
      promotionConfig: {
        ...state.task.promotionConfig,
        branchNameTemplate: "handoff/{taskId}/branch-{iteration}",
      },
    },
  };
  const metadata = buildPromotionMetadata(updated);
  assert.equal(metadata.branchName, "handoff/promotion-config-branch/branch-1");
  const issues = validatePublishPreconditions(updated, {
    createBranch: false,
    applyWorkspace: false,
  });
  assert.equal(issues.includes("Promotion publish requires explicit approval."), true);
});
