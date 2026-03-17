import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { OrchestratorDependencies } from "../orchestrator";
import {
  gptCodeAutomationStateSchema,
  orchestratorStateSchema,
  type GptCodeAutomationState,
  type OrchestratorState,
} from "../schemas";
import { ingestGptCodeReportIntoState } from "../gpt-code-report-bridge";
import {
  gptCodeDispatchEnvelopeSchema,
  gptCodeDispatchGateDecisionSchema,
  gptCodeTransportDispatchResultSchema,
  gptCodeTransportEntryResultSchema,
  gptCodeTransportWatcherSummarySchema,
  type GptCodeReportBridgeResult,
  type GptCodeTransportSource,
} from "../gpt-code-report/schema";

function appendArtifacts(
  state: OrchestratorState,
  artifacts: Array<{ kind: string; label: string; path: string | null; value: string | null }>,
) {
  if (!state.lastExecutionReport) {
    return state;
  }

  return orchestratorStateSchema.parse({
    ...state,
    lastExecutionReport: {
      ...state.lastExecutionReport,
      artifacts: [...state.lastExecutionReport.artifacts, ...artifacts],
    },
  });
}

function buildAutomationState(params: {
  current: GptCodeAutomationState | null | undefined;
  patch: Partial<GptCodeAutomationState>;
}) {
  return gptCodeAutomationStateSchema.parse({
    ...(params.current ?? {}),
    ...params.patch,
  });
}

async function saveStateWithAutomationPatch(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  patch: Partial<GptCodeAutomationState>;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const updated = orchestratorStateSchema.parse({
    ...params.state,
    lastGptCodeAutomationState: buildAutomationState({
      current: params.state.lastGptCodeAutomationState,
      patch: params.patch,
    }),
    updatedAt: now.toISOString(),
  });
  await params.dependencies.storage.saveState(updated);
  return updated;
}

function resolveTransportRoot(params: {
  repoPath: string;
  stateId: string;
  transportRoot?: string;
}) {
  return (
    params.transportRoot ??
    path.join(params.repoPath, ".tmp", "orchestrator-report-transport", params.stateId, "latest")
  );
}

function resolveDispatchRoot(params: {
  repoPath: string;
  stateId: string;
  dispatchRoot?: string;
}) {
  return (
    params.dispatchRoot ??
    path.join(params.repoPath, ".tmp", "orchestrator-auto-dispatch", params.stateId, "latest")
  );
}

export function evaluateGptCodeAutoDispatchGate(params: {
  bridgeResult: GptCodeReportBridgeResult;
  state: OrchestratorState;
}) {
  const reasons: string[] = [];
  const verdict = params.state.lastReviewVerdict?.verdict ?? params.bridgeResult.outputPayload.reviewVerdict;

  if (params.bridgeResult.parsedReport.confidence === "low") {
    reasons.push("Report confidence is low.");
  }
  if (params.bridgeResult.parsedReport.missingFields.length > 0) {
    reasons.push("Critical report fields are missing.");
  }
  if (params.bridgeResult.evidenceCrossCheck.needsManualReview) {
    reasons.push("Evidence cross-check requires manual review.");
  }
  if (params.bridgeResult.outputPayload.needsManualReview) {
    reasons.push("Bridge output is marked needs_manual_review.");
  }
  if (verdict === "stop" || verdict === "escalate") {
    reasons.push(`Reviewer verdict ${verdict} is not auto-dispatchable.`);
  }
  if (verdict === "accept" && params.state.lastExecutionReport?.shouldCloseSlice) {
    return gptCodeDispatchGateDecisionSchema.parse({
      status: "not_needed",
      reasons: ["Slice is already closable; no next instruction dispatch is needed."],
      recommendedNextStep: "Close the slice without auto-dispatch.",
    });
  }
  if (verdict !== "revise") {
    reasons.push(`Reviewer verdict ${verdict} does not produce a next-round dispatch.`);
  }
  if (!params.state.nextIterationPlan && verdict === "revise") {
    reasons.push("Next iteration plan is missing.");
  }

  if (reasons.length > 0) {
    return gptCodeDispatchGateDecisionSchema.parse({
      status: "manual_required",
      reasons,
      recommendedNextStep:
        params.bridgeResult.normalizedReport.recommendedNextStepCandidate || "Review the report transport result manually.",
    });
  }

  return gptCodeDispatchGateDecisionSchema.parse({
    status: "ready",
    reasons: [],
    recommendedNextStep: params.bridgeResult.outputPayload.recommendedNextStep,
  });
}

export async function submitGptCodeReportTransportEntry(params: {
  stateId: string;
  reportText: string;
  source: GptCodeTransportSource;
  dependencies: OrchestratorDependencies;
  transportRoot?: string;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const state = await params.dependencies.storage.loadState(params.stateId);
  if (!state) {
    throw new Error(`State ${params.stateId} was not found.`);
  }

  const artifactRoot = resolveTransportRoot({
    repoPath: state.task.repoPath,
    stateId: state.id,
    transportRoot: params.transportRoot,
  });
  await mkdir(artifactRoot, { recursive: true });

  const intakeArtifactPath = path.join(artifactRoot, "incoming-report.md");
  const requestPath = path.join(artifactRoot, "transport-request.json");

  await writeFile(intakeArtifactPath, `${params.reportText.trim()}\n`, "utf8");
  await writeFile(
    requestPath,
    `${JSON.stringify(
      {
        stateId: state.id,
        source: params.source,
        receivedAt: now.toISOString(),
        intakeArtifactPath,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await saveStateWithAutomationPatch({
    state,
    dependencies: params.dependencies,
    patch: {
      transportSource: params.source,
      intakeStatus: "queued",
      bridgeStatus: "not_run",
      dispatchStatus: "not_queued",
      dispatchOutcome: "not_run",
      intakeArtifactPath,
      bridgeArtifactRoot: null,
      outputPayloadPath: null,
      nextInstructionPath: null,
      dispatchArtifactPath: null,
      dispatchTarget: "repo_local_outbox",
      lastReceivedAt: now.toISOString(),
      lastAttemptedAt: null,
      lastDispatchedAt: null,
      recommendedNextStep: "Run the transport watcher to bridge and dispatch the report.",
      manualReviewReason: null,
    },
  });

  return gptCodeTransportEntryResultSchema.parse({
    stateId: state.id,
    status: "queued",
    transportSource: params.source,
    intakeArtifactPath,
    generatedAt: now.toISOString(),
  });
}

async function writeDispatchArtifacts(params: {
  state: OrchestratorState;
  bridgeResult: GptCodeReportBridgeResult;
  dispatchRoot?: string;
  dependencies: OrchestratorDependencies;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const artifactRoot = resolveDispatchRoot({
    repoPath: params.state.task.repoPath,
    stateId: params.state.id,
    dispatchRoot: params.dispatchRoot,
  });
  await mkdir(artifactRoot, { recursive: true });

  const nextInstructionPath = path.join(artifactRoot, "next-instruction.md");
  const dispatchArtifactPath = path.join(artifactRoot, "dispatch-envelope.json");
  const dispatchResultPath = path.join(artifactRoot, "dispatch-result.json");

  await writeFile(nextInstructionPath, `${params.bridgeResult.outputPayload.nextInstruction.trim()}\n`, "utf8");

  const envelope = gptCodeDispatchEnvelopeSchema.parse({
    stateId: params.state.id,
    dispatchedAt: now.toISOString(),
    dispatchTarget: "repo_local_outbox",
    consumer: "gpt_code_report_transport_watcher",
    nextInstruction: params.bridgeResult.outputPayload.nextInstruction,
    outputPayloadPath: params.bridgeResult.outputTarget.outputPayloadPath,
    nextInstructionPath: params.bridgeResult.outputTarget.nextInstructionPath,
    reviewVerdict: params.bridgeResult.outputPayload.reviewVerdict,
    needsManualReview: params.bridgeResult.outputPayload.needsManualReview,
  });

  await writeFile(dispatchArtifactPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(
    dispatchResultPath,
    `${JSON.stringify(
      {
        stateId: params.state.id,
        status: "success",
        dispatchTarget: envelope.dispatchTarget,
        dispatchArtifactPath,
        nextInstructionPath,
        generatedAt: now.toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    artifactRoot,
    nextInstructionPath,
    dispatchArtifactPath,
    dispatchResultPath,
  };
}

export async function consumeQueuedGptCodeReportTransport(params: {
  stateId: string;
  dependencies: OrchestratorDependencies;
  bridgeOutputRoot?: string;
  dispatchRoot?: string;
  actualGitStatusShort?: string | null;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const initialState = await params.dependencies.storage.loadState(params.stateId);
  if (!initialState) {
    throw new Error(`State ${params.stateId} was not found.`);
  }

  const automationState = initialState.lastGptCodeAutomationState;
  if (!automationState?.intakeArtifactPath) {
    throw new Error(`State ${params.stateId} does not have a queued GPT CODE transport artifact.`);
  }

  const reportText = await readFile(automationState.intakeArtifactPath, "utf8");
  const bridgeResult = await ingestGptCodeReportIntoState({
    stateId: params.stateId,
    reportText,
    dependencies: params.dependencies,
    outputRoot: params.bridgeOutputRoot,
    actualGitStatusShort: params.actualGitStatusShort,
  });

  let state = await params.dependencies.storage.loadState(params.stateId);
  if (!state) {
    throw new Error(`State ${params.stateId} disappeared after bridge ingest.`);
  }

  const gateDecision = evaluateGptCodeAutoDispatchGate({
    bridgeResult,
    state,
  });

  if (gateDecision.status === "ready") {
    const dispatchArtifacts = await writeDispatchArtifacts({
      state,
      bridgeResult,
      dispatchRoot: params.dispatchRoot,
      dependencies: params.dependencies,
    });

    state = appendArtifacts(state, [
      {
        kind: "gpt_code_dispatch_instruction",
        label: "GPT CODE dispatch instruction copy",
        path: dispatchArtifacts.nextInstructionPath,
        value: null,
      },
      {
        kind: "gpt_code_dispatch_envelope",
        label: "GPT CODE dispatch envelope",
        path: dispatchArtifacts.dispatchArtifactPath,
        value: null,
      },
      {
        kind: "gpt_code_dispatch_result",
        label: "GPT CODE dispatch result",
        path: dispatchArtifacts.dispatchResultPath,
        value: null,
      },
    ]);

    state = orchestratorStateSchema.parse({
      ...state,
      lastGptCodeAutomationState: buildAutomationState({
        current: state.lastGptCodeAutomationState,
        patch: {
          transportSource: state.lastGptCodeAutomationState?.transportSource ?? "manual",
          intakeStatus: "accepted",
          bridgeStatus: bridgeResult.status === "accepted" ? "accepted" : "needs_manual_review",
          dispatchStatus: "dispatched",
          dispatchTarget: "repo_local_outbox",
          dispatchOutcome: "success",
          intakeArtifactPath: automationState.intakeArtifactPath,
          bridgeArtifactRoot: bridgeResult.outputTarget.artifactRoot,
          outputPayloadPath: bridgeResult.outputTarget.outputPayloadPath,
          nextInstructionPath: dispatchArtifacts.nextInstructionPath,
          dispatchArtifactPath: dispatchArtifacts.dispatchArtifactPath,
          lastAttemptedAt: now.toISOString(),
          lastDispatchedAt: now.toISOString(),
          recommendedNextStep: bridgeResult.outputPayload.recommendedNextStep,
          manualReviewReason: null,
        },
      }),
      updatedAt: now.toISOString(),
    });
    await params.dependencies.storage.saveState(state);

    return gptCodeTransportDispatchResultSchema.parse({
      stateId: state.id,
      intakeStatus: "accepted",
      bridgeStatus: bridgeResult.status === "accepted" ? "accepted" : "needs_manual_review",
      dispatchStatus: "dispatched",
      dispatchTarget: "repo_local_outbox",
      dispatchArtifactPath: dispatchArtifacts.dispatchArtifactPath,
      outputPayloadPath: bridgeResult.outputTarget.outputPayloadPath,
      nextInstructionPath: dispatchArtifacts.nextInstructionPath,
      generatedAt: now.toISOString(),
    });
  }

  state = orchestratorStateSchema.parse({
    ...state,
    lastGptCodeAutomationState: buildAutomationState({
      current: state.lastGptCodeAutomationState,
      patch: {
        transportSource: state.lastGptCodeAutomationState?.transportSource ?? "manual",
        intakeStatus: gateDecision.status === "manual_required" ? "manual_required" : "accepted",
        bridgeStatus: bridgeResult.status === "accepted" ? "accepted" : "needs_manual_review",
        dispatchStatus: gateDecision.status === "manual_required" ? "manual_required" : "not_queued",
        dispatchTarget: "repo_local_outbox",
        dispatchOutcome: gateDecision.status === "manual_required" ? "manual_required" : "not_run",
        intakeArtifactPath: automationState.intakeArtifactPath,
        bridgeArtifactRoot: bridgeResult.outputTarget.artifactRoot,
        outputPayloadPath: bridgeResult.outputTarget.outputPayloadPath,
        nextInstructionPath: bridgeResult.outputTarget.nextInstructionPath,
        dispatchArtifactPath: null,
        lastAttemptedAt: now.toISOString(),
        lastDispatchedAt: null,
        recommendedNextStep: gateDecision.recommendedNextStep,
        manualReviewReason: gateDecision.reasons.join(" | ") || null,
      },
    }),
    updatedAt: now.toISOString(),
  });
  await params.dependencies.storage.saveState(state);

  return gptCodeTransportDispatchResultSchema.parse({
    stateId: state.id,
    intakeStatus: gateDecision.status === "manual_required" ? "manual_required" : "accepted",
    bridgeStatus: bridgeResult.status === "accepted" ? "accepted" : "needs_manual_review",
    dispatchStatus: gateDecision.status === "manual_required" ? "manual_required" : "not_needed",
    dispatchTarget: gateDecision.status === "manual_required" ? "repo_local_outbox" : null,
    dispatchArtifactPath: null,
    outputPayloadPath: bridgeResult.outputTarget.outputPayloadPath,
    nextInstructionPath: bridgeResult.outputTarget.nextInstructionPath,
    generatedAt: now.toISOString(),
  });
}

export async function runGptCodeReportTransportWatcher(params: {
  dependencies: OrchestratorDependencies;
  stateId?: string;
  bridgeOutputRootByStateId?: Record<string, string>;
  dispatchRootByStateId?: Record<string, string>;
  actualGitStatusShortByStateId?: Record<string, string | null>;
}) {
  const now = (params.dependencies.now ?? (() => new Date()))();
  const candidateIds = params.stateId ? [params.stateId] : await params.dependencies.storage.listStateIds();
  const summary = {
    processedStateIds: [] as string[],
    dispatchedStateIds: [] as string[],
    manualReviewStateIds: [] as string[],
    failedStateIds: [] as string[],
    generatedAt: now.toISOString(),
  };

  for (const stateId of candidateIds) {
    const state = await params.dependencies.storage.loadState(stateId);
    if (!state?.lastGptCodeAutomationState || state.lastGptCodeAutomationState.intakeStatus !== "queued") {
      continue;
    }

    summary.processedStateIds.push(stateId);
    try {
      const result = await consumeQueuedGptCodeReportTransport({
        stateId,
        dependencies: params.dependencies,
        bridgeOutputRoot: params.bridgeOutputRootByStateId?.[stateId],
        dispatchRoot: params.dispatchRootByStateId?.[stateId],
        actualGitStatusShort: params.actualGitStatusShortByStateId?.[stateId],
      });
      if (result.dispatchStatus === "dispatched") {
        summary.dispatchedStateIds.push(stateId);
      } else {
        summary.manualReviewStateIds.push(stateId);
      }
    } catch {
      summary.failedStateIds.push(stateId);
      const failedState = await params.dependencies.storage.loadState(stateId);
      if (failedState) {
        await saveStateWithAutomationPatch({
          state: failedState,
          dependencies: params.dependencies,
          patch: {
            intakeStatus: "failed",
            bridgeStatus: "failed",
            dispatchStatus: "failed",
            dispatchOutcome: "failed",
            lastAttemptedAt: now.toISOString(),
            recommendedNextStep: "Inspect the transport watcher failure and rerun manually.",
            manualReviewReason: "Transport watcher failed before dispatch.",
          },
        });
      }
    }
  }

  return gptCodeTransportWatcherSummarySchema.parse(summary);
}
