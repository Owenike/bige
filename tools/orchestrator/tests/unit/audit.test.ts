import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { writeIterationAuditTrail } from "../../src/audit";
import { createInitialState } from "../../src/orchestrator";

test("writeIterationAuditTrail persists a structured audit payload", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "orchestrator-audit-"));
  const state = createInitialState({
    id: "audit-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Persist audit trail",
    objective: "Write audit artifact",
    subtasks: ["audit", "storage", "iteration", "artifacts"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["audit file written"],
  });

  const { auditPath } = await writeIterationAuditTrail({
    state: {
      ...state,
      iterationNumber: 2,
      patchStatus: "promotion_ready",
      approvalStatus: "approved",
      promotionStatus: "branch_ready",
      handoffStatus: "handoff_ready",
      liveAcceptanceStatus: "passed",
      livePassStatus: "passed",
      lastExecutionReport: {
        iterationNumber: 2,
        changedFiles: ["tools/orchestrator/src/example.ts"],
        checkedButUnmodifiedFiles: [],
        summaryOfChanges: ["wrote audit output"],
        whyThisWasDone: ["prove audit persistence"],
        howBehaviorWasKeptStable: ["orchestrator only"],
        localValidation: [],
        ciValidation: null,
        blockers: [],
        risks: [],
        recommendedNextStep: "handoff",
        shouldCloseSlice: false,
        artifacts: [],
      },
    },
    outputRoot,
  });

  const payload = JSON.parse(await readFile(auditPath, "utf8")) as { handoffStatus: string; livePassStatus: string };
  assert.equal(payload.handoffStatus, "handoff_ready");
  assert.equal(payload.livePassStatus, "passed");
});
