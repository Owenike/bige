import {
  actorAuthorizationDecisionSchema,
  blockedReasonSchema,
  type ActorAuthorizationDecision,
  type ActorIdentity,
  type CommandKind,
} from "../schemas";

export type ActorPolicyConfig = {
  adminActors: string[];
  runActors: string[];
  approverActors: string[];
  statusActors: string[];
  liveActors: string[];
};

export const DEFAULT_ACTOR_POLICY_CONFIG: ActorPolicyConfig = {
  adminActors: ["orchestrator-admin"],
  runActors: ["orchestrator-admin", "orchestrator-runner"],
  approverActors: ["orchestrator-admin", "orchestrator-approver"],
  statusActors: ["orchestrator-admin", "orchestrator-runner", "orchestrator-approver", "orchestrator-viewer"],
  liveActors: ["orchestrator-admin", "orchestrator-approver"],
};

function parseActorList(value: string | undefined, fallback: string[]) {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [...fallback];
}

export function loadActorPolicyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ActorPolicyConfig {
  return {
    adminActors: parseActorList(env.ORCHESTRATOR_ACTOR_ADMINS, DEFAULT_ACTOR_POLICY_CONFIG.adminActors),
    runActors: parseActorList(env.ORCHESTRATOR_ACTOR_RUNNERS, DEFAULT_ACTOR_POLICY_CONFIG.runActors),
    approverActors: parseActorList(env.ORCHESTRATOR_ACTOR_APPROVERS, DEFAULT_ACTOR_POLICY_CONFIG.approverActors),
    statusActors: parseActorList(env.ORCHESTRATOR_ACTOR_STATUS, DEFAULT_ACTOR_POLICY_CONFIG.statusActors),
    liveActors: parseActorList(env.ORCHESTRATOR_ACTOR_LIVE, DEFAULT_ACTOR_POLICY_CONFIG.liveActors),
  };
}

export type ActorPolicyDecisionInput = {
  actor: ActorIdentity | null;
  command: CommandKind | null;
  executionMode?: "mock" | "dry_run" | "apply" | null;
  approvalRequired?: boolean;
  liveRequested?: boolean;
  config?: Partial<ActorPolicyConfig>;
};

function normalizeConfig(config?: Partial<ActorPolicyConfig>): ActorPolicyConfig {
  return {
    adminActors: [...(config?.adminActors ?? DEFAULT_ACTOR_POLICY_CONFIG.adminActors)],
    runActors: [...(config?.runActors ?? DEFAULT_ACTOR_POLICY_CONFIG.runActors)],
    approverActors: [...(config?.approverActors ?? DEFAULT_ACTOR_POLICY_CONFIG.approverActors)],
    statusActors: [...(config?.statusActors ?? DEFAULT_ACTOR_POLICY_CONFIG.statusActors)],
    liveActors: [...(config?.liveActors ?? DEFAULT_ACTOR_POLICY_CONFIG.liveActors)],
  };
}

function includesActor(values: string[], actor: ActorIdentity | null) {
  if (!actor?.login) {
    return false;
  }
  return values.some((value) => value.toLowerCase() === actor.login.toLowerCase());
}

export function resolveActorAuthorization(input: ActorPolicyDecisionInput): ActorAuthorizationDecision {
  const config = normalizeConfig(input.config);
  const actorLogin = input.actor?.login ?? null;

  if (!actorLogin) {
    return actorAuthorizationDecisionSchema.parse({
      status: "rejected",
      summary: "Webhook actor identity is missing.",
      allowedCommands: [],
      blockedReason: blockedReasonSchema.parse({
        code: "missing_actor_identity",
        summary: "Webhook actor identity is missing and the command cannot be authorized.",
        missingPrerequisites: ["sender.login"],
        recoverable: true,
        suggestedNextAction: "Retry with a GitHub payload that includes sender identity.",
      }),
    });
  }

  const isAdmin = includesActor(config.adminActors, input.actor);
  const isRunActor = isAdmin || includesActor(config.runActors, input.actor);
  const isApprover = isAdmin || includesActor(config.approverActors, input.actor);
  const isStatusActor = isAdmin || includesActor(config.statusActors, input.actor);
  const isLiveActor = isAdmin || includesActor(config.liveActors, input.actor);

  if (!input.command) {
    return actorAuthorizationDecisionSchema.parse({
      status: isRunActor || isStatusActor ? "authorized" : "status_only",
      summary: isRunActor || isStatusActor
        ? `Actor ${actorLogin} is allowed to trigger non-command webhook intake.`
        : `Actor ${actorLogin} is restricted to status-only access.`,
      allowedCommands: isAdmin
        ? ["run", "dry_run", "status", "retry", "approve", "reject"]
        : isRunActor
          ? ["run", "dry_run", "status", "retry"]
          : isApprover
            ? ["status", "approve", "reject"]
            : ["status"],
      blockedReason: null,
    });
  }

  if (input.command === "status") {
    if (isStatusActor || isRunActor || isApprover) {
      return actorAuthorizationDecisionSchema.parse({
        status: isRunActor || isApprover ? "authorized" : "status_only",
        summary: `Actor ${actorLogin} can request orchestrator status.`,
        allowedCommands: ["status"],
        blockedReason: null,
      });
    }
  }

  if (input.command === "approve" || input.command === "reject") {
    if (isApprover) {
      return actorAuthorizationDecisionSchema.parse({
        status: "authorized",
        summary: `Actor ${actorLogin} can ${input.command} orchestrator approvals.`,
        allowedCommands: [input.command],
        blockedReason: null,
      });
    }
  }

  if (input.command === "run" || input.command === "dry_run" || input.command === "retry") {
    if (isRunActor) {
      if (input.executionMode === "apply" || input.liveRequested || (input.approvalRequired === false && !isApprover)) {
        if (!isLiveActor) {
          return actorAuthorizationDecisionSchema.parse({
            status: "rejected",
            summary: `Actor ${actorLogin} cannot request live/apply orchestration commands.`,
            allowedCommands: [],
            blockedReason: blockedReasonSchema.parse({
              code: "actor_live_not_allowed",
              summary: `Actor ${actorLogin} is not authorized for live/apply orchestration commands.`,
              missingPrerequisites: [],
              recoverable: true,
              suggestedNextAction: "Use dry-run/status commands or ask an approver/admin to issue the command.",
            }),
          });
        }
      }
      return actorAuthorizationDecisionSchema.parse({
        status: "authorized",
        summary: `Actor ${actorLogin} can request ${input.command}.`,
        allowedCommands: [input.command, "status"],
        blockedReason: null,
      });
    }
  }

  return actorAuthorizationDecisionSchema.parse({
    status: "rejected",
    summary: isStatusActor
      ? `Actor ${actorLogin} is limited to status-only commands and cannot run ${input.command}.`
      : `Actor ${actorLogin} is not authorized for ${input.command}.`,
    allowedCommands: isStatusActor ? ["status"] : [],
    blockedReason: blockedReasonSchema.parse({
      code: "actor_command_not_authorized",
      summary: isStatusActor
        ? `Actor ${actorLogin} is limited to status-only commands and cannot run ${input.command}.`
        : `Actor ${actorLogin} is not authorized for ${input.command}.`,
      missingPrerequisites: [],
      recoverable: true,
      suggestedNextAction: isStatusActor
        ? "Use /orchestrator status or ask an approver/admin to issue the command."
        : "Ask an approved actor to issue the command or update actor policy.",
    }),
  });
}
