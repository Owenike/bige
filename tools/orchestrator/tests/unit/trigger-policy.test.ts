import assert from "node:assert/strict";
import test from "node:test";
import { resolveTriggerPolicy } from "../../src/trigger-policy";

test("trigger policy maps labels and event types to profile, approval, and handoff defaults", () => {
  const labeledPr = resolveTriggerPolicy({
    type: "pull_request_labeled",
    repository: "example/bige",
    repoName: "bige",
    labels: ["orchestrator:handoff"],
  });
  assert.equal(labeledPr?.policyId, "label-live-review");
  assert.equal(labeledPr?.handoffConfig.githubHandoffEnabled, true);
  assert.equal(labeledPr?.approvalMode, "human_approval");

  const workflowDispatch = resolveTriggerPolicy({
    type: "workflow_dispatch",
    repository: "example/bige",
    repoName: "bige",
    labels: [],
  });
  assert.equal(workflowDispatch?.policyId, "workflow-dispatch-default");
  assert.equal(workflowDispatch?.executionMode, "dry_run");

  const unsupported = resolveTriggerPolicy({
    type: "unknown_event",
    repository: "example/bige",
    repoName: "bige",
    labels: [],
  });
  assert.equal(unsupported, null);
});
