import { createHmac, timingSafeEqual } from "node:crypto";
import {
  approvePendingPatch,
  approvePendingPlan,
  rejectPendingPatch,
  rejectPendingPlan,
  type OrchestratorDependencies,
} from "../orchestrator";
import { routeParsedCommand } from "../commands";
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
  type BlockedReason,
  type OrchestratorState,
  type StatusReportSummary,
  type WebhookEventType,
  type WebhookSignatureStatus,
} from "../schemas";

export type ParsedGitHubWebhook = {
  eventType: WebhookEventType;
  deliveryId: string | null;
  signature: string | null;
};

export type WebhookIngestionResult = {
  status: "created" | "linked_existing" | "replayed" | "routed" | "rejected";
  signatureStatus: WebhookSignatureStatus;
  blockedReason: BlockedReason | null;
  state: OrchestratorState | null;
  intake: EventIngestionResult | null;
  statusReport: StatusReportSummary | null;
  summary: string;
};

function normalizeHeaders(headers: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
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
      blockedReason: blockedReasonSchema.parse({
        code: "missing_webhook_secret",
        summary: "GitHub webhook secret is missing; webhook ingestion is blocked.",
        missingPrerequisites: ["GITHUB_WEBHOOK_SECRET"],
        recoverable: true,
        suggestedNextAction: "Set GITHUB_WEBHOOK_SECRET before accepting webhook traffic.",
      }),
    };
  }
  if (!params.signature) {
    return {
      status: "missing_signature",
      blockedReason: blockedReasonSchema.parse({
        code: "missing_webhook_signature",
        summary: "GitHub webhook signature header is missing.",
        missingPrerequisites: ["x-hub-signature-256"],
        recoverable: true,
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
      blockedReason: blockedReasonSchema.parse({
        code: "invalid_webhook_signature",
        summary: "GitHub webhook signature verification failed.",
        missingPrerequisites: [],
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

async function updateStateForCommand(params: {
  state: OrchestratorState;
  dependencies: OrchestratorDependencies;
  decision: ReturnType<typeof routeParsedCommand>;
}) {
  const now = new Date().toISOString();
  const stateWithDecision = orchestratorStateSchema.parse({
    ...params.state,
    commandRoutingStatus: params.decision.status,
    commandRoutingDecision: params.decision,
    updatedAt: now,
  });
  await params.dependencies.storage.saveState(stateWithDecision);
  return stateWithDecision;
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
  statusOutputRoot: string;
}) : Promise<WebhookIngestionResult> {
  const parsedHeaders = parseGitHubWebhookHeaders(params.headers);
  const signature = verifyGitHubWebhookSignature({
    rawBody: params.rawBody,
    signature: parsedHeaders.signature,
    secret: params.secret,
  });
  if (signature.status !== "verified") {
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason: signature.blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: signature.blockedReason?.summary ?? "Webhook was rejected.",
    };
  }

  const payload = JSON.parse(params.rawBody) as unknown;
  const event = normalizeGitHubEvent(payload);
  const policy = resolveTriggerPolicy({
    type: event.eventType,
    repository: event.repository,
    repoName: event.repoName,
    labels: event.labels,
  });
  if (!policy) {
    const blockedReason = blockedReasonSchema.parse({
      code: "missing_trigger_policy",
      summary: `No trigger policy matched ${event.eventType} for ${event.repository}.`,
      missingPrerequisites: [],
      recoverable: true,
      suggestedNextAction: "Add a trigger policy rule for this event or use a supported event/label combination.",
    });
    return {
      status: "rejected",
      signatureStatus: signature.status,
      blockedReason,
      state: null,
      intake: null,
      statusReport: null,
      summary: blockedReason.summary,
    };
  }
  const existingThreadState = await findLatestStateForThread({
    dependencies: params.dependencies,
    repository: event.repository,
    issueNumber: event.issueNumber,
    prNumber: event.prNumber,
  });

  if (event.parsedCommand) {
    const routing = routeParsedCommand({
      command: event.parsedCommand,
      policy,
      existingStateId: existingThreadState?.id ?? null,
    });

    if (routing.status === "rejected") {
      if (existingThreadState) {
        const updated = await updateStateForCommand({
          state: orchestratorStateSchema.parse({
            ...existingThreadState,
            webhookEventType: parsedHeaders.eventType,
            webhookDeliveryId: parsedHeaders.deliveryId,
            webhookSignatureStatus: signature.status,
            parsedCommand: event.parsedCommand,
          }),
          dependencies: params.dependencies,
          decision: routing,
        });
        return {
          status: "rejected",
          signatureStatus: signature.status,
          blockedReason: blockedReasonSchema.parse({
            code: routing.reasonCode ?? "command_rejected",
            summary: routing.summary,
            missingPrerequisites: [],
            recoverable: true,
            suggestedNextAction: routing.suggestedNextAction ?? "Review the command routing decision.",
          }),
          state: updated,
          intake: null,
          statusReport: null,
          summary: routing.summary,
        };
      }
      return {
        status: "rejected",
        signatureStatus: signature.status,
        blockedReason: blockedReasonSchema.parse({
          code: routing.reasonCode ?? "command_rejected",
          summary: routing.summary,
          missingPrerequisites: [],
          recoverable: true,
          suggestedNextAction: routing.suggestedNextAction ?? "Review the command routing decision.",
        }),
        state: null,
        intake: null,
        statusReport: null,
        summary: routing.summary,
      };
    }

    if (existingThreadState && routing.action !== "create_task") {
      let updatedState = orchestratorStateSchema.parse({
        ...existingThreadState,
        webhookEventType: parsedHeaders.eventType,
        webhookDeliveryId: parsedHeaders.deliveryId,
        webhookSignatureStatus: signature.status,
        parsedCommand: event.parsedCommand,
      });

      if (routing.action === "enqueue_existing" || routing.action === "retry") {
        const queueResult = await enqueueStateRun({
          backend: params.dependencies.backend,
          state: updatedState,
          requestedBy: event.triggerReason,
          scheduledAt: new Date().toISOString(),
        });
        updatedState = orchestratorStateSchema.parse(
          applyQueueItemToState(updatedState, queueResult.item, new Date()),
        );
        updatedState = await updateStateForCommand({
          state: updatedState,
          dependencies: params.dependencies,
          decision: routing,
        });
      } else if (routing.action === "approve") {
        updatedState =
          updatedState.approvalStatus === "pending_patch" || updatedState.patchStatus === "waiting_approval"
            ? await approvePendingPatch(updatedState.id, params.dependencies)
            : await approvePendingPlan(updatedState.id, params.dependencies);
        updatedState = await updateStateForCommand({
          state: updatedState,
          dependencies: params.dependencies,
          decision: routing,
        });
      } else if (routing.action === "reject") {
        updatedState =
          updatedState.approvalStatus === "pending_patch" || updatedState.patchStatus === "waiting_approval"
            ? await rejectPendingPatch(updatedState.id, params.dependencies, event.parsedCommand.rawCommand)
            : await rejectPendingPlan(updatedState.id, params.dependencies, event.parsedCommand.rawCommand);
        updatedState = await updateStateForCommand({
          state: updatedState,
          dependencies: params.dependencies,
          decision: routing,
        });
      } else {
        updatedState = await updateStateForCommand({
          state: updatedState,
          dependencies: params.dependencies,
          decision: routing,
        });
      }

      let statusReport: StatusReportSummary | null = null;
      if (params.reportStatus) {
        statusReport = await reportStateStatus({
          state: updatedState,
          outputRoot: params.statusOutputRoot,
          adapter: params.statusAdapter,
        });
        updatedState = applyStatusReportToState(updatedState, statusReport);
        await params.dependencies.storage.saveState(updatedState);
      }

      return {
        status: "routed",
        signatureStatus: signature.status,
        blockedReason: null,
        state: updatedState,
        intake: null,
        statusReport,
        summary: routing.summary,
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

  let updatedState = orchestratorStateSchema.parse({
    ...intake.state,
    webhookEventType: parsedHeaders.eventType,
    webhookDeliveryId: parsedHeaders.deliveryId,
    webhookSignatureStatus: signature.status,
    parsedCommand: event.parsedCommand,
    commandRoutingStatus: event.parsedCommand ? "accepted" : "not_applicable",
    commandRoutingDecision: event.parsedCommand
      ? {
          status: "accepted",
          action: intake.created ? "create_task" : "enqueue_existing",
          reasonCode: null,
          summary: intake.created ? "Webhook command created a task." : "Webhook command linked to an existing task.",
          suggestedNextAction: intake.created ? "Process the queued task." : "Inspect or process the linked task.",
          targetStateId: intake.state.id,
        }
      : null,
  });
  await params.dependencies.storage.saveState(updatedState);

  let statusReport: StatusReportSummary | null = null;
  if (params.reportStatus) {
    statusReport = await reportStateStatus({
      state: updatedState,
      outputRoot: params.statusOutputRoot,
      adapter: params.statusAdapter,
    });
    updatedState = applyStatusReportToState(updatedState, statusReport);
    await params.dependencies.storage.saveState(updatedState);
  }

  return {
    status: intake.status,
    signatureStatus: signature.status,
    blockedReason: null,
    state: updatedState,
    intake,
    statusReport,
    summary: `Webhook ${parsedHeaders.eventType} was accepted and processed.`,
  };
}
