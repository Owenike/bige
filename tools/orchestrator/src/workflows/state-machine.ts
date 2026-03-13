import { orchestratorStateSchema, type OrchestratorState } from "../schemas";

export type OrchestratorTransitionEvent =
  | "planning_started"
  | "plan_ready"
  | "execution_started"
  | "awaiting_result"
  | "validating"
  | "ci_running"
  | "needs_revision"
  | "blocked"
  | "completed"
  | "stopped";

const allowedTransitions: Record<OrchestratorState["status"], OrchestratorTransitionEvent[]> = {
  draft: ["planning_started", "stopped"],
  planning: ["plan_ready", "execution_started", "stopped"],
  executing: ["awaiting_result", "blocked", "stopped"],
  awaiting_result: ["validating", "blocked", "stopped"],
  validating: ["ci_running", "needs_revision", "completed", "blocked", "stopped"],
  ci_running: ["needs_revision", "completed", "blocked", "stopped"],
  needs_revision: ["planning_started", "stopped"],
  blocked: ["planning_started", "stopped"],
  completed: [],
  stopped: [],
};

const statusByEvent: Record<OrchestratorTransitionEvent, OrchestratorState["status"]> = {
  planning_started: "planning",
  plan_ready: "planning",
  execution_started: "executing",
  awaiting_result: "awaiting_result",
  validating: "validating",
  ci_running: "ci_running",
  needs_revision: "needs_revision",
  blocked: "blocked",
  completed: "completed",
  stopped: "stopped",
};

export function transitionState(
  state: OrchestratorState,
  event: OrchestratorTransitionEvent,
  now: Date = new Date(),
) {
  const allowed = allowedTransitions[state.status];
  if (!allowed.includes(event)) {
    throw new Error(`Invalid orchestrator transition from ${state.status} via ${event}.`);
  }
  return orchestratorStateSchema.parse({
    ...state,
    status: statusByEvent[event],
    updatedAt: now.toISOString(),
  });
}
