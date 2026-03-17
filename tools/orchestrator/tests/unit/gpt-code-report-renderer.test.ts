import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { RuleBasedPlanner } from "../../src/planner";
import { RuleBasedReviewer } from "../../src/reviewer";
import {
  crossCheckGptCodeChineseReport,
  normalizeGptCodeChineseReport,
  parseGptCodeChineseReport,
  renderNextInstructionFromNormalizedReport,
} from "../../src/gpt-code-report";
import { inspectionSliceReport } from "./helpers/gpt-code-report-fixtures";

test("renderer emits the next-round Chinese instruction skeleton from normalized state and reviewer verdict", async () => {
  const normalized = normalizeGptCodeChineseReport(parseGptCodeChineseReport(inspectionSliceReport));
  const state = createInitialState({
    id: "gpt-code-report-renderer",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Keep report ingest MVP small",
    objective: "Normalize GPT CODE Chinese reports into orchestrator state",
    subtasks: ["schema", "parser", "normalize", "renderer"],
    allowedFiles: ["tools/orchestrator", "package.json", ".github/workflows/orchestrator-smoke.yml"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["normalized state is reviewer-compatible"],
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
  const crossCheck = crossCheckGptCodeChineseReport({
    normalizedReport: normalized,
    actualGitStatusShort: " M package-lock.json",
  });

  const rendered = renderNextInstructionFromNormalizedReport({
    normalizedReport: normalized,
    reviewVerdict: verdict,
    plannerDecision: decision,
    evidenceCrossCheck: crossCheck,
  });

  assert.match(rendered, /建議級別：小/);
  assert.match(rendered, /判斷理由/);
  assert.match(rendered, /本輪目標/);
  assert.match(rendered, /本輪驗收指令/);
  assert.match(rendered, /manual completion required|人工/);
});
