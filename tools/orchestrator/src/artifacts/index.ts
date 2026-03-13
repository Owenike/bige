import path from "node:path";
import type { ArtifactPruneResult, IterationRecord, OrchestratorState } from "../schemas";
import { FileSystemWorkspaceManager } from "../workspace";

export type ArtifactRetentionPolicy = {
  retainRecentSuccess: number;
  retainRecentFailure: number;
};

export const DEFAULT_ARTIFACT_RETENTION_POLICY: ArtifactRetentionPolicy = {
  retainRecentSuccess: 3,
  retainRecentFailure: 5,
};

function isIterationProtected(state: OrchestratorState, record: IterationRecord) {
  if (record.iterationNumber === state.iterationNumber) return true;
  return ["patch_ready", "waiting_approval", "approved_for_apply"].includes(record.patchStatus);
}

function classifyIteration(record: IterationRecord) {
  if (record.reviewVerdict?.verdict === "accept") {
    return "success" as const;
  }
  return "failure" as const;
}

function collectArtifactRootPaths(record: IterationRecord) {
  const rootPaths = new Set<string>();
  for (const artifact of record.executionReport?.artifacts ?? []) {
    if (!artifact.path) continue;
    if (artifact.kind === "workspace") {
      rootPaths.add(artifact.path);
      continue;
    }
    const orchestratorIndex = artifact.path.indexOf(`${path.sep}.orchestrator${path.sep}`);
    if (orchestratorIndex > 0) {
      rootPaths.add(artifact.path.slice(0, orchestratorIndex));
      continue;
    }
    rootPaths.add(artifact.path);
  }
  return [...rootPaths];
}

function withPrunedArtifacts(record: IterationRecord, result: ArtifactPruneResult): IterationRecord {
  return {
    ...record,
    artifactPruneResult: result,
    executionReport: record.executionReport
      ? {
          ...record.executionReport,
          artifacts: record.executionReport.artifacts.map((artifact) => ({
            ...artifact,
            path: null,
          })),
        }
      : null,
  };
}

export async function pruneOrchestratorArtifacts(params: {
  state: OrchestratorState;
  workspaceManager: FileSystemWorkspaceManager;
  now?: Date;
  policy?: Partial<ArtifactRetentionPolicy>;
}) {
  const now = params.now ?? new Date();
  const policy: ArtifactRetentionPolicy = {
    retainRecentSuccess: params.policy?.retainRecentSuccess ?? params.state.task.artifactRetentionSuccess,
    retainRecentFailure: params.policy?.retainRecentFailure ?? params.state.task.artifactRetentionFailure,
  };

  const protectedIterations = new Set<number>();
  for (const record of params.state.iterationHistory) {
    if (isIterationProtected(params.state, record)) {
      protectedIterations.add(record.iterationNumber);
    }
  }

  const successRecords = params.state.iterationHistory
    .filter((record) => classifyIteration(record) === "success" && !protectedIterations.has(record.iterationNumber))
    .sort((left, right) => right.iterationNumber - left.iterationNumber);
  const failureRecords = params.state.iterationHistory
    .filter((record) => classifyIteration(record) === "failure" && !protectedIterations.has(record.iterationNumber))
    .sort((left, right) => right.iterationNumber - left.iterationNumber);

  const retainedIterations = new Set<number>(protectedIterations);
  for (const record of successRecords.slice(0, policy.retainRecentSuccess)) {
    retainedIterations.add(record.iterationNumber);
  }
  for (const record of failureRecords.slice(0, policy.retainRecentFailure)) {
    retainedIterations.add(record.iterationNumber);
  }

  const deletedPaths: string[] = [];
  const skippedReasons: string[] = [];
  const nextHistory: IterationRecord[] = [];

  for (const record of params.state.iterationHistory) {
    if (retainedIterations.has(record.iterationNumber) || !record.executionReport) {
      nextHistory.push(record);
      continue;
    }

    const rootPaths = collectArtifactRootPaths(record);
    for (const rootPath of rootPaths) {
      try {
        await params.workspaceManager.cleanupPath(rootPath);
        deletedPaths.push(rootPath);
      } catch (error) {
        skippedReasons.push(
          `Failed to prune iteration ${record.iterationNumber} artifact at ${rootPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const pruneResult: ArtifactPruneResult = {
      status: deletedPaths.length > 0 ? "pruned" : "skipped",
      retainedIterations: [...retainedIterations].sort((left, right) => left - right),
      deletedPaths: [...deletedPaths],
      skippedReasons: [...skippedReasons],
      summary:
        deletedPaths.length > 0
          ? `Pruned ${deletedPaths.length} artifact roots for iteration ${record.iterationNumber}.`
          : `No artifact roots were pruned for iteration ${record.iterationNumber}.`,
      prunedAt: now.toISOString(),
    };
    nextHistory.push(withPrunedArtifacts(record, pruneResult));
  }

  const lastArtifactPruneResult: ArtifactPruneResult = {
    status: deletedPaths.length > 0 ? "pruned" : skippedReasons.length > 0 ? "failed" : "skipped",
    retainedIterations: [...retainedIterations].sort((left, right) => left - right),
    deletedPaths,
    skippedReasons,
    summary:
      deletedPaths.length > 0
        ? `Pruned ${deletedPaths.length} artifact roots while retaining iterations ${[...retainedIterations].sort((left, right) => left - right).join(", ")}.`
        : "No artifacts were pruned.",
    prunedAt: now.toISOString(),
  };

  return {
    state: {
      ...params.state,
      iterationHistory: nextHistory,
      lastArtifactPruneResult,
      updatedAt: now.toISOString(),
    } satisfies OrchestratorState,
    result: lastArtifactPruneResult,
  };
}
