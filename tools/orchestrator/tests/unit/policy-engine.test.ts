import assert from "node:assert/strict";
import test from "node:test";
import {
  ORCHESTRATOR_ACCEPTANCE_COMMANDS,
  decideSliceLevel,
  findForbiddenFileViolations,
  findMissingValidation,
  hasRepeatedBlocker,
  hasRepeatedNoProgress,
} from "../../src/policies";
import { createInitialState } from "../../src/orchestrator";
import { RuleBasedPlanner } from "../../src/planner";

test("slice policy promotes large only when boundary, clarity, and acceptance constraints all align", () => {
  const large = decideSliceLevel({
    subtaskCount: 4,
    sameBoundary: true,
    specsClear: true,
    sameAcceptanceSuite: true,
  });
  assert.equal(large.sliceLevel, "large");

  const medium = decideSliceLevel({
    subtaskCount: 4,
    sameBoundary: false,
    specsClear: true,
    sameAcceptanceSuite: true,
  });
  assert.equal(medium.sliceLevel, "medium");

  const small = decideSliceLevel({
    closeoutOnly: true,
    subtaskCount: 1,
    sameBoundary: true,
    specsClear: true,
    sameAcceptanceSuite: true,
  });
  assert.equal(small.sliceLevel, "small");
});

test("policy engine catches forbidden-file edits and missing validations", () => {
  assert.deepEqual(
    findForbiddenFileViolations(
      ["tools/orchestrator/src/cli.ts", "app/api/platform/notifications/overview/route.ts"],
      ["app/api/platform/notifications"],
    ),
    ["app/api/platform/notifications/overview/route.ts"],
  );

  assert.equal(
    findMissingValidation(
      [...ORCHESTRATOR_ACCEPTANCE_COMMANDS],
      [{ command: "npm run test:orchestrator:typecheck", status: "passed", output: null }],
    ).length > 0,
    true,
  );
});

test("policy engine detects repeated blockers", () => {
  const state = createInitialState({
    id: "policy-state",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Goal",
    objective: "Objective",
    subtasks: ["schemas", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["Done"],
  });
  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: [],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: [],
    whyThisWasDone: [],
    howBehaviorWasKeptStable: [],
    localValidation: [],
    ciValidation: null,
    blockers: ["network unavailable"],
    risks: [],
    recommendedNextStep: "retry",
    shouldCloseSlice: false,
    artifacts: [],
  };

  assert.equal(
    hasRepeatedBlocker(state, {
      ...state.lastExecutionReport,
      blockers: ["network unavailable"],
    }),
    true,
  );
});

test("policy engine detects repeated no-progress beyond blocker strings", async () => {
  const state = createInitialState({
    id: "policy-progress",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Goal",
    objective: "Objective",
    subtasks: ["schemas", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["Done"],
  });
  const planner = new RuleBasedPlanner();
  const previousDecision = await planner.plan({
    state,
    previousExecutionReport: null,
  });
  state.plannerDecision = previousDecision;
  state.lastReviewVerdict = {
    verdict: "revise",
    reasons: ["same issue"],
    violatedConstraints: ["forbidden-file"],
    missingValidation: ["npm run test:orchestrator:unit"],
    suggestedPatchScope: ["tools/orchestrator/src/cli.ts"],
    canAutoContinue: false,
  };
  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: ["tools/orchestrator/src/cli.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: [],
    whyThisWasDone: [],
    howBehaviorWasKeptStable: [],
    localValidation: [],
    ciValidation: null,
    blockers: ["network unavailable"],
    risks: [],
    recommendedNextStep: "retry",
    shouldCloseSlice: false,
    artifacts: [],
  };

  assert.equal(
    hasRepeatedNoProgress({
      state,
      decision: previousDecision,
      report: {
        ...state.lastExecutionReport,
        blockers: ["network unavailable"],
      },
      violatedConstraints: ["forbidden-file"],
      missingValidation: ["npm run test:orchestrator:unit"],
      suggestedPatchScope: ["tools/orchestrator/src/cli.ts"],
    }),
    true,
  );
});
