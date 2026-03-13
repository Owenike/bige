import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { RuleBasedPlanner } from "../../src/planner";
import { RuleBasedReviewer } from "../../src/reviewer";

test("planner emits large-slice decision with orchestrator acceptance suite", async () => {
  const state = createInitialState({
    id: "planner-state",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Build orchestrator MVP",
    objective: "Implement schemas, policy engine, planner, reviewer, and executor loop",
    subtasks: ["schemas", "policies", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator", "docs/orchestrator-runbook.md", "package.json"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["mock loop runs", "state machine advances"],
    autoMode: true,
    approvalMode: "auto",
  });

  const planner = new RuleBasedPlanner();
  const decision = await planner.plan({
    state,
    previousExecutionReport: null,
  });

  assert.equal(decision.sliceLevel, "large");
  assert.equal(decision.sameAcceptanceSuite, true);
  assert.equal(decision.acceptanceCommands.includes("npm run test:orchestrator:mock-loop"), true);
  assert.equal(decision.nextPrompt.includes("Suggested slice level"), true);
});

test("reviewer revises on missing validation and escalates on forbidden files", async () => {
  const state = createInitialState({
    id: "review-state",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Build orchestrator MVP",
    objective: "Implement loop",
    subtasks: ["schemas", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["done"],
    autoMode: true,
    approvalMode: "auto",
  });
  const planner = new RuleBasedPlanner();
  const decision = await planner.plan({ state, previousExecutionReport: null });
  const reviewer = new RuleBasedReviewer();

  const reviseVerdict = await reviewer.review({
    state,
    decision,
    ciSummary: null,
    report: {
      iterationNumber: 1,
      changedFiles: ["tools/orchestrator/src/cli.ts"],
      checkedButUnmodifiedFiles: [],
      summaryOfChanges: ["Added CLI"],
      whyThisWasDone: ["Need entrypoint"],
      howBehaviorWasKeptStable: ["No runtime route touched"],
      localValidation: [{ command: "npm run test:orchestrator:typecheck", status: "passed", output: null }],
      ciValidation: null,
      blockers: [],
      risks: [],
      recommendedNextStep: "Run remaining tests",
      shouldCloseSlice: false,
      artifacts: [],
    },
  });
  assert.equal(reviseVerdict.verdict, "revise");

  const escalateVerdict = await reviewer.review({
    state,
    decision,
    ciSummary: null,
    report: {
      iterationNumber: 1,
      changedFiles: ["app/api/platform/notifications/overview/route.ts"],
      checkedButUnmodifiedFiles: [],
      summaryOfChanges: ["Touched forbidden runtime route"],
      whyThisWasDone: ["Bad scope"],
      howBehaviorWasKeptStable: ["n/a"],
      localValidation: decision.acceptanceCommands.map((command) => ({ command, status: "passed" as const, output: null })),
      ciValidation: null,
      blockers: [],
      risks: [],
      recommendedNextStep: "Undo scope violation",
      shouldCloseSlice: false,
      artifacts: [],
    },
  });
  assert.equal(escalateVerdict.verdict, "escalate");
});
