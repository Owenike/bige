import assert from "node:assert/strict";
import test from "node:test";
import { resolveActorAuthorization } from "../../src/actor-policy";

test("actor policy allows authorized run actors and approvers while restricting status-only actors", () => {
  const runDecision = resolveActorAuthorization({
    actor: { login: "orchestrator-runner", id: 1, type: "User" },
    command: "run",
    executionMode: "dry_run",
    approvalRequired: true,
    liveRequested: false,
  });
  assert.equal(runDecision.status, "authorized");

  const statusDecision = resolveActorAuthorization({
    actor: { login: "orchestrator-viewer", id: 2, type: "User" },
    command: "status",
    executionMode: "dry_run",
    approvalRequired: true,
    liveRequested: false,
  });
  assert.equal(statusDecision.status, "status_only");

  const rejectRun = resolveActorAuthorization({
    actor: { login: "orchestrator-viewer", id: 2, type: "User" },
    command: "run",
    executionMode: "dry_run",
    approvalRequired: true,
    liveRequested: false,
  });
  assert.equal(rejectRun.status, "rejected");
  assert.equal(rejectRun.blockedReason?.code, "actor_command_not_authorized");

  const approveDecision = resolveActorAuthorization({
    actor: { login: "orchestrator-approver", id: 3, type: "User" },
    command: "approve",
    executionMode: "dry_run",
    approvalRequired: true,
    liveRequested: false,
  });
  assert.equal(approveDecision.status, "authorized");
});
