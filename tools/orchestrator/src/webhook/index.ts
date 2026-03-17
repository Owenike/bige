import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import {
  approvePendingPatch,
  approvePendingPlan,
  rejectPendingPatch,
  rejectPendingPlan,
  type OrchestratorDependencies,
} from "../orchestrator";
import { resolveActorAuthorization } from "../actor-policy";
import { loadActorPolicyConfig, type LoadedActorPolicyConfig } from "../actor-policy-config";
import { routeParsedCommand } from "../commands";
import {
  buildInboundAuditId,
  buildInboundCorrelationId,
  createInboundAuditRecord,
  evaluateReplayProtection,
  persistInboundArtifacts,
  saveInboundAuditRecord,
} from "../inbound-audit";
import {
  findLatestStateForThread,
  ingestGitHubEvent,
  normalizeGitHubEvent,
  type EventIngestionResult,
} from "../github-events";
import { applyQueueItemToState, enqueueStateRun } from "../queue";
import { applyStatusReportToState, reportStateStatus, type StatusReportingAdapter } from "../status-reporting";
import { resolveTriggerPolicy } from "../trigger-policy";
import {
  blockedReasonSchema,
  orchestratorStateSchema,
  type ActorIdentity,
  type BlockedReason,
  type CommandRoutingDecision,
  type OrchestratorState,
  type StatusReportSummary,
  type WebhookEventType,
  type WebhookSignatureStatus,
} from "../schemas";
import {
  extractGptCodeReportFromGitHubComment,
  runGptCodeExternalAutomationFromWebhook,
  type GptCodeExternalTargetAdapter,
} from "../gpt-code-external-automation";

export type ParsedGitHubWebhook = {
  eventType: WebhookEventType;
  deliveryId: string | null;
  signature: string | null;
};

export type WebhookIngestionResult = {
  status: "created" | "linked_existing" | "replayed" | "routed" | "rejected" | "duplicate";
  signatureStatus: WebhookSignatureStatus;
  blockedReason: BlockedReason | null;
  state: OrchestratorState | null;
  intake: EventIngestionResult | null;
  statusReport: StatusReportSummary | null;
  summary: string;
  inboundAuditId: string | null;
};

function normalizeHeaders(headers: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function createBlockedReason(params: {
  code: string;
  summary: string;
  missingPrerequisites?: string[];
  recoverable?: boolean;
  suggestedNextAction: string;
}) {
  return blockedReasonSchema.parse({
    code: params.code,
    summary: params.summary,
    missingPrerequisites: params.missingPrerequisites ?? [],
    recoverable: params.recoverable ?? true,
    suggestedNextAction: params.suggestedNextAction,
  });
}

function extractActorIdentity(payload: unknown): ActorIdentity | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const sender = (payload as { sender?: { login?: unknown; id?: unknown; type?: unknown } }).sender;
  if (!sender || typeof sender.login !== "string") {
    return null;
  }
  return {
    login: sender.login,
    id: typeof sender.id === "number" ? sender.id : null,
    type: typeof sender.type === "string" ? sender.type : null,
  };
}

export function parseGitHubWebhookHeaders(headers: Record<string, string | undefined>): ParsedGitHubWebhook {
  const normalized = normalizeHeaders(headers);
  const event = normalized["x-github-event"] ?? normalized["github-event"] ?? "none";
  const webhookEventType =
    event === "issues" || event === "issue_comment" || event === "pull_request" || event === "pull_request_review_comment"
      ? event
      : event === "workflow_dispatch"
        ? "workflow_dispatch"
        : "none";
  return {
    eventType: webhookEventType,
    deliveryId: normalized["x-github-delivery"] ?? null,
    signature: normalized["x-hub-signature-256"] ?? null,
  };
}

export function verifyGitHubWebhookSignature(params: {
  rawBody: string;
  signature: string | null;
  secret: string | null;
}): { status: WebhookSignatureStatus; blockedReason: BlockedReason | null } {
  if (!params.secret) {
    return {
      status: "missing_secret",
      blockedReason: createBlockedReason({
        code: "missing_webhook_secret",
        summary: "GitHub webhook secret is missing; webhook ingestion is blocked.",
        missingPrerequisites: ["GITHUB_WEBHOOK_SECRET"],
        suggestedNextAction: "Set GITHUB_WEBHOOK_SECRET before accepting webhook traffic.",
      }),
    };
  }
  if (!params.signature) {
    return {
      status: "missing_signature",
      blockedReason: createBlockedReason({
        code: "missing_webhook_signature",
        summary: "GitHub webhook signature header is missing.",
        missingPrerequisites: ["x-hub-signature-256"],
        suggestedNextAction: "Retry the request with the GitHub signature header.",
      }),
    };
  }
  const expected = `sha256=${createHmac("sha256", params.secret).update(params.rawBody).digest("hex")}`;
  const signatureBuffer = Buffer.from(params.signature);
  const expectedBuffer = Buffer.from(expected);
  const verified =
    signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!verified) {
    return {
      status: "invalid_signature",
      blockedReason: createBlockedReason({
        code: "invalid_webhook_signature",
        summary: "GitHub webhook signature verification failed.",
        recoverable: false,
        suggestedNextAction: "Retry with the correct shared secret or reject the delivery.",
      }),
    };
  }
  return {
    status: "verified",
    blockedReason: null,
  };
}

async function updateStateForInbound(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  auditId: string;
  deliveryId: string | null;
  correlationId: string;
  actorIdentity: ActorIdentity | null;
  signatureStatus: WebhookSignatureStatus;
  actorAuthorizationStatus: OrchestratorState["actorAuthorizationStatus"];
  replayProtectionStatus: OrchestratorState["replayProtectionStatus"];
  parsedCommand: OrchestratorState["parsedCommand"];
  commandRoutingDecision: CommandRoutingDecision | null;
  commandRoutingStatus: OrchestratorState["commandRoutingStatus"];
  actorPolicyConfigVersion?: string | null;
  runtimeHealthStatus?: OrchestratorState["runtimeHealthStatus"];
  runtimeReadinessStatus?: OrchestratorState["runtimeReadinessStatus"];
}) {
  const updated = orchestratorStateSchema.parse({
    ...params.state,
    webhookDeliveryId: params.deliveryId,
    webhookSignatureStatus: params.signatureStatus,
    inboundEventId: params.auditId,
    inboundDeliveryId: params.deliveryId,
    inboundCorrelationId: params.correlationId,
    actorIdentity: params.actorIdentity,
    actorAuthorizationStatus: params.actorAuthorizationStatus,
    actorPolicyConfigVersion: params.actorPolicyConfigVersion ?? params.state.actorPolicyConfigVersion,
    replayProtectionStatus: params.replayProtectionStatus,
    inboundAuditStatus: "recorded",
    runtimeHealthStatus: params.runtimeHealthStatus ?? params.state.runtimeHealthStatus,
    runtimeReadinessStatus: params.runtimeReadinessStatus ?? params.state.runtimeReadinessStatus,
    parsedCommand: params.parsedCommand,
    commandRoutingDecision: params.commandRoutingDecision,
    commandRoutingStatus: params.commandRoutingStatus,
    updatedAt: new Date().toISOString(),
  });
  await params.dependencies.storage.saveState(updated);
  return updated;
}

async function saveAuditAndReturn(params: {
  dependencies: OrchestratorDependencies;
  auditId: string;
  receivedAt: string;
  deliveryId: string | null;
  eventType: WebhookEventType;
  sourceEventType: OrchestratorState["sourceEventType"];
  sourceEventId: string | null;
  repository: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  commentId: number | null;
  actorIdentity: ActorIdentity | null;
  signatureStatus: WebhookSignatureStatus;
  parsedCommand: OrchestratorState["parsedCommand"];
  actorAuthorizationStatus: OrchestratorState["actorAuthorizationStatus"];
  actorAuthorizationReason: string | null;
  replayProtectionStatus: OrchestratorState["replayProtectionStatus"];
  replayProtectionReason: string | null;
  commandRoutingDecision: CommandRoutingDecision | null;
  linkedStateId: string | null;
  linkedRunId: string | null;
  statusReportCorrelationId: string | null;
  payloadPath: string | null;
  headersPath: string | null;
  summary: string;
}) {
  const record = createInboundAuditRecord({
    id: params.auditId,
    receivedAt: params.receivedAt,
    deliveryId: params.deliveryId,
    eventType: params.eventType,
    sourceEventType: params.sourceEventType,
    sourceEventId: params.sourceEventId,
    repository: params.repository,
    issueNumber: params.issueNumber,
    prNumber: params.prNumber,
    commentId: params.commentId,
    actorIdentity: params.actorIdentity,
    signatureStatus: params.signatureStatus,
    parsedCommand: params.parsedCommand,
    actorAuthorizationStatus: params.actorAuthorizationStatus,
    actorAuthorizationReason: params.actorAuthorizationReason,
    replayProtectionStatus: params.replayProtectionStatus,
    replayProtectionReason: params.replayProtectionReason,
    commandRoutingDecision: params.commandRoutingDecision,
    linkedStateId: params.linkedStateId,
    linkedRunId: params.linkedRunId,
    statusReportCorrelationId: params.statusReportCorrelationId,
    payloadPath: params.payloadPath,
    headersPath: params.headersPath,
    summary: params.summary,
  });
  await saveInboundAuditRecord({
    storage: params.dependencies.storage,
    record,
  });
  return record;
}

export async function ingestGitHubWebhook(params: {
  rawBody: string;
  headers: Record<string, string | undefined>;
  secret: string | null;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  enqueue?: boolean;
  replayOverride?: boolean;
  reportStatus?: boolean;
  statusAdapter?: StatusReportingAdapter | null;
  externalTargetAdapter?: GptCodeExternalTargetAdapter | null;
  statusOutputRoot: string;
  auditOutputRoot?: string;
  actorPolicyConfigPath?: string | null;
  actualGitStatusShort?: string | null;
}) : Promise<WebhookIngestionResult> {
  const receivedAt = new Date().toISOString();
  const parsedHeaders = parseGitHubWebhookHeaders(params.headers);
  const payload = JSON.parse(params.rawBody) as unknown;
  const actorIdentity = extractActorIdentity(payload);
  const signature = verifyGitHubWebhookSignature({
    rawBody: params.rawBody,
    signature: parsedHeaders.signature,
    secret: params.secret,
  });
  const normalizedEvent = (() => {
    try {
      return normalizeGitHubEvent(payload);
    } catch {
      return null;
    }
  })();
  const auditId = buildInboundAuditId({
    deliveryId: parsedHeaders.deliveryId,
    sourceEventId: normalizedEvent?.sourceEventId ?? null,
    receivedAt,
  });
  const defaultCorrelationId = buildInboundCorrelationId({
    deliveryId: parsedHeaders.deliveryId,
    sourceEventId: normalizedEvent?.sourceEventId ?? null,
    stateId: null,
  });
  const auditArtifacts = await persistInboundArtifacts({
    outputRoot: params.auditOutputRoot ?? path.join(params.repoPath, ".tmp", "orchestrator-inbound"),
    auditId,
    rawBody: params.rawBody,
    headers: params.headers,
  });
  let actorPolicyConfig: LoadedActorPolicyConfig;
  try {
    actorPolicyConfig = await loadActorPolicyConfig({
      configPath: params.actorPolicyConfigPath ?? null,
    });
  } catch (error) {
    const blockedReason = createBlockedReason({
      code: "actor_policy_config_unreadable",
      summary: error instanceof Error ? error.message : "Actor policy config could not be loaded.",
      missingPrerequisites: [params.actorPolicyConfigPath ?? "actor-policy-config"],
      suggestedNextAction: "Fix the actor policy config path or remove the invalid override before retrying webhook intake.",
    });
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: normalizedEvent?.eventType ?? "none",
      sourceEventId: normalizedEvent?.sourceEventId ?? null,
      repository: normalizedEvent?.repository ?? null,
      issueNumber: normalizedEvent?.issueNumber ?? null,
      prNumber: normalizedEvent?.prNumber ?? null,
      commentId: normalizedEvent?.commentId ?? null,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: normalizedEvent?.parsedCommand ?? null,
      actorAuthorizationStatus: "rejected",
      actorAuthorizationReason: blockedReason.summary,
      replayProtectionStatus: "rejected",
      replayProtectionReason: blockedReason.summary,
      commandRoutingDecision: null,
      linkedStateId: null,
      linkedRunId: null,
      statusReportCorrelationId: defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: blockedReason.summary,
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: blockedReason.summary,
      inboundAuditId: auditId,
    };
  }

  if (signature.status !== "verified") {
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: normalizedEvent?.eventType ?? "none",
      sourceEventId: normalizedEvent?.sourceEventId ?? null,
      repository: normalizedEvent?.repository ?? null,
      issueNumber: normalizedEvent?.issueNumber ?? null,
      prNumber: normalizedEvent?.prNumber ?? null,
      commentId: normalizedEvent?.commentId ?? null,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: normalizedEvent?.parsedCommand ?? null,
      actorAuthorizationStatus: "rejected",
      actorAuthorizationReason: signature.blockedReason?.summary ?? null,
      replayProtectionStatus: "rejected",
      replayProtectionReason: signature.blockedReason?.summary ?? null,
      commandRoutingDecision: null,
      linkedStateId: null,
      linkedRunId: null,
      statusReportCorrelationId: defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: signature.blockedReason?.summary ?? "Webhook was rejected.",
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason: signature.blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: signature.blockedReason?.summary ?? "Webhook was rejected.",
      inboundAuditId: auditId,
    };
  }

  const reportSource = extractGptCodeReportFromGitHubComment({
    payload,
    deliveryId: parsedHeaders.deliveryId,
    payloadPath: auditArtifacts.payloadPath,
    headersPath: auditArtifacts.headersPath,
    receivedAt,
  });
  if (reportSource) {
    const actorDecision = resolveActorAuthorization({
      actor: actorIdentity,
      command: null,
      executionMode: null,
      approvalRequired: false,
      liveRequested: false,
      config: actorPolicyConfig.config,
      configVersion: actorPolicyConfig.version,
    });
    const actorBlockedReason =
      actorDecision.status === "rejected" || actorDecision.status === "status_only"
        ? actorDecision.blockedReason
        : null;
    if (actorBlockedReason) {
      await saveAuditAndReturn({
        dependencies: params.dependencies,
        auditId,
        receivedAt,
        deliveryId: parsedHeaders.deliveryId,
        eventType: parsedHeaders.eventType,
        sourceEventType: "issue_comment_report",
        sourceEventId: reportSource.sourceId,
        repository: reportSource.repository,
        issueNumber: reportSource.issueNumber,
        prNumber: reportSource.prNumber,
        commentId: reportSource.commentId,
        actorIdentity,
        signatureStatus: signature.status,
        parsedCommand: null,
        actorAuthorizationStatus: actorDecision.status,
        actorAuthorizationReason: actorBlockedReason.summary,
        replayProtectionStatus: "rejected",
        replayProtectionReason: actorBlockedReason.summary,
        commandRoutingDecision: null,
        linkedStateId: null,
        linkedRunId: null,
        statusReportCorrelationId: reportSource.sourceCorrelationId,
        payloadPath: auditArtifacts.payloadPath,
        headersPath: auditArtifacts.headersPath,
        summary: actorBlockedReason.summary,
      });
      return {
        status: "rejected",
        signatureStatus: signature.status,
        blockedReason: actorBlockedReason,
        state: null,
        intake: null,
        statusReport: null,
        summary: actorBlockedReason.summary,
        inboundAuditId: auditId,
      };
    }

    const replay = await evaluateReplayProtection({
      storage: params.dependencies.storage,
      deliveryId: parsedHeaders.deliveryId,
      sourceEventId: reportSource.sourceId,
      replayOverride: params.replayOverride,
      signatureStatus: signature.status,
    });
    if (replay.status === "duplicate_delivery" || replay.status === "duplicate_event") {
      const duplicateRecord = replay.duplicateRecordId
        ? await params.dependencies.storage.loadInboundAudit(replay.duplicateRecordId)
        : null;
      const linkedState = duplicateRecord?.linkedStateId
        ? await params.dependencies.storage.loadState(duplicateRecord.linkedStateId)
        : null;
      await saveAuditAndReturn({
        dependencies: params.dependencies,
        auditId,
        receivedAt,
        deliveryId: parsedHeaders.deliveryId,
        eventType: parsedHeaders.eventType,
        sourceEventType: "issue_comment_report",
        sourceEventId: reportSource.sourceId,
        repository: reportSource.repository,
        issueNumber: reportSource.issueNumber,
        prNumber: reportSource.prNumber,
        commentId: reportSource.commentId,
        actorIdentity,
        signatureStatus: signature.status,
        parsedCommand: null,
        actorAuthorizationStatus: actorDecision.status,
        actorAuthorizationReason: actorDecision.summary,
        replayProtectionStatus: replay.status,
        replayProtectionReason: replay.summary,
        commandRoutingDecision: null,
        linkedStateId: linkedState?.id ?? duplicateRecord?.linkedStateId ?? null,
        linkedRunId: duplicateRecord?.linkedRunId ?? null,
        statusReportCorrelationId: reportSource.sourceCorrelationId,
        payloadPath: auditArtifacts.payloadPath,
        headersPath: auditArtifacts.headersPath,
        summary: replay.summary,
      });
      return {
        status: "duplicate",
        signatureStatus: signature.status,
        blockedReason: createBlockedReason({
          code: replay.status,
          summary: replay.summary,
          suggestedNextAction: "Inspect the existing linked task or use explicit replay override if a retry is required.",
        }),
        state: linkedState,
        intake: null,
        statusReport: null,
        summary: replay.summary,
        inboundAuditId: auditId,
      };
    }

    const externalAutomation = await runGptCodeExternalAutomationFromWebhook({
      payload,
      deliveryId: parsedHeaders.deliveryId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      receivedAt,
      dependencies: params.dependencies,
      externalTargetAdapter: params.externalTargetAdapter ?? null,
      actualGitStatusShort: params.actualGitStatusShort,
    });
    if (!externalAutomation) {
      const blockedReason = createBlockedReason({
        code: "external_report_not_routed",
        summary: "GPT CODE report webhook was detected but could not be routed into external automation.",
        suggestedNextAction: "Inspect the webhook payload and report parser before retrying the delivery.",
      });
      await saveAuditAndReturn({
        dependencies: params.dependencies,
        auditId,
        receivedAt,
        deliveryId: parsedHeaders.deliveryId,
        eventType: parsedHeaders.eventType,
        sourceEventType: "issue_comment_report",
        sourceEventId: reportSource.sourceId,
        repository: reportSource.repository,
        issueNumber: reportSource.issueNumber,
        prNumber: reportSource.prNumber,
        commentId: reportSource.commentId,
        actorIdentity,
        signatureStatus: signature.status,
        parsedCommand: null,
        actorAuthorizationStatus: actorDecision.status,
        actorAuthorizationReason: actorDecision.summary,
        replayProtectionStatus: replay.status,
        replayProtectionReason: replay.summary,
        commandRoutingDecision: null,
        linkedStateId: null,
        linkedRunId: null,
        statusReportCorrelationId: reportSource.sourceCorrelationId,
        payloadPath: auditArtifacts.payloadPath,
        headersPath: auditArtifacts.headersPath,
        summary: blockedReason.summary,
      });
      return {
        status: "rejected",
        signatureStatus: signature.status,
        blockedReason,
        state: null,
        intake: null,
        statusReport: null,
        summary: blockedReason.summary,
        inboundAuditId: auditId,
      };
    }
    const linkedState =
      externalAutomation.stateId !== "unlinked"
        ? await params.dependencies.storage.loadState(externalAutomation.stateId)
        : null;
    const summary =
      externalAutomation.outcome === "success"
        ? "External GPT CODE report was received, bridged, and dispatched automatically."
        : externalAutomation.outcome === "manual_required"
          ? "External GPT CODE report was received but requires manual review before completion."
          : "External GPT CODE report intake failed before completion.";

    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: "issue_comment_report",
      sourceEventId: reportSource.sourceId,
      repository: reportSource.repository,
      issueNumber: reportSource.issueNumber,
      prNumber: reportSource.prNumber,
      commentId: reportSource.commentId,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: null,
      actorAuthorizationStatus: actorDecision.status,
      actorAuthorizationReason: actorDecision.summary,
      replayProtectionStatus: replay.status,
      replayProtectionReason: replay.summary,
      commandRoutingDecision: null,
      linkedStateId: linkedState?.id ?? null,
      linkedRunId: null,
      statusReportCorrelationId: reportSource.sourceCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary,
    });

    if (!linkedState) {
      const blockedReason = createBlockedReason({
        code: "missing_thread_state_for_report",
        summary: "External GPT CODE report could not be linked to an existing thread state.",
        suggestedNextAction: "Link or create the thread state before retrying report intake.",
      });
      return {
        status: "rejected",
        signatureStatus: signature.status,
        blockedReason,
        state: null,
        intake: null,
        statusReport: null,
        summary: blockedReason.summary,
        inboundAuditId: auditId,
      };
    }

    return {
      status: "routed",
      signatureStatus: signature.status,
      blockedReason: null,
      state: linkedState,
      intake: null,
      statusReport: null,
      summary,
      inboundAuditId: auditId,
    };
  }

  if (!normalizedEvent) {
    const blockedReason = createBlockedReason({
      code: "unsupported_webhook_payload",
      summary: "Webhook payload is unsupported for orchestrator intake.",
      suggestedNextAction: "Send a supported issues, issue_comment, pull_request, or workflow_dispatch payload.",
    });
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: "none",
      sourceEventId: null,
      repository: null,
      issueNumber: null,
      prNumber: null,
      commentId: null,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: null,
      actorAuthorizationStatus: "rejected",
      actorAuthorizationReason: blockedReason.summary,
      replayProtectionStatus: "rejected",
      replayProtectionReason: blockedReason.summary,
      commandRoutingDecision: null,
      linkedStateId: null,
      linkedRunId: null,
      statusReportCorrelationId: defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: blockedReason.summary,
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: blockedReason.summary,
      inboundAuditId: auditId,
    };
  }

  const policy = resolveTriggerPolicy({
    type: normalizedEvent.eventType,
    repository: normalizedEvent.repository,
    repoName: normalizedEvent.repoName,
    labels: normalizedEvent.labels,
  });
  if (!policy) {
    const blockedReason = createBlockedReason({
      code: "missing_trigger_policy",
      summary: `No trigger policy matched ${normalizedEvent.eventType} for ${normalizedEvent.repository}.`,
      suggestedNextAction: "Add a trigger policy rule for this event or use a supported event/label combination.",
    });
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: normalizedEvent.eventType,
      sourceEventId: normalizedEvent.sourceEventId,
      repository: normalizedEvent.repository,
      issueNumber: normalizedEvent.issueNumber,
      prNumber: normalizedEvent.prNumber,
      commentId: normalizedEvent.commentId,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: normalizedEvent.parsedCommand,
      actorAuthorizationStatus: "rejected",
      actorAuthorizationReason: blockedReason.summary,
      replayProtectionStatus: "rejected",
      replayProtectionReason: blockedReason.summary,
      commandRoutingDecision: null,
      linkedStateId: null,
      linkedRunId: null,
      statusReportCorrelationId: defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: blockedReason.summary,
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: blockedReason.summary,
      inboundAuditId: auditId,
    };
  }

  const actorDecision = resolveActorAuthorization({
    actor: actorIdentity,
    command: normalizedEvent.parsedCommand?.kind ?? null,
    executionMode: normalizedEvent.parsedCommand?.executionMode ?? policy.executionMode,
    approvalRequired: policy.approvalMode === "human_approval",
    liveRequested: policy.handoffConfig.githubHandoffEnabled,
    config: actorPolicyConfig.config,
    configVersion: actorPolicyConfig.version,
  });
  const actorBlockedReason =
    actorDecision.status === "rejected" ||
    (normalizedEvent.parsedCommand?.kind !== "status" && actorDecision.status === "status_only")
      ? actorDecision.blockedReason
      : null;
  if (actorBlockedReason) {
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: normalizedEvent.eventType,
      sourceEventId: normalizedEvent.sourceEventId,
      repository: normalizedEvent.repository,
      issueNumber: normalizedEvent.issueNumber,
      prNumber: normalizedEvent.prNumber,
      commentId: normalizedEvent.commentId,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: normalizedEvent.parsedCommand,
      actorAuthorizationStatus: actorDecision.status,
      actorAuthorizationReason: actorBlockedReason.summary,
      replayProtectionStatus: "rejected",
      replayProtectionReason: actorBlockedReason.summary,
      commandRoutingDecision: null,
      linkedStateId: null,
      linkedRunId: null,
      statusReportCorrelationId: defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: actorBlockedReason.summary,
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason: actorBlockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: actorBlockedReason.summary,
      inboundAuditId: auditId,
    };
  }

  const replay = await evaluateReplayProtection({
    storage: params.dependencies.storage,
    deliveryId: parsedHeaders.deliveryId,
    sourceEventId: normalizedEvent.sourceEventId,
    replayOverride: params.replayOverride,
    signatureStatus: signature.status,
  });
  if (replay.status === "duplicate_delivery" || replay.status === "duplicate_event") {
    const duplicateRecord = replay.duplicateRecordId
      ? await params.dependencies.storage.loadInboundAudit(replay.duplicateRecordId)
      : null;
    const linkedState = duplicateRecord?.linkedStateId
      ? await params.dependencies.storage.loadState(duplicateRecord.linkedStateId)
      : null;
    await saveAuditAndReturn({
      dependencies: params.dependencies,
      auditId,
      receivedAt,
      deliveryId: parsedHeaders.deliveryId,
      eventType: parsedHeaders.eventType,
      sourceEventType: normalizedEvent.eventType,
      sourceEventId: normalizedEvent.sourceEventId,
      repository: normalizedEvent.repository,
      issueNumber: normalizedEvent.issueNumber,
      prNumber: normalizedEvent.prNumber,
      commentId: normalizedEvent.commentId,
      actorIdentity,
      signatureStatus: signature.status,
      parsedCommand: normalizedEvent.parsedCommand,
      actorAuthorizationStatus: actorDecision.status,
      actorAuthorizationReason: actorDecision.summary,
      replayProtectionStatus: replay.status,
      replayProtectionReason: replay.summary,
      commandRoutingDecision: null,
      linkedStateId: linkedState?.id ?? duplicateRecord?.linkedStateId ?? null,
      linkedRunId: duplicateRecord?.linkedRunId ?? null,
      statusReportCorrelationId: duplicateRecord?.statusReportCorrelationId ?? defaultCorrelationId,
      payloadPath: auditArtifacts.payloadPath,
      headersPath: auditArtifacts.headersPath,
      summary: replay.summary,
    });
    return {
      status: "duplicate",
      signatureStatus: signature.status,
      blockedReason: createBlockedReason({
        code: replay.status,
        summary: replay.summary,
        suggestedNextAction: "Inspect the existing linked task or use explicit replay override if a retry is required.",
      }),
      state: linkedState,
      intake: null,
      statusReport: null,
      summary: replay.summary,
      inboundAuditId: auditId,
    };
  }

  const existingThreadState = await findLatestStateForThread({
    dependencies: params.dependencies,
    repository: normalizedEvent.repository,
    issueNumber: normalizedEvent.issueNumber,
    prNumber: normalizedEvent.prNumber,
  });

  if (normalizedEvent.parsedCommand) {
    const routing = routeParsedCommand({
      command: normalizedEvent.parsedCommand,
      policy,
      existingStateId: existingThreadState?.id ?? null,
    });

    if (routing.status === "rejected") {
      const targetState = existingThreadState
        ? await updateStateForInbound({
            state: existingThreadState,
            dependencies: params.dependencies,
            auditId,
            deliveryId: parsedHeaders.deliveryId,
            correlationId: buildInboundCorrelationId({
              deliveryId: parsedHeaders.deliveryId,
              sourceEventId: normalizedEvent.sourceEventId,
              stateId: existingThreadState.id,
            }),
            actorIdentity,
            signatureStatus: signature.status,
            actorAuthorizationStatus: actorDecision.status,
            actorPolicyConfigVersion: actorPolicyConfig.version,
            replayProtectionStatus: replay.status,
            runtimeHealthStatus: params.secret ? "ready" : "blocked",
            runtimeReadinessStatus: params.secret ? "ready" : "blocked",
            parsedCommand: normalizedEvent.parsedCommand,
            commandRoutingDecision: routing,
            commandRoutingStatus: routing.status,
          })
        : null;
      const blockedReason = createBlockedReason({
        code: routing.reasonCode ?? "command_rejected",
        summary: routing.summary,
        suggestedNextAction: routing.suggestedNextAction ?? "Review the command routing decision.",
      });
      await saveAuditAndReturn({
        dependencies: params.dependencies,
        auditId,
        receivedAt,
        deliveryId: parsedHeaders.deliveryId,
        eventType: parsedHeaders.eventType,
        sourceEventType: normalizedEvent.eventType,
        sourceEventId: normalizedEvent.sourceEventId,
        repository: normalizedEvent.repository,
        issueNumber: normalizedEvent.issueNumber,
        prNumber: normalizedEvent.prNumber,
        commentId: normalizedEvent.commentId,
        actorIdentity,
        signatureStatus: signature.status,
        parsedCommand: normalizedEvent.parsedCommand,
        actorAuthorizationStatus: actorDecision.status,
        actorAuthorizationReason: actorDecision.summary,
        replayProtectionStatus: replay.status,
        replayProtectionReason: replay.summary,
        commandRoutingDecision: routing,
        linkedStateId: targetState?.id ?? null,
        linkedRunId: null,
        statusReportCorrelationId: targetState?.statusReportCorrelationId ?? defaultCorrelationId,
        payloadPath: auditArtifacts.payloadPath,
        headersPath: auditArtifacts.headersPath,
        summary: routing.summary,
      });
      return {
        status: "rejected",
        signatureStatus: signature.status,
        blockedReason,
        state: targetState,
        intake: null,
        statusReport: null,
        summary: routing.summary,
        inboundAuditId: auditId,
      };
    }

    if (existingThreadState && routing.action !== "create_task") {
      let updatedState = await updateStateForInbound({
        state: existingThreadState,
        dependencies: params.dependencies,
        auditId,
        deliveryId: parsedHeaders.deliveryId,
        correlationId: buildInboundCorrelationId({
          deliveryId: parsedHeaders.deliveryId,
          sourceEventId: normalizedEvent.sourceEventId,
          stateId: existingThreadState.id,
        }),
        actorIdentity,
        signatureStatus: signature.status,
        actorAuthorizationStatus: actorDecision.status,
        replayProtectionStatus: replay.status,
        parsedCommand: normalizedEvent.parsedCommand,
        commandRoutingDecision: routing,
        commandRoutingStatus: routing.status,
      });

      let linkedRunId: string | null = null;
      if (routing.action === "enqueue_existing" || routing.action === "retry") {
        const queueResult = await enqueueStateRun({
          backend: params.dependencies.backend,
          state: updatedState,
          requestedBy: normalizedEvent.triggerReason,
          scheduledAt: new Date().toISOString(),
        });
        linkedRunId = queueResult.item.id;
        updatedState = orchestratorStateSchema.parse(applyQueueItemToState(updatedState, queueResult.item, new Date()));
        updatedState = await updateStateForInbound({
          state: updatedState,
          dependencies: params.dependencies,
          auditId,
          deliveryId: parsedHeaders.deliveryId,
          correlationId: buildInboundCorrelationId({
            deliveryId: parsedHeaders.deliveryId,
            sourceEventId: normalizedEvent.sourceEventId,
            stateId: updatedState.id,
          }),
          actorIdentity,
          signatureStatus: signature.status,
          actorAuthorizationStatus: actorDecision.status,
          actorPolicyConfigVersion: actorPolicyConfig.version,
          replayProtectionStatus: replay.status,
          runtimeHealthStatus: params.secret ? "ready" : "blocked",
          runtimeReadinessStatus: params.secret ? "ready" : "blocked",
          parsedCommand: normalizedEvent.parsedCommand,
          commandRoutingDecision: routing,
          commandRoutingStatus: routing.status,
        });
      } else if (routing.action === "approve") {
        updatedState =
          updatedState.approvalStatus === "pending_patch" || updatedState.patchStatus === "waiting_approval"
            ? await approvePendingPatch(updatedState.id, params.dependencies)
            : await approvePendingPlan(updatedState.id, params.dependencies);
      } else if (routing.action === "reject") {
        updatedState =
          updatedState.approvalStatus === "pending_patch" || updatedState.patchStatus === "waiting_approval"
            ? await rejectPendingPatch(updatedState.id, params.dependencies, normalizedEvent.parsedCommand.rawCommand)
            : await rejectPendingPlan(updatedState.id, params.dependencies, normalizedEvent.parsedCommand.rawCommand);
      }

      let statusReport: StatusReportSummary | null = null;
      if (params.reportStatus) {
        statusReport = await reportStateStatus({
          state: updatedState,
          outputRoot: params.statusOutputRoot,
          adapter: params.statusAdapter,
        });
        updatedState = applyStatusReportToState(updatedState, statusReport);
        updatedState = await updateStateForInbound({
          state: updatedState,
          dependencies: params.dependencies,
          auditId,
          deliveryId: parsedHeaders.deliveryId,
          correlationId: statusReport.correlationId ?? buildInboundCorrelationId({
            deliveryId: parsedHeaders.deliveryId,
            sourceEventId: normalizedEvent.sourceEventId,
            stateId: updatedState.id,
          }),
          actorIdentity,
          signatureStatus: signature.status,
          actorAuthorizationStatus: actorDecision.status,
          actorPolicyConfigVersion: actorPolicyConfig.version,
          replayProtectionStatus: replay.status,
          runtimeHealthStatus: params.secret ? "ready" : "blocked",
          runtimeReadinessStatus: params.secret ? "ready" : "blocked",
          parsedCommand: normalizedEvent.parsedCommand,
          commandRoutingDecision: routing,
          commandRoutingStatus: routing.status,
        });
      }

      await saveAuditAndReturn({
        dependencies: params.dependencies,
        auditId,
        receivedAt,
        deliveryId: parsedHeaders.deliveryId,
        eventType: parsedHeaders.eventType,
        sourceEventType: normalizedEvent.eventType,
        sourceEventId: normalizedEvent.sourceEventId,
        repository: normalizedEvent.repository,
        issueNumber: normalizedEvent.issueNumber,
        prNumber: normalizedEvent.prNumber,
        commentId: normalizedEvent.commentId,
        actorIdentity,
        signatureStatus: signature.status,
        parsedCommand: normalizedEvent.parsedCommand,
        actorAuthorizationStatus: actorDecision.status,
        actorAuthorizationReason: actorDecision.summary,
        replayProtectionStatus: replay.status,
        replayProtectionReason: replay.summary,
        commandRoutingDecision: routing,
        linkedStateId: updatedState.id,
        linkedRunId,
        statusReportCorrelationId: updatedState.statusReportCorrelationId,
        payloadPath: auditArtifacts.payloadPath,
        headersPath: auditArtifacts.headersPath,
        summary: routing.summary,
      });

      return {
        status: "routed",
        signatureStatus: signature.status,
        blockedReason: null,
        state: updatedState,
        intake: null,
        statusReport,
        summary: routing.summary,
        inboundAuditId: auditId,
      };
    }
  }

  const intake = await ingestGitHubEvent({
    payload,
    dependencies: params.dependencies,
    repoPath: params.repoPath,
    replayOverride: params.replayOverride,
    enqueue: params.enqueue,
    webhookEventType: parsedHeaders.eventType,
    webhookDeliveryId: parsedHeaders.deliveryId,
    webhookSignatureStatus: signature.status,
  });

  let updatedState = await updateStateForInbound({
    state: orchestratorStateSchema.parse({
      ...intake.state,
      webhookEventType: parsedHeaders.eventType,
    }),
    dependencies: params.dependencies,
    auditId,
    deliveryId: parsedHeaders.deliveryId,
    correlationId: buildInboundCorrelationId({
      deliveryId: parsedHeaders.deliveryId,
      sourceEventId: normalizedEvent.sourceEventId,
      stateId: intake.state.id,
    }),
    actorIdentity,
    signatureStatus: signature.status,
    actorAuthorizationStatus: actorDecision.status,
    actorPolicyConfigVersion: actorPolicyConfig.version,
    replayProtectionStatus: replay.status,
    runtimeHealthStatus: params.secret ? "ready" : "blocked",
    runtimeReadinessStatus: params.secret ? "ready" : "blocked",
    parsedCommand: normalizedEvent.parsedCommand,
    commandRoutingDecision: normalizedEvent.parsedCommand
      ? {
          status: "accepted",
          action: intake.created ? "create_task" : "enqueue_existing",
          reasonCode: null,
          summary: intake.created ? "Webhook command created a task." : "Webhook command linked to an existing task.",
          suggestedNextAction: intake.created ? "Process the queued task." : "Inspect or process the linked task.",
          targetStateId: intake.state.id,
        }
      : null,
    commandRoutingStatus: normalizedEvent.parsedCommand ? "accepted" : "not_applicable",
  });

  let statusReport: StatusReportSummary | null = null;
  if (params.reportStatus) {
    statusReport = await reportStateStatus({
      state: updatedState,
      outputRoot: params.statusOutputRoot,
      adapter: params.statusAdapter,
    });
    updatedState = applyStatusReportToState(updatedState, statusReport);
    updatedState = await updateStateForInbound({
      state: updatedState,
      dependencies: params.dependencies,
      auditId,
      deliveryId: parsedHeaders.deliveryId,
      correlationId: statusReport.correlationId ?? buildInboundCorrelationId({
        deliveryId: parsedHeaders.deliveryId,
        sourceEventId: normalizedEvent.sourceEventId,
        stateId: updatedState.id,
      }),
      actorIdentity,
      signatureStatus: signature.status,
      actorAuthorizationStatus: actorDecision.status,
      actorPolicyConfigVersion: actorPolicyConfig.version,
      replayProtectionStatus: replay.status,
      runtimeHealthStatus: params.secret ? "ready" : "blocked",
      runtimeReadinessStatus: params.secret ? "ready" : "blocked",
      parsedCommand: normalizedEvent.parsedCommand,
      commandRoutingDecision: updatedState.commandRoutingDecision,
      commandRoutingStatus: updatedState.commandRoutingStatus,
    });
  }

  await saveAuditAndReturn({
    dependencies: params.dependencies,
    auditId,
    receivedAt,
    deliveryId: parsedHeaders.deliveryId,
    eventType: parsedHeaders.eventType,
    sourceEventType: normalizedEvent.eventType,
    sourceEventId: normalizedEvent.sourceEventId,
    repository: normalizedEvent.repository,
    issueNumber: normalizedEvent.issueNumber,
    prNumber: normalizedEvent.prNumber,
    commentId: normalizedEvent.commentId,
    actorIdentity,
    signatureStatus: signature.status,
    parsedCommand: normalizedEvent.parsedCommand,
    actorAuthorizationStatus: actorDecision.status,
    actorAuthorizationReason: actorDecision.summary,
    replayProtectionStatus: replay.status,
    replayProtectionReason: replay.summary,
    commandRoutingDecision: updatedState.commandRoutingDecision,
    linkedStateId: updatedState.id,
    linkedRunId: null,
    statusReportCorrelationId: updatedState.statusReportCorrelationId,
    payloadPath: auditArtifacts.payloadPath,
    headersPath: auditArtifacts.headersPath,
    summary: `Webhook ${parsedHeaders.eventType} was accepted and processed.`,
  });

  return {
    status: intake.status,
    signatureStatus: signature.status,
    blockedReason: null,
    state: updatedState,
    intake,
    statusReport,
    summary: `Webhook ${parsedHeaders.eventType} was accepted and processed.`,
    inboundAuditId: auditId,
  };
}
