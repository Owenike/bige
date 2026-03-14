import assert from "node:assert/strict";
import test from "node:test";
import { parseOrchestratorCommand, routeParsedCommand } from "../../src/commands";

test("command parser normalizes supported orchestrator comment grammar", () => {
  const parsed = parseOrchestratorCommand("please handle this\n/orchestrator dry-run profile=ops mode=dry-run");
  assert(parsed);
  assert.equal(parsed.kind, "dry_run");
  assert.equal(parsed.profileOverride, "ops");
  assert.equal(parsed.executionMode, "dry_run");
  assert.equal(parsed.rawCommand, "/orchestrator dry-run profile=ops mode=dry-run");
});

test("command router rejects commands that need an existing state", () => {
  const parsed = parseOrchestratorCommand("/orchestrator approve");
  assert(parsed);
  const routed = routeParsedCommand({
    command: parsed,
    policy: {
      policyId: "comment-command-default",
      profileId: "default",
      executionMode: "dry_run",
      autoMode: false,
      approvalMode: "human_approval",
      handoffConfig: {
        githubHandoffEnabled: false,
        publishBranch: false,
        createBranch: true,
      },
      triggerReason: "comment",
      matchedLabels: [],
      allowedCommands: ["approve"],
    },
    existingStateId: null,
  });
  assert.equal(routed.status, "rejected");
  assert.equal(routed.reasonCode, "missing_target_state");
});

test("command router accepts status reporting for an existing state", () => {
  const parsed = parseOrchestratorCommand("/orchestrator status");
  assert(parsed);
  const routed = routeParsedCommand({
    command: parsed,
    policy: {
      policyId: "comment-command-default",
      profileId: "default",
      executionMode: "dry_run",
      autoMode: false,
      approvalMode: "human_approval",
      handoffConfig: {
        githubHandoffEnabled: false,
        publishBranch: false,
        createBranch: true,
      },
      triggerReason: "comment",
      matchedLabels: [],
      allowedCommands: ["status"],
    },
    existingStateId: "existing-state",
  });
  assert.equal(routed.status, "routed");
  assert.equal(routed.action, "report_status");
});
