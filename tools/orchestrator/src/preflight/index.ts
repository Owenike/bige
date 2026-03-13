import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionMode, OrchestratorState } from "../schemas";
import { blockedReasonSchema, preflightResultSchema, type BlockedReason, type PreflightResult } from "../schemas";
import { resolvePromotionConfig, resolveRetentionConfig } from "../config";
import { DEFAULT_TASK_PROFILE, normalizeHandoffConfig, resolveTaskProfile } from "../profiles";
import { validateHandoffPreconditions } from "../handoff";
import { validatePublishPreconditions } from "../promotion";

const execFileAsync = promisify(execFile);

export type PreflightTargetName = "live_smoke" | "live_acceptance" | "live_pass" | "github_handoff" | "promotion";

export type PreflightEnvironment = Partial<
  Record<"OPENAI_API_KEY" | "GITHUB_TOKEN" | "GH_TOKEN" | "ORCHESTRATOR_GITHUB_HANDOFF", string | undefined>
>;

type ToolChecker = (tool: "git" | "gh") => Promise<boolean>;
type WritableChecker = (targetPath: string) => Promise<boolean>;

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

async function defaultToolChecker(tool: "git" | "gh") {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    await execFileAsync(locator, [tool], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function defaultWritableChecker(targetPath: string) {
  try {
    await mkdir(targetPath, { recursive: true });
    const probePath = path.join(targetPath, `.preflight-${Date.now()}.tmp`);
    await writeFile(probePath, "preflight\n", "utf8");
    await rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function pathReadable(targetPath: string) {
  try {
    await access(targetPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function resolveTargetStatus(blockedReasons: BlockedReason[], skippedReason?: BlockedReason | null) {
  if (skippedReason) {
    return {
      status: "skipped" as const,
      blockedReasons: [skippedReason],
      summary: skippedReason.summary,
    };
  }
  if (blockedReasons.length > 0) {
    return {
      status: "blocked" as const,
      blockedReasons,
      summary: blockedReasons.map((reason) => reason.summary).join(" | "),
    };
  }
  return {
    status: "ready" as const,
    blockedReasons: [],
    summary: "Ready.",
  };
}

function toPreconditionBlockedReasons(issues: string[], codePrefix: string) {
  return issues.map((issue, index) =>
    createBlockedReason({
      code: `${codePrefix}_${index + 1}`,
      summary: issue,
      suggestedNextAction: "Resolve the promotion/handoff precondition and retry.",
    }),
  );
}

export async function runOrchestratorPreflight(params: {
  repoPath: string;
  workspaceRoot: string;
  state?: OrchestratorState | null;
  enabled?: boolean;
  env?: PreflightEnvironment;
  toolChecker?: ToolChecker;
  writableChecker?: WritableChecker;
}) {
  const env = params.env ?? process.env;
  const toolChecker = params.toolChecker ?? defaultToolChecker;
  const writableChecker = params.writableChecker ?? defaultWritableChecker;
  const state = params.state ?? null;
  const profile = resolveTaskProfile({
    profileId: state?.task.profileId ?? DEFAULT_TASK_PROFILE.id,
    repoPath: params.repoPath,
    overrides: state
      ? {
          name: state.task.profileName,
          repoType: state.task.repoType,
          allowedFiles: state.task.allowedFiles,
          forbiddenFiles: state.task.forbiddenFiles,
          commandAllowList: state.task.commandAllowList,
          approvalDefaults: {
            autoMode: state.task.autoMode,
            approvalMode: state.task.approvalMode,
          },
          promotionDefaults: state.task.promotionConfig,
          retentionDefaults: resolveRetentionConfig(state.task),
          handoffDefaults: state.task.handoffConfig,
        }
      : undefined,
  });

  const openAiAvailable = Boolean(env.OPENAI_API_KEY);
  const githubTokenAvailable = Boolean(env.GITHUB_TOKEN || env.GH_TOKEN);
  const ghAvailable = await toolChecker("gh");
  const gitAvailable = await toolChecker("git");
  const repoReadable = await pathReadable(params.repoPath);
  const workspaceWritable = await writableChecker(params.workspaceRoot);

  const availableProviders = [
    "planner:rule_based",
    "reviewer:rule_based",
    "executor:mock",
    ...(repoReadable ? ["executor:local_repo"] : []),
    ...(openAiAvailable && workspaceWritable ? ["planner:openai", "reviewer:openai", "executor:openai_responses"] : []),
  ];
  const unavailableProviders = [
    ...(!openAiAvailable
      ? [
          { name: "planner:openai", reason: "OPENAI_API_KEY is missing." },
          { name: "reviewer:openai", reason: "OPENAI_API_KEY is missing." },
          { name: "executor:openai_responses", reason: "OPENAI_API_KEY is missing." },
        ]
      : []),
    ...(openAiAvailable && !workspaceWritable
      ? [{ name: "executor:openai_responses", reason: "Workspace root is not writable." }]
      : []),
    ...(!repoReadable ? [{ name: "executor:local_repo", reason: "Repository path is not readable." }] : []),
  ];

  const allowedExecutionModes = unique<ExecutionMode>([
    "mock" as const,
    ...(workspaceWritable ? (["dry_run"] as const) : []),
    ...(workspaceWritable && gitAvailable ? (["apply"] as const) : []),
  ]);
  const handoffDefaults = normalizeHandoffConfig(state?.task.handoffConfig);
  const allowedHandoffModes = unique([
    "payload_only" as const,
    ...(handoffDefaults.githubHandoffEnabled && githubTokenAvailable && ghAvailable ? ["github_draft_pr" as const] : []),
  ]);
  const promotionConfig = resolvePromotionConfig(state?.task ?? {});
  const allowedPromotionModes = unique([
    "patch_export" as const,
    ...(promotionConfig.allowPublish && gitAvailable ? ["branch_publish" as const] : []),
    ...(promotionConfig.allowApplyWorkspace && workspaceWritable ? ["workspace_apply" as const] : []),
  ]);

  const missingEnv = unique([
    ...(!openAiAvailable ? ["OPENAI_API_KEY"] : []),
    ...(!githubTokenAvailable && handoffDefaults.githubHandoffEnabled ? ["GITHUB_TOKEN/GH_TOKEN"] : []),
  ]);
  const missingTools = unique([
    ...(!ghAvailable && handoffDefaults.githubHandoffEnabled ? ["gh"] : []),
    ...(!gitAvailable ? ["git"] : []),
  ]);

  const liveSkippedReason = !openAiAvailable
    ? createBlockedReason({
        code: "missing_openai_api_key",
        summary: "OpenAI live paths require OPENAI_API_KEY.",
        missingPrerequisites: ["OPENAI_API_KEY"],
        suggestedNextAction: "Set OPENAI_API_KEY or use a non-live provider.",
      })
    : null;
  const liveBlocked = [
    ...(!workspaceWritable
      ? [
          createBlockedReason({
            code: "workspace_not_writable",
            summary: "Workspace root is not writable for live execution.",
            missingPrerequisites: [params.workspaceRoot],
            suggestedNextAction: "Choose a writable workspace root before running live paths.",
          }),
        ]
      : []),
  ];

  const githubHandoffBlocked = [
    ...(handoffDefaults.githubHandoffEnabled && !githubTokenAvailable
      ? [
          createBlockedReason({
            code: "missing_github_token",
            summary: "GitHub handoff requires GITHUB_TOKEN or GH_TOKEN.",
            missingPrerequisites: ["GITHUB_TOKEN", "GH_TOKEN"],
            suggestedNextAction: "Provide a GitHub token or disable GitHub handoff.",
          }),
        ]
      : []),
    ...(handoffDefaults.githubHandoffEnabled && !ghAvailable
      ? [
          createBlockedReason({
            code: "missing_gh_cli",
            summary: "GitHub handoff requires the gh CLI.",
            missingPrerequisites: ["gh"],
            suggestedNextAction: "Install/authenticate gh or use payload-only handoff.",
          }),
        ]
      : []),
    ...(state ? toPreconditionBlockedReasons(validateHandoffPreconditions(state), "handoff_precondition") : []),
  ];

  const promotionBlocked = [
    ...(!gitAvailable
      ? [
          createBlockedReason({
            code: "missing_git_cli",
            summary: "Promotion requires git.",
            missingPrerequisites: ["git"],
            suggestedNextAction: "Install git or disable promotion for this profile.",
          }),
        ]
      : []),
    ...(state ? toPreconditionBlockedReasons(validatePublishPreconditions(state), "promotion_precondition") : []),
  ];

  const targets = [
    {
      target: "live_smoke" as const,
      ...resolveTargetStatus(
        liveBlocked,
        params.enabled === false
          ? createBlockedReason({
              code: "disabled_by_configuration",
              summary: "Live smoke is disabled by configuration.",
              suggestedNextAction: "Enable the live path when you are ready to run it.",
            })
          : liveSkippedReason,
      ),
    },
    {
      target: "live_acceptance" as const,
      ...resolveTargetStatus(
        liveBlocked,
        params.enabled === false
          ? createBlockedReason({
              code: "disabled_by_configuration",
              summary: "Live acceptance is disabled by configuration.",
              suggestedNextAction: "Enable the live acceptance path when you are ready to run it.",
            })
          : liveSkippedReason,
      ),
    },
    {
      target: "live_pass" as const,
      ...resolveTargetStatus(
        liveBlocked,
        params.enabled === false
          ? createBlockedReason({
              code: "disabled_by_configuration",
              summary: "Live pass is disabled by configuration.",
              suggestedNextAction: "Enable the live pass path when you are ready to run it.",
            })
          : liveSkippedReason,
      ),
    },
    {
      target: "github_handoff" as const,
      ...resolveTargetStatus(
        githubHandoffBlocked,
        handoffDefaults.githubHandoffEnabled
          ? null
          : createBlockedReason({
              code: "github_handoff_disabled",
              summary: "GitHub handoff is disabled by handoff configuration.",
              suggestedNextAction: "Enable GitHub handoff in the task profile or use payload-only handoff.",
            }),
      ),
    },
    {
      target: "promotion" as const,
      ...resolveTargetStatus(
        promotionBlocked,
        null,
      ),
    },
  ];

  const blockedReasons = unique(targets.flatMap((target) => target.blockedReasons.map((reason) => JSON.stringify(reason)))).map(
    (reason) => blockedReasonSchema.parse(JSON.parse(reason)),
  );
  const summary =
    blockedReasons.length === 0
      ? `Preflight ready for profile ${profile.id}.`
      : `Preflight found ${blockedReasons.length} blocked prerequisite(s) for profile ${profile.id}.`;

  return preflightResultSchema.parse({
    checkedAt: new Date().toISOString(),
    profileId: profile.id,
    availableProviders,
    unavailableProviders,
    missingEnv,
    missingTools,
    allowedExecutionModes,
    allowedHandoffModes,
    allowedPromotionModes,
    blockedReasons,
    targets,
    summary,
  }) satisfies PreflightResult;
}

export function getPreflightTarget(result: PreflightResult, target: PreflightTargetName) {
  return result.targets.find((item) => item.target === target) ?? null;
}

export function formatPreflightSummary(result: PreflightResult) {
  const lines = [
    `Preflight: ${result.summary}`,
    `Profile: ${result.profileId}`,
    `Available providers: ${result.availableProviders.join(", ") || "none"}`,
    `Missing env: ${result.missingEnv.join(", ") || "none"}`,
    `Missing tools: ${result.missingTools.join(", ") || "none"}`,
    `Allowed execution modes: ${result.allowedExecutionModes.join(", ") || "none"}`,
    `Allowed handoff modes: ${result.allowedHandoffModes.join(", ") || "none"}`,
    `Allowed promotion modes: ${result.allowedPromotionModes.join(", ") || "none"}`,
  ];
  for (const target of result.targets) {
    lines.push(`- ${target.target}: ${target.status} :: ${target.summary}`);
  }
  return lines.join("\n");
}
