import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticsSummary, formatDiagnosticsSummary } from "../../src/diagnostics";
import { createInitialState } from "../../src/orchestrator";

test("diagnostics summarize latest state, blocked reasons, and next action in a readable form", () => {
  const state = createInitialState({
    id: "diagnostics-state",
    repoPath: process.cwd(),
    repoName: "bige",
    userGoal: "Inspect orchestrator status",
    objective: "Build diagnostics summary",
    subtasks: ["preflight", "diagnostics", "storage", "reviewer"],
    successCriteria: ["operator summary is readable"],
  });

  state.status = "needs_revision";
  state.iterationNumber = 1;
  state.lastExecutionReport = {
    iterationNumber: 1,
    changedFiles: ["tools/orchestrator/src/cli.ts"],
    checkedButUnmodifiedFiles: [],
    summaryOfChanges: ["Recorded a diagnostic-friendly change set."],
    whyThisWasDone: ["Exercise diagnostics output."],
    howBehaviorWasKeptStable: ["Only orchestrator files changed."],
    localValidation: [],
    ciValidation: null,
    blockers: ["Need OPENAI_API_KEY for live acceptance."],
    risks: [],
    recommendedNextStep: "Provide OPENAI_API_KEY or continue with non-live paths.",
    shouldCloseSlice: false,
    artifacts: [],
  };
  state.lastReviewVerdict = {
    verdict: "revise",
    reasons: ["Preflight prerequisites are still missing."],
    violatedConstraints: [],
    missingValidation: [],
    suggestedPatchScope: ["tools/orchestrator/src/preflight/index.ts"],
    canAutoContinue: false,
  };
  state.lastBlockedReasons = [
    {
      code: "missing_openai_api_key",
      summary: "OpenAI live paths require OPENAI_API_KEY.",
      missingPrerequisites: ["OPENAI_API_KEY"],
      recoverable: true,
      suggestedNextAction: "Set OPENAI_API_KEY or use a non-live provider.",
    },
  ];
  state.lastPreflightResult = {
    checkedAt: new Date().toISOString(),
    profileId: state.task.profileId,
    availableProviders: ["planner:rule_based", "reviewer:rule_based", "executor:mock"],
    unavailableProviders: [{ name: "executor:openai_responses", reason: "OPENAI_API_KEY is missing." }],
    missingEnv: ["OPENAI_API_KEY"],
    missingTools: [],
    allowedExecutionModes: ["mock", "dry_run"],
    allowedHandoffModes: ["payload_only"],
    allowedPromotionModes: ["patch_export"],
    blockedReasons: state.lastBlockedReasons,
    targets: [
      {
        target: "live_acceptance",
        status: "blocked",
        blockedReasons: state.lastBlockedReasons,
        summary: "OpenAI live paths require OPENAI_API_KEY.",
      },
    ],
    summary: "Preflight found missing live prerequisites.",
  };

  const summary = buildDiagnosticsSummary(state);
  const rendered = formatDiagnosticsSummary(summary);

  assert.equal(summary.status, "needs_revision");
  assert.equal(summary.blockedReasons[0]?.code, "missing_openai_api_key");
  assert.equal(summary.nextSuggestedAction.includes("OPENAI_API_KEY"), true);
  assert.equal(rendered.includes("Blocked reasons:"), true);
  assert.equal(rendered.includes("Next action:"), true);
});
