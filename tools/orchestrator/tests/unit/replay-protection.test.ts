import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileStorage } from "../../src/storage";
import { createInboundAuditRecord, evaluateReplayProtection, saveInboundAuditRecord } from "../../src/inbound-audit";

test("replay protection rejects duplicate deliveries and allows explicit replay override", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-replay-"));
  const storage = new FileStorage(root);
  await saveInboundAuditRecord({
    storage,
    record: createInboundAuditRecord({
      id: "delivery-a",
      receivedAt: new Date().toISOString(),
      deliveryId: "delivery-a",
      eventType: "issues",
      sourceEventType: "issue_opened",
      sourceEventId: "issue:11:opened",
      repository: "example/bige",
      issueNumber: 11,
      prNumber: null,
      commentId: null,
      actorIdentity: { login: "orchestrator-runner", id: 1, type: "User" },
      signatureStatus: "verified",
      parsedCommand: null,
      actorAuthorizationStatus: "authorized",
      actorAuthorizationReason: "ok",
      replayProtectionStatus: "accepted",
      replayProtectionReason: "ok",
      commandRoutingDecision: null,
      linkedStateId: "issue-11",
      linkedRunId: null,
      statusReportCorrelationId: "inbound:delivery-a",
      payloadPath: null,
      headersPath: null,
      summary: "first delivery",
    }),
  });

  const duplicate = await evaluateReplayProtection({
    storage,
    deliveryId: "delivery-a",
    sourceEventId: "issue:11:opened",
    signatureStatus: "verified",
  });
  assert.equal(duplicate.status, "duplicate_delivery");

  const replay = await evaluateReplayProtection({
    storage,
    deliveryId: "delivery-a",
    sourceEventId: "issue:11:opened",
    replayOverride: true,
    signatureStatus: "verified",
  });
  assert.equal(replay.status, "replayed");
});

test("replay protection rejects inbound events when signature verification has already failed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-replay-invalid-"));
  const storage = new FileStorage(root);
  const result = await evaluateReplayProtection({
    storage,
    deliveryId: "delivery-b",
    sourceEventId: "issue:12:opened",
    signatureStatus: "invalid_signature",
  });
  assert.equal(result.status, "rejected");
});
