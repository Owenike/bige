import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  inboundAuditRecordSchema,
  type ActorAuthorizationStatus,
  type ActorIdentity,
  type CommandRoutingDecision,
  type InboundAuditRecord,
  type ParsedCommand,
  type ReplayProtectionStatus,
  type SourceEventType,
  type WebhookEventType,
  type WebhookSignatureStatus,
} from "../schemas";
import type { StorageProvider } from "../storage";

export type ReplayProtectionDecision = {
  status: ReplayProtectionStatus;
  summary: string;
  duplicateRecordId: string | null;
};

export function buildInboundAuditId(params: {
  deliveryId: string | null;
  sourceEventId: string | null;
  receivedAt: string;
}) {
  return (
    params.deliveryId ??
    params.sourceEventId?.replace(/[^a-zA-Z0-9:_-]/g, "-") ??
    `inbound-${params.receivedAt.replace(/[^0-9]/g, "")}`
  );
}

export function buildInboundCorrelationId(params: {
  deliveryId: string | null;
  sourceEventId: string | null;
  stateId: string | null;
}) {
  return `inbound:${params.deliveryId ?? params.sourceEventId ?? params.stateId ?? "unknown"}`;
}

export async function persistInboundArtifacts(params: {
  outputRoot: string;
  auditId: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
}) {
  await mkdir(params.outputRoot, { recursive: true });
  const payloadPath = path.join(params.outputRoot, `${params.auditId}-payload.json`);
  const headersPath = path.join(params.outputRoot, `${params.auditId}-headers.json`);
  await writeFile(payloadPath, `${params.rawBody.trim()}\n`, "utf8");
  await writeFile(headersPath, `${JSON.stringify(params.headers, null, 2)}\n`, "utf8");
  return {
    payloadPath,
    headersPath,
  };
}

export async function evaluateReplayProtection(params: {
  storage: StorageProvider;
  deliveryId: string | null;
  sourceEventId: string | null;
  replayOverride?: boolean;
  signatureStatus: WebhookSignatureStatus;
}) {
  if (params.signatureStatus !== "verified") {
    return {
      status: "rejected",
      summary: "Replay protection rejected the inbound event because signature verification did not pass.",
      duplicateRecordId: null,
    } satisfies ReplayProtectionDecision;
  }

  const ids = await params.storage.listInboundAuditIds();
  const records = await Promise.all(ids.map((id) => params.storage.loadInboundAudit(id)));
  const existing = records.filter((record): record is InboundAuditRecord => Boolean(record));

  const deliveryMatch =
    params.deliveryId ? existing.find((record) => record.deliveryId === params.deliveryId) ?? null : null;
  if (deliveryMatch && !params.replayOverride) {
    return {
      status: "duplicate_delivery",
      summary: `Inbound delivery ${params.deliveryId} was already processed.`,
      duplicateRecordId: deliveryMatch.id,
    } satisfies ReplayProtectionDecision;
  }

  const eventMatch =
    params.sourceEventId ? existing.find((record) => record.sourceEventId === params.sourceEventId) ?? null : null;
  if (eventMatch && !params.replayOverride) {
    return {
      status: "duplicate_event",
      summary: `Inbound event ${params.sourceEventId} matches a previously processed webhook.`,
      duplicateRecordId: eventMatch.id,
    } satisfies ReplayProtectionDecision;
  }

  if (params.replayOverride && (deliveryMatch || eventMatch)) {
    return {
      status: "replayed",
      summary: "Inbound event was accepted with explicit replay override.",
      duplicateRecordId: deliveryMatch?.id ?? eventMatch?.id ?? null,
    } satisfies ReplayProtectionDecision;
  }

  return {
    status: "accepted",
    summary: "Inbound event passed replay protection.",
    duplicateRecordId: null,
  } satisfies ReplayProtectionDecision;
}

export async function saveInboundAuditRecord(params: {
  storage: StorageProvider;
  record: InboundAuditRecord;
}) {
  const parsed = inboundAuditRecordSchema.parse(params.record);
  await params.storage.saveInboundAudit(parsed);
  return parsed;
}

export function createInboundAuditRecord(params: {
  id: string;
  receivedAt: string;
  deliveryId: string | null;
  eventType: WebhookEventType;
  sourceEventType: SourceEventType;
  sourceEventId: string | null;
  repository: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  commentId: number | null;
  actorIdentity: ActorIdentity | null;
  signatureStatus: WebhookSignatureStatus;
  parsedCommand: ParsedCommand | null;
  actorAuthorizationStatus: ActorAuthorizationStatus;
  actorAuthorizationReason: string | null;
  replayProtectionStatus: ReplayProtectionStatus;
  replayProtectionReason: string | null;
  commandRoutingDecision: CommandRoutingDecision | null;
  linkedStateId: string | null;
  linkedRunId: string | null;
  statusReportCorrelationId: string | null;
  payloadPath: string | null;
  headersPath: string | null;
  summary: string;
}) {
  return inboundAuditRecordSchema.parse({
    ...params,
  });
}

export async function listInboundAuditRecords(storage: StorageProvider) {
  const collection = await storage.loadInboundAuditCollection();
  return collection.items.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
}

export function formatInboundAuditSummary(record: InboundAuditRecord) {
  return [
    `Inbound audit: ${record.id}`,
    `Received: ${record.receivedAt}`,
    `Event: ${record.eventType} / ${record.sourceEventType}`,
    `Delivery: ${record.deliveryId ?? "none"}`,
    `Actor: ${record.actorIdentity?.login ?? "none"}`,
    `Signature: ${record.signatureStatus}`,
    `Authorization: ${record.actorAuthorizationStatus} (${record.actorAuthorizationReason ?? "none"})`,
    `Replay: ${record.replayProtectionStatus} (${record.replayProtectionReason ?? "none"})`,
    `Routing: ${record.commandRoutingDecision?.status ?? "none"} / ${record.commandRoutingDecision?.action ?? "none"}`,
    `State: ${record.linkedStateId ?? "none"}`,
    `Correlation: ${record.statusReportCorrelationId ?? "none"}`,
    `Summary: ${record.summary}`,
  ].join("\n");
}
