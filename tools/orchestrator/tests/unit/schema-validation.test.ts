import assert from "node:assert/strict";
import test from "node:test";
import {
  executionReportJsonSchema,
  executionReportSchema,
  orchestratorStateJsonSchema,
  orchestratorStateSchema,
  parseWithDualValidation,
  plannerDecisionJsonSchema,
  plannerDecisionSchema,
  reviewVerdictJsonSchema,
  reviewVerdictSchema,
} from "../../src/schemas";
import { createInitialState } from "../../src/orchestrator";

test("dual schema validation accepts valid execution report and planner payloads", () => {
  const report = parseWithDualValidation({
    schemaName: "ExecutionReport",
    zodSchema: executionReportSchema,
    jsonSchema: executionReportJsonSchema,
    data: {
      iterationNumber: 1,
      changedFiles: ["tools/orchestrator/src/cli.ts"],
      checkedButUnmodifiedFiles: ["tools/orchestrator/src/schemas/index.ts"],
      summaryOfChanges: ["Added orchestrator CLI wiring."],
      whyThisWasDone: ["MVP needs a runnable entrypoint."],
      howBehaviorWasKeptStable: ["No product runtime files were touched."],
      localValidation: [{ command: "npm run test:orchestrator:unit", status: "passed", output: null }],
      ciValidation: null,
      blockers: [],
      risks: [],
      recommendedNextStep: "Run reviewer.",
      shouldCloseSlice: false,
      artifacts: [],
    },
  });
  assert.equal(report.iterationNumber, 1);

  const plannerDecision = parseWithDualValidation({
    schemaName: "PlannerDecision",
    zodSchema: plannerDecisionSchema,
    jsonSchema: plannerDecisionJsonSchema,
    data: {
      sliceLevel: "large",
      rationale: ["Same boundary", "Same acceptance suite"],
      sameAcceptanceSuite: true,
      objective: "Build orchestrator MVP",
      subtasks: ["schemas", "planner", "reviewer", "executor"],
      allowedFiles: ["tools/orchestrator"],
      forbiddenFiles: ["app/api/platform/notifications"],
      mustDo: ["Run tests"],
      mustNotDo: ["Touch runtime routes"],
      acceptanceCommands: ["npm run test:orchestrator:unit"],
      successCriteria: ["Loop runs"],
      ifNotSuitableWhy: null,
      nextPrompt: "Continue.",
    },
  });
  assert.equal(plannerDecision.sliceLevel, "large");
});

test("dual schema validation rejects missing required fields", () => {
  assert.throws(() =>
    parseWithDualValidation({
      schemaName: "ReviewVerdict",
      zodSchema: reviewVerdictSchema,
      jsonSchema: reviewVerdictJsonSchema,
      data: {
        verdict: "accept",
        reasons: [],
      },
    }),
  );
});

test("orchestrator state schema preserves init payload", () => {
  const state = createInitialState({
    id: "schema-state",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Create orchestrator MVP",
    objective: "Build loop",
    subtasks: ["schemas", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["loop runs"],
  });

  const parsed = parseWithDualValidation({
    schemaName: "OrchestratorState",
    zodSchema: orchestratorStateSchema,
    jsonSchema: orchestratorStateJsonSchema,
    data: state,
  });
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.task.executorMode, "mock");
  assert.equal(parsed.task.plannerProvider, "rule_based");
  assert.equal(parsed.iterationHistory.length, 0);
});
