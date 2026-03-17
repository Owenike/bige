import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { RuleBasedPlanner } from "../../src/planner";
import { RuleBasedReviewer } from "../../src/reviewer";
import { normalizeGptCodeChineseReport, parseGptCodeChineseReport, renderNextInstructionFromNormalizedReport } from "../../src/gpt-code-report";
import { completedSliceReport } from "../unit/helpers/gpt-code-report-fixtures";

test("Chinese report text can flow into normalized state, reviewer input, and next instruction rendering", async () => {
  const normalized = normalizeGptCodeChineseReport(parseGptCodeChineseReport(completedSliceReport));
  const state = createInitialState({
    id: "gpt-code-report-e2e",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Move report ingest toward a limited automation loop",
    objective: "Turn Chinese report text into canonical review input",
    subtasks: ["schema", "parser", "normalize", "reviewer", "renderer"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows/orchestrator-smoke.yml"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["reviewer can consume normalized report"],
    autoMode: true,
    approvalMode: "auto",
  });

  const planner = new RuleBasedPlanner();
  const decision = await planner.plan({
    state,
    previousExecutionReport: normalized.executionReport,
  });
  const reviewer = new RuleBasedReviewer();
  const verdict = await reviewer.review({
    state,
    decision,
    report: normalized.executionReport,
    ciSummary: normalized.ciSummary,
  });
  const rendered = renderNextInstructionFromNormalizedReport({
    normalizedReport: normalized,
    reviewVerdict: verdict,
    plannerDecision: decision,
  });

  assert.equal(verdict.verdict, "revise");
  assert.match(rendered, /先回報本輪收尾後的 CI run 狀態/);
  assert.match(rendered, /本輪實際要推進的方向/);
  assert.match(rendered, /Close the slice|等待 CI run 完成|Confirm the latest CI run/);
});
