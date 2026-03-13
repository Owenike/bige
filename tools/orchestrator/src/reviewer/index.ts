import {
  reviewVerdictJsonSchema,
  reviewVerdictSchema,
  parseWithDualValidation,
  type CIStatusSummary,
  type ExecutionReport,
  type OrchestratorState,
  type PlannerDecision,
  type ReviewVerdict,
} from "../schemas";
import {
  canAutoContinue,
  findForbiddenFileViolations,
  findMissingValidation,
  shouldStopForPolicy,
} from "../policies";

export type ReviewerInput = {
  state: OrchestratorState;
  report: ExecutionReport;
  decision: PlannerDecision;
  ciSummary: CIStatusSummary | null;
};

export interface ReviewerProvider {
  review(input: ReviewerInput): Promise<ReviewVerdict>;
}

export class RuleBasedReviewer implements ReviewerProvider {
  async review(input: ReviewerInput): Promise<ReviewVerdict> {
    const violatedConstraints = findForbiddenFileViolations(
      input.report.changedFiles,
      input.decision.forbiddenFiles,
    );
    const missingValidation = findMissingValidation(
      input.decision.acceptanceCommands,
      input.report.localValidation,
    );
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

    const policyStopReason = shouldStopForPolicy(input.state, input.report);
    if (policyStopReason) {
      verdict = "stop";
      reasons.push(policyStopReason);
    }

    if (verdict === "accept" && !input.report.shouldCloseSlice) {
      reasons.push("Execution passed review and can continue to the next iteration.");
    } else if (verdict === "accept") {
      reasons.push("Execution passed review and the slice can be closed.");
    }

    return parseWithDualValidation({
      schemaName: "ReviewVerdict",
      zodSchema: reviewVerdictSchema,
      jsonSchema: reviewVerdictJsonSchema,
      data: {
        verdict,
        reasons,
        violatedConstraints,
        missingValidation,
        suggestedPatchScope:
          verdict === "revise"
            ? [...new Set([...violatedConstraints, ...input.report.changedFiles])]
            : [],
        canAutoContinue:
          verdict === "accept" &&
          canAutoContinue(input.state) &&
          !input.report.shouldCloseSlice &&
          (!input.ciSummary || input.ciSummary.status === "success" || input.ciSummary.status === "not_run"),
      },
    });
  }
}
