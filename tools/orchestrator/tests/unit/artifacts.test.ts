import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pruneOrchestratorArtifacts } from "../../src/artifacts";
import { createInitialState } from "../../src/orchestrator";
import { FileSystemWorkspaceManager } from "../../src/workspace";

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function createWorkspaceArtifact(root: string, taskId: string, iterationNumber: number) {
  const workspaceRoot = path.join(root, taskId, `iteration-${iterationNumber}`);
  await mkdir(path.join(workspaceRoot, ".orchestrator"), { recursive: true });
  await writeFile(path.join(workspaceRoot, ".orchestrator", "workspace.json"), JSON.stringify({
    id: `${taskId}:${iterationNumber}`,
    taskId,
    iterationNumber,
    rootDir: workspaceRoot,
    sourceRepoPath: root,
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
  }, null, 2));
  const diffPath = path.join(workspaceRoot, ".orchestrator", "diff.patch");
  await writeFile(diffPath, `diff-${iterationNumber}\n`, "utf8");
  return { workspaceRoot, diffPath };
}

test("artifact pruning retains recent and pending iterations while deleting old workspace artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-artifacts-"));
  const manager = new FileSystemWorkspaceManager(workspaceRoot);
  const state = createInitialState({
    id: "artifact-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Prune old artifacts",
    objective: "Exercise retention policy",
    subtasks: ["artifacts", "retention", "workspace", "storage"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["old artifacts pruned"],
    autoMode: true,
    approvalMode: "auto",
    workspaceRoot,
  });

  const art1 = await createWorkspaceArtifact(workspaceRoot, state.id, 1);
  const art2 = await createWorkspaceArtifact(workspaceRoot, state.id, 2);
  const art3 = await createWorkspaceArtifact(workspaceRoot, state.id, 3);

  const nextState = {
    ...state,
    iterationNumber: 3,
    patchStatus: "waiting_approval" as const,
    approvalStatus: "pending_patch" as const,
    iterationHistory: [
      {
        iterationNumber: 1,
        plannerProviderRequested: "rule_based" as const,
        plannerProviderResolved: "rule_based" as const,
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses" as const,
        executorProviderResolved: "openai_responses" as const,
        executorFallbackReason: null,
        executionMode: "dry_run" as const,
        reviewerProviderRequested: "rule_based" as const,
        reviewerProviderResolved: "rule_based" as const,
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: {
          iterationNumber: 1,
          changedFiles: ["tools/orchestrator/src/a.ts"],
          checkedButUnmodifiedFiles: [],
          summaryOfChanges: ["one"],
          whyThisWasDone: ["one"],
          howBehaviorWasKeptStable: ["one"],
          localValidation: [],
          ciValidation: null,
          blockers: ["blocked"],
          risks: [],
          recommendedNextStep: "retry",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "workspace", label: "workspace", path: art1.workspaceRoot, value: null },
            { kind: "diff", label: "diff", path: art1.diffPath, value: null },
          ],
        },
        reviewVerdict: { verdict: "revise" as const, reasons: [], violatedConstraints: [], missingValidation: [], suggestedPatchScope: [], canAutoContinue: false },
        ciSummary: null,
        patchStatus: "none" as const,
        approvalStatus: "not_requested" as const,
        artifactPruneResult: null,
        stateBefore: "planning" as const,
        stateAfter: "needs_revision" as const,
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
      {
        iterationNumber: 2,
        plannerProviderRequested: "rule_based" as const,
        plannerProviderResolved: "rule_based" as const,
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses" as const,
        executorProviderResolved: "openai_responses" as const,
        executorFallbackReason: null,
        executionMode: "dry_run" as const,
        reviewerProviderRequested: "rule_based" as const,
        reviewerProviderResolved: "rule_based" as const,
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: {
          iterationNumber: 2,
          changedFiles: ["tools/orchestrator/src/b.ts"],
          checkedButUnmodifiedFiles: [],
          summaryOfChanges: ["two"],
          whyThisWasDone: ["two"],
          howBehaviorWasKeptStable: ["two"],
          localValidation: [],
          ciValidation: null,
          blockers: [],
          risks: [],
          recommendedNextStep: "close",
          shouldCloseSlice: true,
          artifacts: [
            { kind: "workspace", label: "workspace", path: art2.workspaceRoot, value: null },
            { kind: "diff", label: "diff", path: art2.diffPath, value: null },
          ],
        },
        reviewVerdict: { verdict: "accept" as const, reasons: [], violatedConstraints: [], missingValidation: [], suggestedPatchScope: [], canAutoContinue: false },
        ciSummary: null,
        patchStatus: "none" as const,
        approvalStatus: "not_requested" as const,
        artifactPruneResult: null,
        stateBefore: "planning" as const,
        stateAfter: "completed" as const,
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
      {
        iterationNumber: 3,
        plannerProviderRequested: "rule_based" as const,
        plannerProviderResolved: "rule_based" as const,
        plannerFallbackReason: null,
        executorProviderRequested: "openai_responses" as const,
        executorProviderResolved: "openai_responses" as const,
        executorFallbackReason: null,
        executionMode: "apply" as const,
        reviewerProviderRequested: "rule_based" as const,
        reviewerProviderResolved: "rule_based" as const,
        reviewerFallbackReason: null,
        plannerDecision: null,
        executionReport: {
          iterationNumber: 3,
          changedFiles: ["tools/orchestrator/src/c.ts"],
          checkedButUnmodifiedFiles: [],
          summaryOfChanges: ["three"],
          whyThisWasDone: ["three"],
          howBehaviorWasKeptStable: ["three"],
          localValidation: [],
          ciValidation: null,
          blockers: [],
          risks: [],
          recommendedNextStep: "approve",
          shouldCloseSlice: false,
          artifacts: [
            { kind: "workspace", label: "workspace", path: art3.workspaceRoot, value: null },
            { kind: "diff", label: "diff", path: art3.diffPath, value: null },
          ],
        },
        reviewVerdict: { verdict: "accept" as const, reasons: [], violatedConstraints: [], missingValidation: [], suggestedPatchScope: [], canAutoContinue: false },
        ciSummary: null,
        patchStatus: "waiting_approval" as const,
        approvalStatus: "pending_patch" as const,
        artifactPruneResult: null,
        stateBefore: "planning" as const,
        stateAfter: "waiting_approval" as const,
        stopReason: null,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  const pruned = await pruneOrchestratorArtifacts({
    state: nextState,
    workspaceManager: manager,
    policy: {
      retainRecentSuccess: 0,
      retainRecentFailure: 0,
    },
  });

  assert.equal(await pathExists(art1.workspaceRoot), false);
  assert.equal(await pathExists(art2.workspaceRoot), false);
  assert.equal(await pathExists(art3.workspaceRoot), true);
  assert.equal(pruned.result.retainedIterations.includes(3), true);
});
