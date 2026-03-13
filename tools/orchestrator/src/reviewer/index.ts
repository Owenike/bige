import {
  parseWithDualValidation,
  reviewVerdictJsonSchema,
  reviewVerdictSchema,
  type CIStatusSummary,
  type ExecutionReport,
  type JsonSchema,
  type OrchestratorState,
  type PlannerDecision,
  type PlannerProviderKind,
  type ReviewVerdict,
} from "../schemas";
import {
  canAutoContinue,
  findForbiddenFileViolations,
  findMissingArtifacts,
  findMissingValidation,
  shouldStopForPolicy,
} from "../policies";
import type { OpenAIResponsesClient } from "../openai";

export type ReviewerInput = {
  state: OrchestratorState;
  report: ExecutionReport;
  decision: PlannerDecision;
  ciSummary: CIStatusSummary | null;
};

export type ReviewerResolution = {
  requested: PlannerProviderKind;
  resolved: PlannerProviderKind;
  fallbackReason: string | null;
  verdict: ReviewVerdict;
};

export interface ReviewerProvider {
  readonly kind: PlannerProviderKind;
  review(input: ReviewerInput): Promise<ReviewVerdict>;
}

function buildRuleBasedVerdict(input: ReviewerInput) {
  const violatedConstraints = findForbiddenFileViolations(
    input.report.changedFiles,
    input.decision.forbiddenFiles,
  );
  const missingValidation = findMissingValidation(
    input.decision.acceptanceCommands,
    input.report.localValidation,
  );
  const missingArtifacts = findMissingArtifacts(input.report);
  const reasons: string[] = [];
  let verdict: ReviewVerdict["verdict"] = "accept";

  if (violatedConstraints.length > 0) {
    verdict = "escalate";
    reasons.push("Execution changed forbidden files.");
  }

  if (missingValidation.length > 0) {
    verdict = verdict === "accept" ? "revise" : verdict;
    reasons.push("Execution is missing required validation commands.");
  }

  if (missingArtifacts.length > 0) {
    verdict = verdict === "accept" ? "revise" : verdict;
    reasons.push(`Execution is missing required artifacts: ${missingArtifacts.join(", ")}.`);
  }

  if (["patch_exported", "branch_ready", "promotion_ready", "promoted"].includes(input.state.patchStatus) && input.state.exportArtifactPaths.length === 0) {
    verdict = verdict === "accept" ? "revise" : verdict;
    reasons.push("Promotion flow is missing exported patch artifacts.");
  }

  if (input.state.workspaceStatus === "orphaned") {
    verdict = "escalate";
    reasons.push("Workspace state indicates orphaned workspace risk.");
  }

  if (input.report.blockers.length > 0 && verdict === "accept") {
    verdict = "revise";
    reasons.push("Execution reported blockers that prevent completion.");
  }

  if (input.report.localValidation.some((validation) => validation.status === "failed") && verdict === "accept") {
    verdict = "revise";
    reasons.push("At least one required local validation failed.");
  }

  if (input.ciSummary && input.ciSummary.status === "failure" && verdict === "accept") {
    verdict = "revise";
    reasons.push("CI summary is not green.");
  }

  if (input.ciSummary && input.ciSummary.status === "in_progress" && verdict === "accept") {
    verdict = "revise";
    reasons.push("CI is still in progress.");
  }

  const suggestedPatchScope =
    verdict === "revise"
      ? [...new Set([...violatedConstraints, ...missingValidation, ...missingArtifacts.map((artifact) => `artifact:${artifact}`), ...input.report.changedFiles])]
      : [];

  const policyStopReason = shouldStopForPolicy({
    state: input.state,
    report: input.report,
    decision: input.decision,
    reviewVerdict: {
      violatedConstraints,
      missingValidation,
      suggestedPatchScope,
    },
  });
  if (policyStopReason) {
    verdict = "stop";
    reasons.push(policyStopReason);
  }

  if (verdict === "accept" && !input.report.shouldCloseSlice) {
    reasons.push("Execution passed review and can continue to the next iteration.");
  } else if (verdict === "accept") {
    reasons.push("Execution passed review and the slice can be closed.");
  }

  return {
    verdict,
    reasons,
    violatedConstraints,
    missingValidation,
    suggestedPatchScope,
    canAutoContinue:
      verdict === "accept" &&
      canAutoContinue(input.state) &&
      !input.report.shouldCloseSlice &&
      (!input.ciSummary || input.ciSummary.status === "success" || input.ciSummary.status === "not_run"),
  } satisfies ReviewVerdict;
}

export class RuleBasedReviewerProvider implements ReviewerProvider {
  readonly kind = "rule_based" as const;

  async review(input: ReviewerInput): Promise<ReviewVerdict> {
    return parseWithDualValidation({
      schemaName: "ReviewVerdict",
      zodSchema: reviewVerdictSchema,
      jsonSchema: reviewVerdictJsonSchema,
      data: buildRuleBasedVerdict(input),
    });
  }
}

export class OpenAIResponsesReviewerProvider implements ReviewerProvider {
  readonly kind = "openai" as const;

  constructor(
    private readonly params: {
      client: OpenAIResponsesClient;
      model?: string;
    },
  ) {}

  async review(input: ReviewerInput): Promise<ReviewVerdict> {
    const jsonSchema = reviewVerdictJsonSchema as JsonSchema;
    const rawVerdict = await this.params.client.createStructuredOutput<ReviewVerdict>({
      model: this.params.model ?? "gpt-5",
      schemaName: "review_verdict",
      jsonSchema,
      systemPrompt: [
        "You are an orchestration reviewer.",
        "Return only a JSON object that satisfies the provided schema.",
        "You must enforce forbidden files, missing validation, blockers, and stop conditions.",
      ].join(" "),
      userPrompt: [
        `Objective: ${input.decision.objective}`,
        `Forbidden files: ${input.decision.forbiddenFiles.join(", ")}`,
        `Acceptance commands: ${input.decision.acceptanceCommands.join(", ")}`,
        `Changed files: ${input.report.changedFiles.join(", ") || "none"}`,
        `Blockers: ${input.report.blockers.join(", ") || "none"}`,
        `Validation results: ${JSON.stringify(input.report.localValidation)}`,
        `CI summary: ${JSON.stringify(input.ciSummary)}`,
      ].join("\n"),
    });

    return parseWithDualValidation({
      schemaName: "ReviewVerdict",
      zodSchema: reviewVerdictSchema,
      jsonSchema: reviewVerdictJsonSchema,
      data: rawVerdict,
    });
  }
}

export async function resolveReviewerVerdict(params: {
  input: ReviewerInput;
  preferredProvider: PlannerProviderKind;
  providers: Record<PlannerProviderKind, ReviewerProvider | null>;
}) {
  const fallback = params.providers.rule_based;
  if (!fallback) throw new Error("Rule-based reviewer provider is required.");

  const preferred = params.providers[params.preferredProvider];
  if (!preferred) {
    const verdict = await fallback.review(params.input);
    return {
      requested: params.preferredProvider,
      resolved: fallback.kind,
      fallbackReason: `${params.preferredProvider} reviewer provider is not configured.`,
      verdict,
    } satisfies ReviewerResolution;
  }

  try {
    const verdict = await preferred.review(params.input);
    return {
      requested: params.preferredProvider,
      resolved: preferred.kind,
      fallbackReason: null,
      verdict,
    } satisfies ReviewerResolution;
  } catch (error) {
    if (params.preferredProvider === "rule_based") throw error;
    const verdict = await fallback.review(params.input);
    return {
      requested: params.preferredProvider,
      resolved: fallback.kind,
      fallbackReason: error instanceof Error ? error.message : String(error),
      verdict,
    } satisfies ReviewerResolution;
  }
}

export { RuleBasedReviewerProvider as RuleBasedReviewer };
