import type { ExecutionReport, OrchestratorState, ValidationResult } from "../schemas";

export const ORCHESTRATOR_ACCEPTANCE_COMMANDS = [
  "npm run test:orchestrator:typecheck",
  "npm run test:orchestrator:lint",
  "npm run test:orchestrator:unit",
  "npm run test:orchestrator:integration",
  "npm run test:orchestrator:schema",
  "npm run test:orchestrator:policy",
  "npm run test:orchestrator:mock-loop",
  "npm run test:orchestrator:state-machine",
] as const;

export type SliceLevel = "small" | "medium" | "large";

export function decideSliceLevel(params: {
  closeoutOnly?: boolean;
  singleBlocker?: boolean;
  subtaskCount: number;
  sameBoundary: boolean;
  specsClear: boolean;
  sameAcceptanceSuite: boolean;
  crossesRestrictedBoundary?: boolean;
}) {
  const rationale: string[] = [];

  if (params.closeoutOnly || params.singleBlocker) {
    rationale.push("This is a closeout or single-blocker repair task.");
    return {
      sliceLevel: "small" as const,
      rationale,
      ifNotSuitableWhy: "Small slice is sufficient because the work is isolated to one blocker or closeout path.",
    };
  }

  const canUseLarge =
    params.sameBoundary &&
    params.specsClear &&
    params.sameAcceptanceSuite &&
    !params.crossesRestrictedBoundary &&
    params.subtaskCount >= 4 &&
    params.subtaskCount <= 6;

  if (canUseLarge) {
    rationale.push("All subtasks stay within the same responsibility boundary.");
    rationale.push("The spec is explicit and the same acceptance suite can validate the whole slice.");
    rationale.push("The slice covers one theme plus adjacent subtasks without crossing protected runtime boundaries.");
    return {
      sliceLevel: "large" as const,
      rationale,
      ifNotSuitableWhy: null,
    };
  }

  rationale.push("Medium is the default when adjacent subtasks can still be validated in one pass.");
  if (!params.sameBoundary) rationale.push("The proposed scope crosses multiple responsibility boundaries.");
  if (!params.specsClear) rationale.push("The spec is not clear enough for a larger slice.");
  if (!params.sameAcceptanceSuite) rationale.push("The work would require multiple acceptance suites.");
  if (params.crossesRestrictedBoundary) rationale.push("The scope would cross protected runtime or product boundaries.");

  return {
    sliceLevel: "medium" as const,
    rationale,
    ifNotSuitableWhy:
      canUseLarge ? null : "Large slice is not suitable because the work would lose acceptance focus or cross protected boundaries.",
  };
}

export function findForbiddenFileViolations(changedFiles: string[], forbiddenFiles: string[]) {
  return changedFiles.filter((changedFile) =>
    forbiddenFiles.some((forbidden) => changedFile === forbidden || changedFile.startsWith(`${forbidden}/`) || changedFile.startsWith(`${forbidden}\\`)),
  );
}

export function findMissingValidation(requiredCommands: string[], validations: ValidationResult[]) {
  const passedCommands = new Set(
    validations
      .filter((validation) => validation.status === "passed")
      .map((validation) => validation.command.trim()),
  );
  return requiredCommands.filter((command) => !passedCommands.has(command.trim()));
}

export function hasRepeatedBlocker(state: OrchestratorState, report: ExecutionReport) {
  if (!state.lastExecutionReport) return false;
  if (report.blockers.length === 0 || state.lastExecutionReport.blockers.length === 0) return false;
  return report.blockers.some((blocker) => state.lastExecutionReport?.blockers.includes(blocker));
}

export function shouldStopForPolicy(state: OrchestratorState, report: ExecutionReport) {
  if (state.iterationNumber >= state.task.maxIterations) {
    return "Maximum iterations reached.";
  }
  if (state.consecutiveFailures >= state.task.maxConsecutiveFailures) {
    return "Maximum consecutive failures reached.";
  }
  if (hasRepeatedBlocker(state, report)) {
    return "The same blocker repeated without progress.";
  }
  return null;
}

export function canAutoContinue(state: OrchestratorState) {
  return state.task.autoMode && state.task.approvalMode === "auto";
}
