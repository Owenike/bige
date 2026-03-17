import assert from "node:assert/strict";
import test from "node:test";
import { parseGptCodeChineseReport } from "../../src/gpt-code-report";
import { completedSliceReport, inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("parser extracts canonical sections from the common Chinese report skeleton", () => {
  const parsed = parseGptCodeChineseReport(completedSliceReport);

  assert.equal(parsed.suggestionLevel, "中");
  assert.match(parsed.judgmentReason ?? "", /正式收尾/);
  assert.deepEqual(parsed.modifiedFiles.map((entry) => entry.path), [
    "/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/schema.ts",
    "/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/index.ts",
  ]);
  assert.deepEqual(parsed.checkedButUnmodifiedFiles.map((entry) => entry.path), [
    "/c:/Users/User/bige/tools/orchestrator/src/reviewer/index.ts",
  ]);
  assert.equal(parsed.acceptanceResults.length, 4);
  assert.equal(parsed.ciRuns[1]?.runId, "23190000001");
  assert.equal(parsed.ciRuns[1]?.status, "success");
  assert.equal(parsed.gitStatusIsClean, false);
  assert.deepEqual(parsed.unrelatedDirtyChanges.map((entry) => entry.path), [
    "/c:/Users/User/bige/package-lock.json",
    "/c:/Users/User/bige/app/forgot-password/page.tsx",
  ]);
  assert.equal(parsed.confidence, "high");
});

test("parser tolerates inspection slices without commit or push", () => {
  const parsed = parseGptCodeChineseReport(inspectionSliceReport);

  assert.equal(parsed.suggestionLevel, null);
  assert.equal(parsed.modifiedFiles.length, 0);
  assert.equal(parsed.acceptanceResults.length, 2);
  assert.equal(parsed.ciRuns[0]?.status, "success");
  assert.equal(parsed.sections.commitPushRawLines.some((line) => /無 commit/i.test(line)), true);
  assert.equal(parsed.missingFields.includes("建議級別"), true);
  assert.equal(parsed.missingFields.includes("判斷理由"), true);
  assert.equal(parsed.confidence, "medium");
});
