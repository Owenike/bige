import {
  nextIterationPlanSchema,
  parseWithDualValidation,
  plannerDecisionJsonSchema,
  plannerDecisionSchema,
  type JsonSchema,
  type NextIterationPlan,
  type OrchestratorState,
  type PlannerDecision,
  type PlannerProviderKind,
} from "../schemas";
import { ORCHESTRATOR_ACCEPTANCE_COMMANDS, decideSliceLevel } from "../policies";
import type { OpenAIResponsesClient } from "../openai";

export type PlannerInput = {
  state: OrchestratorState;
  previousExecutionReport: OrchestratorState["lastExecutionReport"];
};

export type PlannerResolution = {
  requested: PlannerProviderKind;
  resolved: PlannerProviderKind;
  fallbackReason: string | null;
  decision: PlannerDecision;
};

export interface PlannerProvider {
  readonly kind: PlannerProviderKind;
  plan(input: PlannerInput): Promise<PlannerDecision>;
}

function buildNextPrompt(input: PlannerInput, rationale: string[], objective: string) {
  return [
    `Suggested slice level: ${decideSliceLevel({
      closeoutOnly: false,
      singleBlocker: input.previousExecutionReport?.blockers.length === 1,
      subtaskCount: input.state.task.subtasks.length,
      sameBoundary: input.state.task.sameBoundary,
      specsClear: input.state.task.specsClear,
      sameAcceptanceSuite: input.state.task.sameAcceptanceSuite,
      crossesRestrictedBoundary: false,
    }).sliceLevel}`,
    "Rationale:",
    ...rationale.map((line) => `- ${line}`),
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
  ].join("\n");
}

export class RuleBasedPlannerProvider implements PlannerProvider {
  readonly kind = "rule_based" as const;

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
        nextPrompt: buildNextPrompt(input, sliceDecision.rationale, objective),
      },
    });
  }
}

export class OpenAIResponsesPlannerProvider implements PlannerProvider {
  readonly kind = "openai" as const;

  constructor(
    private readonly params: {
      client: OpenAIResponsesClient;
      model?: string;
    },
  ) {}

  async plan(input: PlannerInput): Promise<PlannerDecision> {
    const objective =
      input.previousExecutionReport?.recommendedNextStep && !input.previousExecutionReport.shouldCloseSlice
        ? input.previousExecutionReport.recommendedNextStep
        : input.state.task.objective;

    const jsonSchema = plannerDecisionJsonSchema as JsonSchema;
    const rawDecision = await this.params.client.createStructuredOutput<PlannerDecision>({
      model: this.params.model ?? "gpt-5",
      schemaName: "planner_decision",
      jsonSchema,
      systemPrompt: [
        "You are an orchestration planner.",
        "Return only a JSON object that satisfies the provided schema.",
        "You must obey repository constraints, protected files, and acceptance gates.",
      ].join(" "),
      userPrompt: [
        `User goal: ${input.state.task.userGoal}`,
        `Objective: ${objective}`,
        `Subtasks: ${input.state.task.subtasks.join(", ")}`,
        `Allowed files: ${input.state.task.allowedFiles.join(", ")}`,
        `Forbidden files: ${input.state.task.forbiddenFiles.join(", ")}`,
        `Success criteria: ${input.state.task.successCriteria.join(", ")}`,
        `Previous blockers: ${(input.previousExecutionReport?.blockers ?? []).join(", ") || "none"}`,
        `Acceptance commands: ${ORCHESTRATOR_ACCEPTANCE_COMMANDS.join(", ")}`,
      ].join("\n"),
    });

    return parseWithDualValidation({
      schemaName: "PlannerDecision",
      zodSchema: plannerDecisionSchema,
      jsonSchema: plannerDecisionJsonSchema,
      data: rawDecision,
    });
  }
}

export async function resolvePlannerDecision(params: {
  input: PlannerInput;
  preferredProvider: PlannerProviderKind;
  providers: Record<PlannerProviderKind, PlannerProvider | null>;
}) {
  const fallback = params.providers.rule_based;
  if (!fallback) throw new Error("Rule-based planner provider is required.");

  const preferred = params.providers[params.preferredProvider];
  if (!preferred) {
    const decision = await fallback.plan(params.input);
    return {
      requested: params.preferredProvider,
      resolved: fallback.kind,
      fallbackReason: `${params.preferredProvider} planner provider is not configured.`,
      decision,
    } satisfies PlannerResolution;
  }

  try {
    const decision = await preferred.plan(params.input);
    return {
      requested: params.preferredProvider,
      resolved: preferred.kind,
      fallbackReason: null,
      decision,
    } satisfies PlannerResolution;
  } catch (error) {
    if (params.preferredProvider === "rule_based") throw error;
    const decision = await fallback.plan(params.input);
    return {
      requested: params.preferredProvider,
      resolved: fallback.kind,
      fallbackReason: error instanceof Error ? error.message : String(error),
      decision,
    } satisfies PlannerResolution;
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

export { RuleBasedPlannerProvider as RuleBasedPlanner };
