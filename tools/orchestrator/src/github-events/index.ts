import path from "node:path";
import { parseOrchestratorCommand } from "../commands";
import {
  orchestratorStateSchema,
  sourceEventSummarySchema,
  sourceEventTypeSchema,
  type OrchestratorState,
  type ParsedCommand,
  type SourceEventSummary,
  type SourceEventType,
  type WebhookEventType,
  type WebhookSignatureStatus,
} from "../schemas";
import { createInitialState, type OrchestratorDependencies } from "../orchestrator";
import { enqueueStateRun } from "../queue";
import { resolveTriggerPolicy } from "../trigger-policy";

type IssuePayload = {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    labels?: Array<{ name?: string }>;
    pull_request?: unknown;
  };
  repository?: {
    full_name: string;
    name: string;
    default_branch?: string;
  };
  label?: {
    name?: string;
  };
};

type PullRequestPayload = {
  action: string;
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    head?: {
      ref?: string;
      sha?: string;
    };
    labels?: Array<{ name?: string }>;
  };
  repository?: {
    full_name: string;
    name: string;
    default_branch?: string;
  };
  label?: {
    name?: string;
  };
};

type IssueCommentPayload = {
  action: string;
  issue?: {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    pull_request?: unknown;
    labels?: Array<{ name?: string }>;
  };
  comment?: {
    id: number;
    body?: string | null;
  };
  repository?: {
    full_name: string;
    name: string;
    default_branch?: string;
  };
};

type WorkflowDispatchPayload = {
  event_type?: string;
  repository?: {
    full_name: string;
    name: string;
    default_branch?: string;
  };
  ref?: string;
  inputs?: Record<string, string | undefined>;
};

export type NormalizedGitHubEvent = {
  eventType: SourceEventType;
  sourceEventId: string;
  repository: string;
  repoName: string;
  branch: string | null;
  headSha: string | null;
  issueNumber: number | null;
  prNumber: number | null;
  commentId: number | null;
  labels: string[];
  command: string | null;
  parsedCommand: ParsedCommand | null;
  title: string;
  body: string;
  objective: string;
  triggerReason: string;
  sourceSummary: SourceEventSummary;
};

export type EventIngestionResult = {
  status: "created" | "linked_existing" | "replayed";
  state: OrchestratorState;
  created: boolean;
  duplicate: boolean;
  idempotencyKey: string;
  triggerPolicyId: string | null;
};

function labelsFrom(values?: Array<{ name?: string }>) {
  return (values ?? [])
    .map((value) => value.name?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeCommand(body: string | null | undefined) {
  return parseOrchestratorCommand(body)?.rawCommand ?? null;
}

function compactBody(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeIssueEvent(payload: IssuePayload): NormalizedGitHubEvent | null {
  if (!payload.issue || payload.issue.pull_request) {
    return null;
  }
  const eventType =
    payload.action === "opened"
      ? "issue_opened"
      : payload.action === "labeled"
        ? "issue_labeled"
        : null;
  if (!eventType) {
    return null;
  }
  const labels = Array.from(new Set([...labelsFrom(payload.issue.labels), payload.label?.name].filter(Boolean))) as string[];
  const repository = payload.repository?.full_name ?? "unknown/unknown";
  const repoName = payload.repository?.name ?? "unknown";
  const title = payload.issue.title.trim();
  const body = compactBody(payload.issue.body);
  const sourceEventId = `issue:${payload.issue.id}:${payload.action}`;
  const triggerReason = `${eventType} from ${repository}#${payload.issue.number}`;
  const sourceSummary = sourceEventSummarySchema.parse({
    repository,
    branch: payload.repository?.default_branch ?? null,
    issueNumber: payload.issue.number,
    prNumber: null,
    commentId: null,
    label: payload.label?.name ?? null,
    headSha: null,
    command: null,
    triggerReason,
  });
  return {
    eventType: sourceEventTypeSchema.parse(eventType),
    sourceEventId,
    repository,
    repoName,
    branch: payload.repository?.default_branch ?? null,
    headSha: null,
    issueNumber: payload.issue.number,
    prNumber: null,
    commentId: null,
    labels,
    command: null,
    parsedCommand: null,
    title,
    body,
    objective: title,
    triggerReason,
    sourceSummary,
  };
}

function normalizePullRequestEvent(payload: PullRequestPayload): NormalizedGitHubEvent | null {
  if (!payload.pull_request) {
    return null;
  }
  const eventType =
    payload.action === "opened"
      ? "pull_request_opened"
      : payload.action === "labeled"
        ? "pull_request_labeled"
        : payload.action === "synchronize"
          ? "pull_request_synchronize"
          : null;
  if (!eventType) {
    return null;
  }
  const labels = Array.from(new Set([...labelsFrom(payload.pull_request.labels), payload.label?.name].filter(Boolean))) as string[];
  const repository = payload.repository?.full_name ?? "unknown/unknown";
  const repoName = payload.repository?.name ?? "unknown";
  const title = payload.pull_request.title.trim();
  const body = compactBody(payload.pull_request.body);
  const branch = payload.pull_request.head?.ref ?? payload.repository?.default_branch ?? null;
  const headSha = payload.pull_request.head?.sha ?? null;
  const sourceEventId = `pr:${payload.pull_request.id}:${payload.action}:${headSha ?? "none"}`;
  const triggerReason = `${eventType} from ${repository}#${payload.pull_request.number}`;
  const sourceSummary = sourceEventSummarySchema.parse({
    repository,
    branch,
    issueNumber: null,
    prNumber: payload.pull_request.number,
    commentId: null,
    label: payload.label?.name ?? null,
    headSha,
    command: null,
    triggerReason,
  });
  return {
    eventType: sourceEventTypeSchema.parse(eventType),
    sourceEventId,
    repository,
    repoName,
    branch,
    headSha,
    issueNumber: null,
    prNumber: payload.pull_request.number,
    commentId: null,
    labels,
    command: null,
    parsedCommand: null,
    title,
    body,
    objective: title,
    triggerReason,
    sourceSummary,
  };
}

function normalizeIssueCommentEvent(payload: IssueCommentPayload): NormalizedGitHubEvent | null {
  if (!payload.issue || !payload.comment) {
    return null;
  }
  const command = normalizeCommand(payload.comment.body);
  if (payload.action !== "created" || !command) {
    return null;
  }
  const parsedCommand = parseOrchestratorCommand(payload.comment.body);
  const labels = labelsFrom(payload.issue.labels);
  const repository = payload.repository?.full_name ?? "unknown/unknown";
  const repoName = payload.repository?.name ?? "unknown";
  const title = payload.issue.title.trim();
  const body = compactBody(payload.comment.body);
  const triggerReason = `issue_comment_command from ${repository}#${payload.issue.number}`;
  const sourceSummary = sourceEventSummarySchema.parse({
    repository,
    branch: payload.repository?.default_branch ?? null,
    issueNumber: payload.issue.number,
    prNumber: payload.issue.pull_request ? payload.issue.number : null,
    commentId: payload.comment.id,
    label: null,
    headSha: null,
    command,
    triggerReason,
  });
  return {
    eventType: "issue_comment_command",
    sourceEventId: `comment:${payload.comment.id}`,
    repository,
    repoName,
    branch: payload.repository?.default_branch ?? null,
    headSha: null,
    issueNumber: payload.issue.number,
    prNumber: payload.issue.pull_request ? payload.issue.number : null,
    commentId: payload.comment.id,
    labels,
    command,
    parsedCommand,
    title,
    body,
    objective: title,
    triggerReason,
    sourceSummary,
  };
}

function normalizeWorkflowDispatchEvent(payload: WorkflowDispatchPayload): NormalizedGitHubEvent | null {
  if ((payload.event_type ?? "workflow_dispatch") !== "workflow_dispatch" && !payload.inputs) {
    return null;
  }
  const repository = payload.repository?.full_name ?? "unknown/unknown";
  const repoName = payload.repository?.name ?? "unknown";
  const branch = payload.ref?.replace(/^refs\/heads\//, "") ?? payload.repository?.default_branch ?? null;
  const title = payload.inputs?.title?.trim() || payload.inputs?.objective?.trim() || "Workflow dispatch orchestration";
  const body = payload.inputs?.body?.trim() || "";
  const triggerReason = payload.inputs?.trigger_reason?.trim() || "workflow_dispatch payload requested orchestrator work.";
  const sourceSummary = sourceEventSummarySchema.parse({
    repository,
    branch,
    issueNumber: payload.inputs?.issue_number ? Number.parseInt(payload.inputs.issue_number, 10) : null,
    prNumber: payload.inputs?.pr_number ? Number.parseInt(payload.inputs.pr_number, 10) : null,
    commentId: null,
    label: payload.inputs?.label?.trim() || null,
    headSha: payload.inputs?.head_sha?.trim() || null,
    command: null,
    triggerReason,
  });
  return {
    eventType: "workflow_dispatch",
    sourceEventId: payload.inputs?.event_id?.trim() || `workflow_dispatch:${branch ?? "unknown"}`,
    repository,
    repoName,
    branch,
    headSha: payload.inputs?.head_sha?.trim() || null,
    issueNumber: sourceSummary.issueNumber,
    prNumber: sourceSummary.prNumber,
    commentId: null,
    labels: payload.inputs?.labels ? payload.inputs.labels.split(",").map((value) => value.trim()).filter(Boolean) : [],
    command: null,
    parsedCommand: null,
    title,
    body,
    objective: title,
    triggerReason,
    sourceSummary,
  };
}

export function normalizeGitHubEvent(payload: unknown): NormalizedGitHubEvent {
  const issue = normalizeIssueEvent(payload as IssuePayload);
  if (issue) {
    return issue;
  }
  const pr = normalizePullRequestEvent(payload as PullRequestPayload);
  if (pr) {
    return pr;
  }
  const comment = normalizeIssueCommentEvent(payload as IssueCommentPayload);
  if (comment) {
    return comment;
  }
  const workflow = normalizeWorkflowDispatchEvent(payload as WorkflowDispatchPayload);
  if (workflow) {
    return workflow;
  }
  throw new Error("Unsupported GitHub event payload for orchestrator intake.");
}

export function computeIdempotencyKey(event: NormalizedGitHubEvent) {
  return [
    event.repository,
    event.eventType,
    event.issueNumber ?? "none",
    event.prNumber ?? "none",
    event.headSha ?? "none",
    event.command ?? "none",
    event.commentId ?? event.sourceEventId,
  ].join(":");
}

function sanitizeStateId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "orchestrator-event";
}

async function findStateByIdempotencyKey(
  dependencies: OrchestratorDependencies,
  key: string,
) {
  const ids = await dependencies.storage.listStateIds();
  for (const id of ids) {
    const state = await dependencies.storage.loadState(id);
    if (state?.idempotencyKey === key) {
      return state;
    }
  }
  return null;
}

export async function findLatestStateForThread(params: {
  dependencies: OrchestratorDependencies;
  repository: string;
  issueNumber: number | null;
  prNumber: number | null;
}) {
  const ids = await params.dependencies.storage.listStateIds();
  let latest: OrchestratorState | null = null;
  for (const id of ids) {
    const state = await params.dependencies.storage.loadState(id);
    if (!state?.sourceEventSummary) {
      continue;
    }
    if (state.sourceEventSummary.repository !== params.repository) {
      continue;
    }
    if ((params.issueNumber ?? null) !== (state.sourceEventSummary.issueNumber ?? null)) {
      continue;
    }
    if ((params.prNumber ?? null) !== (state.sourceEventSummary.prNumber ?? null)) {
      continue;
    }
    if (!latest || state.updatedAt > latest.updatedAt) {
      latest = state;
    }
  }
  return latest;
}

function eventSubtasks(event: NormalizedGitHubEvent) {
  const subtasks = ["github-intake", "idempotency", "status-reporting", "trigger-policy"];
  if (event.prNumber) {
    subtasks.push("pull-request");
  }
  if (event.issueNumber) {
    subtasks.push("issue-routing");
  }
  return subtasks;
}

export async function ingestGitHubEvent(params: {
  payload: unknown;
  dependencies: OrchestratorDependencies;
  repoPath: string;
  replayOverride?: boolean;
  enqueue?: boolean;
  now?: Date;
  webhookEventType?: WebhookEventType;
  webhookDeliveryId?: string | null;
  webhookSignatureStatus?: WebhookSignatureStatus;
}): Promise<EventIngestionResult> {
  const now = params.now ?? new Date();
  const event = normalizeGitHubEvent(params.payload);
  const policy = resolveTriggerPolicy({
    type: event.eventType,
    repository: event.repository,
    repoName: event.repoName,
    labels: event.labels,
  });
  if (!policy) {
    throw new Error(`No trigger policy matched ${event.eventType} for ${event.repository}.`);
  }

  const idempotencyKey = computeIdempotencyKey(event);
  const existing = await findStateByIdempotencyKey(params.dependencies, idempotencyKey);
  if (existing && !params.replayOverride) {
    const updated = orchestratorStateSchema.parse({
      ...existing,
      webhookEventType: params.webhookEventType ?? existing.webhookEventType,
      webhookDeliveryId: params.webhookDeliveryId ?? existing.webhookDeliveryId,
      webhookSignatureStatus: params.webhookSignatureStatus ?? existing.webhookSignatureStatus,
      parsedCommand: event.parsedCommand ?? existing.parsedCommand,
      idempotencyStatus: "linked_existing",
      duplicateOfStateId: existing.id,
      triggerPolicyId: existing.triggerPolicyId ?? policy.policyId,
      updatedAt: now.toISOString(),
    });
    await params.dependencies.storage.saveState(updated);
    return {
      status: "linked_existing",
      state: updated,
      created: false,
      duplicate: true,
      idempotencyKey,
      triggerPolicyId: updated.triggerPolicyId,
    };
  }

  const stateIdBase = sanitizeStateId(`${event.eventType}-${event.issueNumber ?? event.prNumber ?? event.sourceEventId}`);
  const stateId = params.replayOverride && existing ? `${stateIdBase}-replay-${now.getTime()}` : stateIdBase;
  const state = createInitialState({
    id: stateId,
    repoPath: params.repoPath,
    repoName: path.basename(params.repoPath),
    userGoal: event.title,
    objective: event.objective,
    subtasks: eventSubtasks(event),
    successCriteria: ["GitHub intake created an orchestrator task with stable dedupe and reporting metadata."],
    profileId: policy.profileId,
    autoMode: policy.autoMode,
    approvalMode: policy.approvalMode,
    executionMode: policy.executionMode,
    handoffConfig: policy.handoffConfig,
  });

  const enriched = orchestratorStateSchema.parse({
    ...state,
    sourceEventType: event.eventType,
    sourceEventId: event.sourceEventId,
    sourceEventSummary: event.sourceSummary,
    webhookEventType: params.webhookEventType ?? "none",
    webhookDeliveryId: params.webhookDeliveryId ?? null,
    webhookSignatureStatus: params.webhookSignatureStatus ?? "not_checked",
    parsedCommand: event.parsedCommand,
    idempotencyKey,
    idempotencyStatus: params.replayOverride && existing ? "replayed" : "created",
    duplicateOfStateId: params.replayOverride && existing ? existing.id : null,
    triggerPolicyId: policy.policyId,
    updatedAt: now.toISOString(),
  });
  await params.dependencies.storage.saveState(enriched);

  if (params.enqueue) {
    await enqueueStateRun({
      backend: params.dependencies.backend,
      state: enriched,
      requestedBy: event.triggerReason,
      scheduledAt: now.toISOString(),
    });
  }

  return {
    status: params.replayOverride && existing ? "replayed" : "created",
    state: enriched,
    created: true,
    duplicate: false,
    idempotencyKey,
    triggerPolicyId: policy.policyId,
  };
}
