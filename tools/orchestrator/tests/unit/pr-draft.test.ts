import assert from "node:assert/strict";
import test from "node:test";
import { buildPrDraftMetadata } from "../../src/handoff";
import { createInitialState } from "../../src/orchestrator";

test("buildPrDraftMetadata returns a stable PR draft payload", () => {
  const state = createInitialState({
    id: "pr-draft-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Generate PR draft metadata",
    objective: "Prepare handoff payload",
    subtasks: ["pr", "draft", "handoff", "metadata"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["draft metadata exists"],
  });

  const draft = buildPrDraftMetadata({
    state: {
      ...state,
      plannerDecision: {
        sliceLevel: "medium",
        rationale: ["metadata"],
        sameAcceptanceSuite: true,
        objective: "Prepare handoff payload",
        subtasks: ["pr", "draft"],
        allowedFiles: ["tools/orchestrator"],
        forbiddenFiles: ["app/api/platform/notifications"],
        mustDo: [],
        mustNotDo: [],
        acceptanceCommands: [],
        successCriteria: ["draft metadata exists"],
        ifNotSuitableWhy: null,
        nextPrompt: "next",
      },
      lastReviewVerdict: {
        verdict: "accept",
        reasons: ["ready"],
        violatedConstraints: [],
        missingValidation: [],
        suggestedPatchScope: [],
        canAutoContinue: false,
      },
    },
    branchName: "orchestrator/task/iter-1",
    payloadPath: ".tmp/pr-draft.json",
    githubHandoffStatus: "payload_ready",
    githubHandoffReason: "payload only",
    createdAt: new Date().toISOString(),
  });

  assert.equal(draft.branchName, "orchestrator/task/iter-1");
  assert.equal(draft.githubHandoffStatus, "payload_ready");
  assert.equal(draft.payloadPath, ".tmp/pr-draft.json");
  assert.equal(draft.title.includes("pr-draft-state"), true);
});
