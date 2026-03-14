import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileStorage } from "../../src/storage";
import { createInboundAuditRecord, formatInboundAuditSummary, saveInboundAuditRecord } from "../../src/inbound-audit";

test("inbound audit records are persisted and formatted for diagnostics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "orchestrator-inbound-audit-"));
  const storage = new FileStorage(root);
  const record = createInboundAuditRecord({
    id: "delivery-c",
    receivedAt: new Date().toISOString(),
    deliveryId: "delivery-c",
    eventType: "issue_comment",
    sourceEventType: "issue_comment_command",
    sourceEventId: "comment:9001",
    repository: "example/bige",
    issueNumber: 12,
    prNumber: null,
    commentId: 9001,
    actorIdentity: { login: "orchestrator-viewer", id: 2, type: "User" },
    signatureStatus: "verified",
    parsedCommand: {
      kind: "status",
      executionMode: null,
      profileOverride: null,
      approvalIntent: null,
      rawCommand: "/orchestrator status",
      arguments: [],
    },
    actorAuthorizationStatus: "status_only",
    actorAuthorizationReason: "viewer can only request status",
    replayProtectionStatus: "accepted",
    replayProtectionReason: "first seen",
    commandRoutingDecision: {
      status: "routed",
      action: "report_status",
      reasonCode: null,
      summary: "status requested",
      suggestedNextAction: "emit status",
      targetStateId: "issue-12-task",
    },
    linkedStateId: "issue-12-task",
    linkedRunId: null,
    statusReportCorrelationId: "orchestrator-status:issue-12-task",
    payloadPath: "payload.json",
    headersPath: "headers.json",
    summary: "status-only command accepted",
  });
  await saveInboundAuditRecord({
    storage,
    record,
  });
  const loaded = await storage.loadInboundAudit("delivery-c");
  assert.equal(loaded?.actorAuthorizationStatus, "status_only");
  assert.match(formatInboundAuditSummary(loaded!), /status-only command accepted/);
  const records = await storage.loadInboundAuditCollection();
  assert.equal(records.items.length, 1);
});
