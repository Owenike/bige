import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { transitionState } from "../workflows/state-machine";
import type { OrchestratorDependencies } from "../orchestrator";
import { createNextIterationPlan, resolvePlannerDecision } from "../planner";
import { resolveReviewerVerdict } from "../reviewer";
import { orchestratorStateSchema } from "../schemas";
import {
  crossCheckGptCodeChineseReport,
  normalizeGptCodeChineseReport,
  parseGptCodeChineseReport,
  renderNextInstructionFromNormalizedReport,
} from "../gpt-code-report";
import {
  gptCodeReportBridgeResultSchema,
  gptCodeReportOutputPayloadSchema,
  gptCodeReportOutputTargetSchema,
  type GptCodeEvidenceCrossCheck,
  type GptCodeNormalizedReport,
  type GptCodeReportBridgeResult,
  type GptCodeReportOutputTarget,
} from "../gpt-code-report/schema";

const execFileAsync = promisify(execFile);

function appendUnique(values: string[], additions: string[]) {
  return [...new Set([...values, ...additions])];
}

function mapVerdictToStateStatus(params: {
  verdict: "accept" | "revise" | "stop" | "escalate";
  shouldCloseSlice: boolean;
}) {
  if (params.verdict === "stop") return "stopped" as const;
  if (params.verdict === "escalate") return "blocked" as const;
  if (params.verdict === "accept" && params.shouldCloseSlice) return "completed" as const;
  return "needs_revision" as const;
}

function transitionStateForReportReview(params: {
  state: Awaited<ReturnType<OrchestratorDependencies["storage"]["loadState"]>>;
  nextStatus: ReturnType<typeof mapVerdictToStateStatus>;
  now: Date;
}) {
  if (!params.state) {
    throw new Error("State is required for report review transitions.");
  }

  let current = params.state;

  if (current.status === "completed" || current.status === "stopped") {
    return current;
  }

  if (current.status === "draft" || current.status === "needs_revision" || current.status === "blocked") {
    current = transitionState(current, "planning_started", params.now);
  }

  if (current.status === "planning" || current.status === "waiting_approval") {
    current = transitionState(current, "execution_started", params.now);
  }

  if (current.status === "executing") {
    current = transitionState(current, "awaiting_result", params.now);
  }

  if (current.status === "awaiting_result") {
    current = transitionState(current, "validating", params.now);
  }

  if (current.status === "validating" || current.status === "ci_running") {
    return transitionState(current, params.nextStatus, params.now);
  }

  return current;
}

async function readGitStatusShort(repoPath: string) {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: repoPath });
    return stdout;
  } catch {
    return null;
  }
}

async function resolveActualCiSummary(params: {
  normalizedReport: GptCodeNormalizedReport;
  dependencies: OrchestratorDependencies;
}) {
  const latestRunId = [...params.normalizedReport.parsedReport.ciRuns]
    .reverse()
    .find((entry) => entry.runId)?.runId;
  if (!latestRunId || !params.dependencies.githubAdapter) {
    return params.normalizedReport.ciSummary;
  }

  try {
    return await params.dependencies.githubAdapter.getRunSummary(latestRunId);
  } catch {
    return params.normalizedReport.ciSummary;
  }
}

async function writeBridgeArtifacts(params: {
  repoPath: string;
  stateId: string;
  parsedReport: ReturnType<typeof parseGptCodeChineseReport>;
  normalizedReport: GptCodeNormalizedReport;
  evidenceCrossCheck: GptCodeEvidenceCrossCheck;
  nextInstruction: string;
  outputPayload: unknown;
  outputRoot?: string;
}) {
  const artifactRoot =
    params.outputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-report-bridge", params.stateId, "latest");
  await mkdir(artifactRoot, { recursive: true });

  const outputTarget = gptCodeReportOutputTargetSchema.parse({
    artifactRoot,
    parsedReportPath: path.join(artifactRoot, "parsed-report.json"),
    normalizedReportPath: path.join(artifactRoot, "normalized-report.json"),
    crossCheckPath: path.join(artifactRoot, "cross-check.json"),
    nextInstructionPath: path.join(artifactRoot, "next-instruction.md"),
    outputPayloadPath: path.join(artifactRoot, "output-payload.json"),
  });

  await writeFile(outputTarget.parsedReportPath, `${JSON.stringify(params.parsedReport, null, 2)}\n`, "utf8");
  await writeFile(outputTarget.normalizedReportPath, `${JSON.stringify(params.normalizedReport, null, 2)}\n`, "utf8");
  await writeFile(outputTarget.crossCheckPath, `${JSON.stringify(params.evidenceCrossCheck, null, 2)}\n`, "utf8");
  await writeFile(outputTarget.nextInstructionPath, `${params.nextInstruction.trim()}\n`, "utf8");
  await writeFile(outputTarget.outputPayloadPath, `${JSON.stringify(params.outputPayload, null, 2)}\n`, "utf8");

  return outputTarget;
}

export async function ingestGptCodeReportIntoState(params: {
  stateId: string;
  reportText: string;
  dependencies: OrchestratorDependencies;
  outputRoot?: string;
  actualGitStatusShort?: string | null;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const state = await params.dependencies.storage.loadState(params.stateId);
  if (!state) {
    throw new Error(`State ${params.stateId} was not found.`);
  }

  const parsedReport = parseGptCodeChineseReport(params.reportText);
  const normalizedReport = normalizeGptCodeChineseReport(parsedReport);
  const actualGitStatusShort = params.actualGitStatusShort ?? (await readGitStatusShort(state.task.repoPath));
  const actualCiSummary = await resolveActualCiSummary({
    normalizedReport,
    dependencies: params.dependencies,
  });
  const evidenceCrossCheck = crossCheckGptCodeChineseReport({
    normalizedReport,
    actualCI: actualCiSummary,
    actualGitStatusShort,
    actualValidationSummary: normalizedReport.executionReport.localValidation,
  });

  const plannerResolution = await resolvePlannerDecision({
    input: {
      state,
      previousExecutionReport: normalizedReport.executionReport,
    },
    preferredProvider: state.task.plannerProvider,
    providers: params.dependencies.plannerProviders,
  });

  const reviewerResolution = await resolveReviewerVerdict({
    input: {
      state,
      decision: plannerResolution.decision,
      report: normalizedReport.executionReport,
      ciSummary: actualCiSummary,
    },
    preferredProvider: state.task.reviewerProvider,
    providers: params.dependencies.reviewerProviders,
  });

  const nextInstruction = renderNextInstructionFromNormalizedReport({
    normalizedReport,
    reviewVerdict: reviewerResolution.verdict,
    plannerDecision: plannerResolution.decision,
    evidenceCrossCheck,
  });

  const needsManualReview =
    parsedReport.confidence === "low" ||
    parsedReport.missingFields.length > 0 ||
    evidenceCrossCheck.needsManualReview;

  const outputTarget = await writeBridgeArtifacts({
    repoPath: state.task.repoPath,
    stateId: state.id,
    parsedReport,
    normalizedReport,
    evidenceCrossCheck,
    nextInstruction,
    outputPayload: {},
    outputRoot: params.outputRoot,
  });

  const outputPayload = gptCodeReportOutputPayloadSchema.parse({
    stateId: state.id,
    generatedAt: now.toISOString(),
    needsManualReview,
    reviewVerdict: reviewerResolution.verdict.verdict,
    nextInstruction,
    recommendedNextStep: normalizedReport.recommendedNextStepCandidate,
    plannerObjective: plannerResolution.decision.objective,
    outputTarget,
  });

  await writeFile(outputTarget.outputPayloadPath, `${JSON.stringify(outputPayload, null, 2)}\n`, "utf8");

  const reportArtifacts = [
    { kind: "gpt_code_report_parsed", label: "GPT CODE parsed report", path: outputTarget.parsedReportPath, value: null },
    { kind: "gpt_code_report_normalized", label: "GPT CODE normalized report", path: outputTarget.normalizedReportPath, value: null },
    { kind: "gpt_code_report_cross_check", label: "GPT CODE evidence cross-check", path: outputTarget.crossCheckPath, value: null },
    { kind: "gpt_code_report_instruction", label: "GPT CODE next instruction", path: outputTarget.nextInstructionPath, value: null },
    { kind: "gpt_code_report_output_payload", label: "GPT CODE bridge output payload", path: outputTarget.outputPayloadPath, value: null },
  ];

  const shouldCloseSlice =
    reviewerResolution.verdict.verdict === "accept" &&
    normalizedReport.completionSignal.shouldCloseSliceCandidate &&
    !needsManualReview;
  const nextStatus = mapVerdictToStateStatus({
    verdict: reviewerResolution.verdict.verdict,
    shouldCloseSlice,
  });
  const transitioned = transitionStateForReportReview({
    state,
    nextStatus,
    now,
  });
  const shouldPrepareNextIteration =
    !needsManualReview &&
    reviewerResolution.verdict.verdict === "revise";

  const updated = orchestratorStateSchema.parse({
    ...transitioned,
    plannerDecision: plannerResolution.decision,
    nextIterationPlan: shouldPrepareNextIteration
      ? createNextIterationPlan({
          state: transitioned,
          plannerDecision: plannerResolution.decision,
        })
      : null,
    lastExecutionReport: {
      ...normalizedReport.executionReport,
      ciValidation: actualCiSummary,
      artifacts: reportArtifacts,
      risks: appendUnique(normalizedReport.executionReport.risks, [
        ...normalizedReport.parseWarnings,
        ...normalizedReport.missingFields.map((field) => `Missing field: ${field}`),
        ...evidenceCrossCheck.mismatches.map((entry) => entry.summary),
        ...evidenceCrossCheck.warnings,
      ]),
      recommendedNextStep: normalizedReport.recommendedNextStepCandidate,
      shouldCloseSlice,
    },
    lastReviewVerdict: {
      ...reviewerResolution.verdict,
      reasons: appendUnique(reviewerResolution.verdict.reasons, needsManualReview ? ["Manual review is required before auto-continuation."] : []),
      canAutoContinue: reviewerResolution.verdict.canAutoContinue && !needsManualReview,
    },
    lastCIStatus: actualCiSummary,
    lastPlannerProvider: plannerResolution.resolved,
    lastReviewerProvider: reviewerResolution.resolved,
    lastPlannerFallbackReason: plannerResolution.fallbackReason,
    lastReviewerFallbackReason: reviewerResolution.fallbackReason,
    statusReportStatus: state.statusReportStatus,
    stopReason:
      reviewerResolution.verdict.verdict === "stop"
        ? reviewerResolution.verdict.reasons[0] ?? "Report intake review requested stop."
        : reviewerResolution.verdict.verdict === "escalate" || needsManualReview
          ? "Report intake requires manual review."
          : null,
    updatedAt: now.toISOString(),
  });

  await params.dependencies.storage.saveState(updated);

  return gptCodeReportBridgeResultSchema.parse({
    stateId: state.id,
    status: needsManualReview ? "needs_manual_review" : "accepted",
    parsedReport,
    normalizedReport,
    evidenceCrossCheck,
    outputTarget,
    outputPayload,
    generatedAt: now.toISOString(),
  }) satisfies GptCodeReportBridgeResult;
}

export async function ingestGptCodeReportFromFile(params: {
  stateId: string;
  reportPath: string;
  dependencies: OrchestratorDependencies;
  outputRoot?: string;
}) {
  const reportText = await readFile(path.resolve(params.reportPath), "utf8");
  return ingestGptCodeReportIntoState({
    stateId: params.stateId,
    reportText,
    dependencies: params.dependencies,
    outputRoot: params.outputRoot,
  });
}
