import {
  nextIterationPlanSchema,
  parseWithDualValidation,
  plannerDecisionJsonSchema,
  plannerDecisionSchema,
  type NextIterationPlan,
  type OrchestratorState,
  type PlannerDecision,
} from "../schemas";
import { ORCHESTRATOR_ACCEPTANCE_COMMANDS, decideSliceLevel } from "../policies";

export type PlannerInput = {
  state: OrchestratorState;
  previousExecutionReport: OrchestratorState["lastExecutionReport"];
};

export interface PlannerProvider {
  plan(input: PlannerInput): Promise<PlannerDecision>;
}

export class RuleBasedPlanner implements PlannerProvider {
  async plan(input: PlannerInput): Promise<PlannerDecision> {
    const sliceDecision = decideSliceLevel({
      closeoutOnly: false,
      singleBlocker: input.previousExecutionReport?.blockers.length === 1,
      subtaskCount: input.state.task.subtasks.length,
      sameBoundary: input.state.task.sameBoundary,
      specsClear: input.state.task.specsClear,
      sameAcceptanceSuite: input.state.task.sameAcceptanceSuite,
      crossesRestrictedBoundary: false,
    });

    const objective =
      input.previousExecutionReport?.recommendedNextStep && !input.previousExecutionReport.shouldCloseSlice
        ? input.previousExecutionReport.recommendedNextStep
        : input.state.task.objective;

    const nextPromptLines = [
      `Suggested slice level: ${sliceDecision.sliceLevel}`,
      "Rationale:",
      ...sliceDecision.rationale.map((line) => `- ${line}`),
      `Same acceptance suite: ${input.state.task.sameAcceptanceSuite ? "yes" : "no"}`,
      `Objective: ${objective}`,
      "Must do:",
      ...input.state.task.subtasks.map((subtask) => `- ${subtask}`),
      "Allowed files:",
      ...input.state.task.allowedFiles.map((file) => `- ${file}`),
      "Forbidden files:",
      ...input.state.task.forbiddenFiles.map((file) => `- ${file}`),
      "Acceptance commands:",
      ...ORCHESTRATOR_ACCEPTANCE_COMMANDS.map((command) => `- ${command}`),
    ];

    return parseWithDualValidation({
      schemaName: "PlannerDecision",
      zodSchema: plannerDecisionSchema,
      jsonSchema: plannerDecisionJsonSchema,
      data: {
        sliceLevel: sliceDecision.sliceLevel,
        rationale: sliceDecision.rationale,
        sameAcceptanceSuite: input.state.task.sameAcceptanceSuite,
        objective,
        subtasks: input.state.task.subtasks,
        allowedFiles: input.state.task.allowedFiles,
        forbiddenFiles: input.state.task.forbiddenFiles,
        mustDo: [
          "Preserve the orchestrator as a sidecar system.",
          "Keep runtime product routes and business logic untouched.",
          "Run the full orchestrator acceptance suite before completion.",
        ],
        mustNotDo: [
          "Do not modify protected runtime routes or dashboard product features.",
          "Do not rely on a chat UI as the orchestration loop.",
          "Do not mark the slice completed without validation coverage.",
        ],
        acceptanceCommands: [...ORCHESTRATOR_ACCEPTANCE_COMMANDS],
        successCriteria: input.state.task.successCriteria,
        ifNotSuitableWhy: sliceDecision.ifNotSuitableWhy,
        nextPrompt: nextPromptLines.join("\n"),
      },
    });
  }
}

export class OpenAIResponsesPlannerProvider implements PlannerProvider {
  constructor(private readonly model = "gpt-5") {}

  async plan(): Promise<PlannerDecision> {
    throw new Error(
      `OpenAI Responses planner provider for model ${this.model} is not wired in this MVP. Use RuleBasedPlanner, MockExecutor, or LocalRepoExecutor first.`,
    );
  }
}

export function createNextIterationPlan(params: {
  state: OrchestratorState;
  plannerDecision: PlannerDecision;
}) {
  return nextIterationPlanSchema.parse({
    iterationNumber: params.state.iterationNumber + 1,
    plannerDecision: params.plannerDecision,
    approvalRequired: params.state.task.approvalMode === "human_approval" || !params.state.task.autoMode,
    executorMode: params.state.task.executorMode,
  }) satisfies NextIterationPlan;
}
