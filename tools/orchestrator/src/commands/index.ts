import type { ExecutionMode, ParsedCommand } from "../schemas";
import type { TriggerPolicyDecision } from "../trigger-policy";

const MODE_ALIASES: Record<string, ExecutionMode> = {
  mock: "mock",
  "dry-run": "dry_run",
  dry_run: "dry_run",
  apply: "apply",
};

export type CommandRoutingDecision = {
  status: "accepted" | "ignored" | "rejected" | "routed";
  action: "none" | "create_task" | "enqueue_existing" | "report_status" | "retry" | "approve" | "reject";
  reasonCode: string | null;
  summary: string;
  suggestedNextAction: string | null;
  targetStateId: string | null;
};

function tokenizeCommand(raw: string) {
  return raw.trim().split(/\s+/).filter(Boolean);
}

function parseValueFlag(tokens: string[], key: string) {
  const prefix = `${key}=`;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith(prefix)) {
      return token.slice(prefix.length);
    }
    if (token === `--${key}`) {
      return tokens[index + 1] ?? null;
    }
  }
  return null;
}

export function parseOrchestratorCommand(body: string | null | undefined): ParsedCommand | null {
  if (!body) {
    return null;
  }
  const trimmed = body.trim();
  const match = trimmed.match(/(^|\n)\s*(\/orchestrator(?:\s+[^\r\n]+)?)/i);
  if (!match) {
    return null;
  }

  const rawCommand = match[2].trim();
  const tokens = tokenizeCommand(rawCommand);
  if (tokens.length < 2 || tokens[0].toLowerCase() !== "/orchestrator") {
    return null;
  }

  const actionToken = tokens[1].toLowerCase();
  const kind =
    actionToken === "run"
      ? "run"
      : actionToken === "dry-run" || actionToken === "dry_run"
        ? "dry_run"
        : actionToken === "status"
          ? "status"
          : actionToken === "retry"
            ? "retry"
            : actionToken === "approve"
              ? "approve"
              : actionToken === "reject"
                ? "reject"
                : null;
  if (!kind) {
    return null;
  }

  const modeToken = parseValueFlag(tokens, "mode");
  const profileOverride = parseValueFlag(tokens, "profile");
  const executionMode = modeToken ? MODE_ALIASES[modeToken.toLowerCase()] ?? null : kind === "dry_run" ? "dry_run" : null;
  const approvalIntent = kind === "approve" ? "approve" : kind === "reject" ? "reject" : null;

  return {
    kind,
    executionMode,
    profileOverride,
    approvalIntent,
    rawCommand,
    arguments: tokens.slice(2),
  };
}

export function routeParsedCommand(params: {
  command: ParsedCommand;
  policy: TriggerPolicyDecision | null;
  existingStateId?: string | null;
}): CommandRoutingDecision {
  const { command, policy } = params;
  const allowedCommands = policy?.allowedCommands ?? [];
  if (policy && allowedCommands.length > 0 && !allowedCommands.includes(command.kind)) {
    return {
      status: "rejected",
      action: "none",
      reasonCode: "command_not_allowed",
      summary: `Command ${command.kind} is not allowed by trigger policy ${policy.policyId}.`,
      suggestedNextAction: "Use an allowed orchestrator command or update the trigger policy.",
      targetStateId: params.existingStateId ?? null,
    };
  }

  if ((command.kind === "approve" || command.kind === "reject" || command.kind === "retry" || command.kind === "status") && !params.existingStateId) {
    return {
      status: "rejected",
      action: "none",
      reasonCode: "missing_target_state",
      summary: `Command ${command.kind} requires an existing orchestrator state for this thread.`,
      suggestedNextAction: "Create or link a task first, then retry the command.",
      targetStateId: null,
    };
  }

  switch (command.kind) {
    case "run":
    case "dry_run":
      return {
        status: "accepted",
        action: params.existingStateId ? "enqueue_existing" : "create_task",
        reasonCode: null,
        summary: params.existingStateId
          ? "Comment command requested a new queued run for the existing task."
          : "Comment command requested a new orchestrator task.",
        suggestedNextAction: params.existingStateId ? "Enqueue or inspect the linked task." : "Create the task and queue the first run.",
        targetStateId: params.existingStateId ?? null,
      };
    case "status":
      return {
        status: "routed",
        action: "report_status",
        reasonCode: null,
        summary: "Comment command requested a status summary.",
        suggestedNextAction: "Emit or refresh the correlated status comment.",
        targetStateId: params.existingStateId ?? null,
      };
    case "retry":
      return {
        status: "routed",
        action: "retry",
        reasonCode: null,
        summary: "Comment command requested a retry or requeue for the existing task.",
        suggestedNextAction: "Requeue the linked run if preconditions are satisfied.",
        targetStateId: params.existingStateId ?? null,
      };
    case "approve":
      return {
        status: "routed",
        action: "approve",
        reasonCode: null,
        summary: "Comment command requested approval for the linked task.",
        suggestedNextAction: "Apply the appropriate plan or patch approval path.",
        targetStateId: params.existingStateId ?? null,
      };
    case "reject":
      return {
        status: "routed",
        action: "reject",
        reasonCode: null,
        summary: "Comment command requested rejection for the linked task.",
        suggestedNextAction: "Apply the appropriate plan or patch rejection path.",
        targetStateId: params.existingStateId ?? null,
      };
    default:
      return {
        status: "ignored",
        action: "none",
        reasonCode: "unsupported_command",
        summary: "The comment did not contain a supported orchestrator command.",
        suggestedNextAction: "Use a supported /orchestrator command.",
        targetStateId: params.existingStateId ?? null,
      };
  }
}
