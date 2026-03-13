import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { AuditTrail, OrchestratorState } from "../schemas";

function collectArtifactPaths(state: OrchestratorState) {
  const artifactPaths = new Set<string>();
  for (const artifact of state.lastExecutionReport?.artifacts ?? []) {
    if (artifact.path) {
      artifactPaths.add(artifact.path);
    }
  }
  for (const artifactPath of state.exportArtifactPaths) {
    artifactPaths.add(artifactPath);
  }
  if (state.lastHandoffPackagePath) {
    artifactPaths.add(state.lastHandoffPackagePath);
  }
  if (state.lastPrDraftMetadata?.payloadPath) {
    artifactPaths.add(state.lastPrDraftMetadata.payloadPath);
  }
  return [...artifactPaths];
}

export async function writeIterationAuditTrail(params: {
  state: OrchestratorState;
  outputRoot: string;
}) {
  const report = params.state.lastExecutionReport;
  const iterationNumber = Math.max(
    report?.iterationNumber ??
      params.state.iterationHistory[params.state.iterationHistory.length - 1]?.iterationNumber ??
      params.state.iterationNumber,
    1,
  );
  const createdAt = new Date().toISOString();
  const auditDir = path.join(params.outputRoot, params.state.id, `iteration-${iterationNumber}`);
  await mkdir(auditDir, { recursive: true });
  const auditPath = path.join(auditDir, "audit-trail.json");

  const auditTrail: AuditTrail = {
    iterationNumber,
    stateStatus: params.state.status,
    patchStatus: params.state.patchStatus,
    promotionStatus: params.state.promotionStatus,
    handoffStatus: params.state.handoffStatus,
    liveAcceptanceStatus: params.state.liveAcceptanceStatus,
    livePassStatus: params.state.livePassStatus,
    summary: [
      `planner=${params.state.lastPlannerProvider ?? "n/a"}`,
      `reviewer=${params.state.lastReviewerProvider ?? "n/a"}`,
      `stopReason=${params.state.stopReason ?? "none"}`,
    ].join(" | "),
    artifactPaths: collectArtifactPaths(params.state),
    createdAt,
  };

  await writeFile(
    auditPath,
    `${JSON.stringify(
      {
        ...auditTrail,
        plannerDecision: params.state.plannerDecision,
        reviewVerdict: params.state.lastReviewVerdict,
        cleanupDecision: params.state.lastCleanupDecision,
        liveAcceptanceResult: params.state.lastLiveAcceptanceResult,
        lastLiveSmokeResult: params.state.lastLiveSmokeResult,
        prDraftMetadata: params.state.lastPrDraftMetadata,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    auditTrail,
    auditPath,
  };
}
