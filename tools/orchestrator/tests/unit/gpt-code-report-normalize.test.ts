import assert from "node:assert/strict";
import test from "node:test";
import { crossCheckGptCodeChineseReport, normalizeGptCodeChineseReport, parseGptCodeChineseReport } from "../../src/gpt-code-report";
import { completedSliceReport, inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("normalize maps parsed Chinese report facts into execution-report-compatible state", () => {
  const normalized = normalizeGptCodeChineseReport(parseGptCodeChineseReport(completedSliceReport));

  assert.deepEqual(normalized.executionReport.changedFiles, [
    "/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/schema.ts",
    "/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/index.ts",
  ]);
  assert.equal(normalized.validationSummary.passedCount, 4);
  assert.equal(normalized.ciSummary?.runId, "23190000001");
  assert.equal(normalized.ciSummary?.status, "success");
  assert.equal(normalized.dirtyTreeSummary.isClean, false);
  assert.deepEqual(normalized.dirtyTreeSummary.unrelatedFiles, [
    "/c:/Users/User/bige/package-lock.json",
    "/c:/Users/User/bige/app/forgot-password/page.tsx",
  ]);
  assert.equal(normalized.commitPushSummary.hasCommit, true);
  assert.equal(normalized.commitPushSummary.hasPush, true);
  assert.equal(normalized.completionSignal.functionallyComplete, false);
  assert.match(normalized.recommendedNextStepCandidate, /等待 CI run 完成/);
});

test("cross-check flags mismatches without auto-failing the slice", () => {
  const normalized = normalizeGptCodeChineseReport(parseGptCodeChineseReport(inspectionSliceReport));
  const crossCheck = crossCheckGptCodeChineseReport({
    normalizedReport: normalized,
    actualCI: {
      provider: "github",
      workflowName: "orchestrator",
      runId: "23182278367",
      status: "failure",
      jobs: [],
      summary: "actual mismatch",
    },
    actualGitStatusShort: " M package-lock.json\n M .env.example",
    actualValidationSummary: [
      { command: "git status --short", status: "passed", output: null },
    ],
  });

  assert.equal(crossCheck.status, "mismatch");
  assert.equal(crossCheck.needsManualReview, true);
  assert.equal(crossCheck.mismatches.some((entry) => entry.field === "ci_status"), true);
  assert.equal(crossCheck.mismatches.some((entry) => entry.field === "git_dirty_tree"), true);
});
