import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createDefaultDependencies, createInitialState, runOrchestratorOnce } from "../../src/orchestrator";
import { MockExecutor } from "../../src/executor-adapters";
import type { OpenAIResponsesClient, StructuredOutputRequest } from "../../src/openai";

class MockResponsesClient implements OpenAIResponsesClient {
  constructor(private readonly responses: Record<string, unknown>) {}

  async createStructuredOutput<T>(request: StructuredOutputRequest): Promise<T> {
    if (!(request.schemaName in this.responses)) {
      throw new Error(`No mock response configured for ${request.schemaName}.`);
    }
    return this.responses[request.schemaName] as T;
  }
}

function createMockReport(iterationNumber: number, shouldCloseSlice = false) {
  return {
    iterationNumber,
    changedFiles: ["tools/orchestrator/src/orchestrator.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Mock executor applied orchestrator changes."],
    whyThisWasDone: ["Exercise provider selection through the orchestrator loop."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: [
      { command: "npm run test:orchestrator:typecheck", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:lint", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:unit", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:integration", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:schema", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:policy", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:mock-loop", status: "passed" as const, output: null },
      { command: "npm run test:orchestrator:state-machine", status: "passed" as const, output: null },
    ],
    ciValidation: null,
    blockers: [],
    risks: [],
    recommendedNextStep: shouldCloseSlice ? "Close the slice." : "Continue to the next iteration.",
    shouldCloseSlice,
    artifacts: [],
  };
}

test("OpenAI providers can drive planning and review when a client is configured", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-openai-"));
  const repoPath = process.cwd();
  const state = createInitialState({
    id: "openai-provider",
    repoPath,
    repoName: "bige",
    userGoal: "Run provider-backed orchestrator planning",
    objective: "Exercise provider selection",
    subtasks: ["providers", "loop", "approval", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["provider selection works"],
    autoMode: true,
    approvalMode: "auto",
    plannerProvider: "openai",
    reviewerProvider: "openai",
  });

  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
    openaiClient: new MockResponsesClient({
      planner_decision: {
        sliceLevel: "large",
        rationale: ["OpenAI provider kept work in the same orchestration boundary."],
        sameAcceptanceSuite: true,
        objective: "Exercise provider selection",
        subtasks: ["providers", "loop", "approval", "storage"],
        allowedFiles: ["tools/orchestrator"],
        forbiddenFiles: ["app/api/platform/notifications"],
        mustDo: ["Keep runtime untouched."],
        mustNotDo: ["Cross protected boundaries."],
        acceptanceCommands: [
          "npm run test:orchestrator:typecheck",
          "npm run test:orchestrator:lint",
          "npm run test:orchestrator:unit",
          "npm run test:orchestrator:integration",
          "npm run test:orchestrator:schema",
          "npm run test:orchestrator:policy",
          "npm run test:orchestrator:mock-loop",
          "npm run test:orchestrator:state-machine",
        ],
        successCriteria: ["provider selection works"],
        ifNotSuitableWhy: null,
        nextPrompt: "Continue with provider-backed planning.",
      },
      review_verdict: {
        verdict: "accept",
        reasons: ["OpenAI reviewer approved the iteration."],
        violatedConstraints: [],
        missingValidation: [],
        suggestedPatchScope: [],
        canAutoContinue: false,
      },
    }),
  });
  await dependencies.storage.saveState(state);
  dependencies.executorProviders.mock = new MockExecutor([createMockReport(1, true)]);

  const updated = await runOrchestratorOnce("openai-provider", dependencies);
  assert.equal(updated.status, "completed");
  assert.equal(updated.lastPlannerProvider, "openai");
  assert.equal(updated.lastReviewerProvider, "openai");
  assert.equal(updated.lastPlannerFallbackReason, null);
  assert.equal(updated.lastReviewerFallbackReason, null);
});

test("planner and reviewer fall back to rule-based providers when OpenAI is unavailable", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-fallback-"));
  const repoPath = process.cwd();
  const state = createInitialState({
    id: "fallback-provider",
    repoPath,
    repoName: "bige",
    userGoal: "Fallback safely when OpenAI is unavailable",
    objective: "Fallback provider selection",
    subtasks: ["providers", "loop", "approval", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["fallback is visible"],
    autoMode: true,
    approvalMode: "auto",
    plannerProvider: "openai",
    reviewerProvider: "openai",
  });

  const dependencies = createDefaultDependencies({
    repoPath,
    storageRoot,
    executorMode: "mock",
    openaiClient: null,
  });
  await dependencies.storage.saveState(state);
  dependencies.executorProviders.mock = new MockExecutor([createMockReport(1, false)]);

  const updated = await runOrchestratorOnce("fallback-provider", dependencies);
  assert.equal(updated.lastPlannerProvider, "rule_based");
  assert.equal(updated.lastReviewerProvider, "rule_based");
  assert.equal(updated.lastPlannerFallbackReason?.includes("not configured"), true);
  assert.equal(updated.lastReviewerFallbackReason?.includes("not configured"), true);
  assert.equal(updated.iterationHistory[0]?.plannerProviderResolved, "rule_based");
  assert.equal(updated.iterationHistory[0]?.reviewerProviderResolved, "rule_based");
});
