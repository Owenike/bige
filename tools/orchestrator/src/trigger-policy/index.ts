import type { ExecutionMode } from "../schemas";
import type { HandoffConfig } from "../profiles";

export type TriggerPolicyRule = {
  id: string;
  eventTypes: string[];
  requiredLabels?: string[];
  repoNamePatterns?: string[];
  profileId: string;
  executionMode: ExecutionMode;
  autoMode: boolean;
  approvalMode: "auto" | "human_approval";
  handoffConfig?: Partial<HandoffConfig>;
  triggerReason: string;
};

export type NormalizedTriggerEvent = {
  type: string;
  repository: string;
  repoName: string;
  labels: string[];
};

export type TriggerPolicyDecision = {
  policyId: string;
  profileId: string;
  executionMode: ExecutionMode;
  autoMode: boolean;
  approvalMode: "auto" | "human_approval";
  handoffConfig: HandoffConfig;
  triggerReason: string;
  matchedLabels: string[];
};

const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  githubHandoffEnabled: false,
  publishBranch: false,
  createBranch: true,
};

export const DEFAULT_TRIGGER_POLICIES: TriggerPolicyRule[] = [
  {
    id: "workflow-dispatch-default",
    eventTypes: ["workflow_dispatch"],
    profileId: "default",
    executionMode: "dry_run",
    autoMode: false,
    approvalMode: "human_approval",
    triggerReason: "workflow_dispatch payload requested orchestrator intake.",
  },
  {
    id: "comment-command-default",
    eventTypes: ["issue_comment_command"],
    profileId: "default",
    executionMode: "dry_run",
    autoMode: false,
    approvalMode: "human_approval",
    triggerReason: "Issue comment explicitly requested orchestrator work.",
  },
  {
    id: "label-live-review",
    eventTypes: ["issue_labeled", "pull_request_labeled"],
    requiredLabels: ["orchestrator:handoff"],
    profileId: "default",
    executionMode: "dry_run",
    autoMode: false,
    approvalMode: "human_approval",
    handoffConfig: {
      githubHandoffEnabled: true,
      publishBranch: false,
      createBranch: true,
    },
    triggerReason: "Handoff label enabled GitHub-friendly review output.",
  },
  {
    id: "pull-request-default",
    eventTypes: ["pull_request_opened", "pull_request_labeled", "pull_request_synchronize"],
    profileId: "default",
    executionMode: "dry_run",
    autoMode: false,
    approvalMode: "human_approval",
    triggerReason: "Pull request event created a review-oriented dry-run task.",
  },
  {
    id: "issue-default",
    eventTypes: ["issue_opened", "issue_labeled"],
    profileId: "default",
    executionMode: "dry_run",
    autoMode: false,
    approvalMode: "human_approval",
    triggerReason: "Issue event created an orchestrator task for triage or dry-run execution.",
  },
];

function matchesPattern(value: string, pattern: string) {
  if (pattern === "*") {
    return true;
  }
  if (!pattern.includes("*")) {
    return value === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function normalizeHandoffConfig(config?: Partial<HandoffConfig>): HandoffConfig {
  return {
    ...DEFAULT_HANDOFF_CONFIG,
    ...(config ?? {}),
  };
}

export function resolveTriggerPolicy(
  event: NormalizedTriggerEvent,
  policies: TriggerPolicyRule[] = DEFAULT_TRIGGER_POLICIES,
): TriggerPolicyDecision | null {
  for (const rule of policies) {
    if (!rule.eventTypes.includes(event.type)) {
      continue;
    }
    if (rule.repoNamePatterns && !rule.repoNamePatterns.some((pattern) => matchesPattern(event.repoName, pattern))) {
      continue;
    }
    const matchedLabels = (rule.requiredLabels ?? []).filter((label) => event.labels.includes(label));
    if ((rule.requiredLabels ?? []).length > 0 && matchedLabels.length !== rule.requiredLabels!.length) {
      continue;
    }
    return {
      policyId: rule.id,
      profileId: rule.profileId,
      executionMode: rule.executionMode,
      autoMode: rule.autoMode,
      approvalMode: rule.approvalMode,
      handoffConfig: normalizeHandoffConfig(rule.handoffConfig),
      triggerReason: rule.triggerReason,
      matchedLabels,
    };
  }
  return null;
}
