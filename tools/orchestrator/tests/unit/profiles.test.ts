import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { DEFAULT_TASK_PROFILE, resolveTaskProfile } from "../../src/profiles";

test("default profile provides stable orchestrator-safe defaults", () => {
  const profile = resolveTaskProfile();
  assert.equal(profile.id, DEFAULT_TASK_PROFILE.id);
  assert.equal(profile.commandAllowList.includes("node"), true);
  assert.equal(profile.approvalDefaults.approvalMode, "human_approval");
  assert.equal(profile.promotionDefaults.allowPublish, false);
});

test("custom profile overrides flow into initial orchestrator task state", () => {
  const state = createInitialState({
    id: "profile-custom",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Profile override test",
    objective: "Apply task profile overrides",
    subtasks: ["profiles", "planner", "reviewer", "executor"],
    successCriteria: ["profile overrides are persisted"],
    profileId: "custom-repo",
    profileName: "Custom Repo Profile",
    repoType: "custom_node",
    allowedFiles: ["tools/orchestrator", "docs/orchestrator-runbook.md"],
    forbiddenFiles: ["app/api/platform/notifications", "components"],
    commandAllowList: ["node", "npm"],
    autoMode: true,
    approvalMode: "auto",
    handoffConfig: {
      githubHandoffEnabled: true,
      publishBranch: true,
      createBranch: true,
    },
    promotionConfig: {
      allowPublish: true,
      baseBranch: "develop",
    },
    retentionConfig: {
      recentSuccessKeep: 2,
      recentFailureKeep: 4,
    },
  });

  assert.equal(state.task.profileId, "custom-repo");
  assert.equal(state.task.profileName, "Custom Repo Profile");
  assert.equal(state.task.repoType, "custom_node");
  assert.deepEqual(state.task.allowedFiles, ["tools/orchestrator", "docs/orchestrator-runbook.md"]);
  assert.deepEqual(state.task.commandAllowList, ["node", "npm"]);
  assert.equal(state.task.autoMode, true);
  assert.equal(state.task.handoffConfig.githubHandoffEnabled, true);
  assert.equal(state.task.promotionConfig.allowPublish, true);
  assert.equal(state.task.promotionConfig.baseBranch, "develop");
  assert.equal(state.task.retentionConfig.recentSuccessKeep, 2);
});
