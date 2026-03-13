import {
  DEFAULT_PROMOTION_CONFIG,
  DEFAULT_RETENTION_CONFIG,
  type PromotionConfig,
  type RetentionConfig,
} from "../config";

export type ApprovalDefaults = {
  autoMode: boolean;
  approvalMode: "auto" | "human_approval";
};

export type HandoffConfig = {
  githubHandoffEnabled: boolean;
  publishBranch: boolean;
  createBranch: boolean;
};

export type TaskRepoProfile = {
  id: string;
  name: string;
  repoType: string;
  repoPathPatterns: string[];
  allowedFiles: string[];
  forbiddenFiles: string[];
  commandAllowList: string[];
  approvalDefaults: ApprovalDefaults;
  promotionDefaults: PromotionConfig;
  retentionDefaults: RetentionConfig;
  handoffDefaults: HandoffConfig;
};

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  githubHandoffEnabled: false,
  publishBranch: false,
  createBranch: true,
};

export const DEFAULT_TASK_PROFILE: TaskRepoProfile = {
  id: "default",
  name: "Default Orchestrator Profile",
  repoType: "generic_node",
  repoPathPatterns: ["*"],
  allowedFiles: ["tools/orchestrator", "docs/orchestrator-runbook.md", "package.json", ".github/workflows"],
  forbiddenFiles: [
    "app/api/platform/notifications",
    "/api/jobs/run",
    "components/notification-overview-dashboard.tsx",
    "components/notification-overview-tenant-drilldown.tsx",
  ],
  commandAllowList: ["node", "npm", "git"],
  approvalDefaults: {
    autoMode: false,
    approvalMode: "human_approval",
  },
  promotionDefaults: DEFAULT_PROMOTION_CONFIG,
  retentionDefaults: DEFAULT_RETENTION_CONFIG,
  handoffDefaults: DEFAULT_HANDOFF_CONFIG,
};

function mergeStringArray(base: string[], override?: string[] | null) {
  if (!override) return [...base];
  return [...override];
}

export function normalizeHandoffConfig(config?: Partial<HandoffConfig> | null): HandoffConfig {
  return {
    ...DEFAULT_HANDOFF_CONFIG,
    ...(config ?? {}),
  };
}

export function resolveTaskProfile(params?: {
  profileId?: string | null;
  repoPath?: string | null;
  overrides?: Partial<Omit<TaskRepoProfile, "promotionDefaults" | "retentionDefaults" | "handoffDefaults">> & {
    promotionDefaults?: Partial<PromotionConfig> | null;
    retentionDefaults?: Partial<RetentionConfig> | null;
    handoffDefaults?: Partial<HandoffConfig> | null;
  };
}) {
  const profileId = params?.profileId?.trim() || DEFAULT_TASK_PROFILE.id;
  const overrides = params?.overrides ?? {};
  return {
    ...DEFAULT_TASK_PROFILE,
    id: profileId,
    name: overrides.name ?? DEFAULT_TASK_PROFILE.name,
    repoType: overrides.repoType ?? DEFAULT_TASK_PROFILE.repoType,
    repoPathPatterns: mergeStringArray(DEFAULT_TASK_PROFILE.repoPathPatterns, overrides.repoPathPatterns),
    allowedFiles: mergeStringArray(DEFAULT_TASK_PROFILE.allowedFiles, overrides.allowedFiles),
    forbiddenFiles: mergeStringArray(DEFAULT_TASK_PROFILE.forbiddenFiles, overrides.forbiddenFiles),
    commandAllowList: mergeStringArray(DEFAULT_TASK_PROFILE.commandAllowList, overrides.commandAllowList),
    approvalDefaults: {
      ...DEFAULT_TASK_PROFILE.approvalDefaults,
      ...(overrides.approvalDefaults ?? {}),
    },
    promotionDefaults: {
      ...DEFAULT_TASK_PROFILE.promotionDefaults,
      ...(overrides.promotionDefaults ?? {}),
    },
    retentionDefaults: {
      ...DEFAULT_TASK_PROFILE.retentionDefaults,
      ...(overrides.retentionDefaults ?? {}),
    },
    handoffDefaults: normalizeHandoffConfig(overrides.handoffDefaults),
  } satisfies TaskRepoProfile;
}
