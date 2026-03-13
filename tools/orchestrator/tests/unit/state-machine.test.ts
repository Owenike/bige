import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/orchestrator";
import { transitionState } from "../../src/workflows/state-machine";

test("state machine advances through planning, approval, execution, and completion while blocking invalid transitions", () => {
  let state = createInitialState({
    id: "state-machine",
    repoPath: "C:/repo",
    repoName: "repo",
    userGoal: "Goal",
    objective: "Objective",
    subtasks: ["schemas", "planner", "reviewer", "executor"],
    allowedFiles: ["tools/orchestrator"],
    forbiddenFiles: ["app/api/platform/notifications"],
    successCriteria: ["done"],
  });

  state = transitionState(state, "planning_started");
  state = transitionState(state, "waiting_approval");
  state = transitionState(state, "execution_started");
  state = transitionState(state, "awaiting_result");
  state = transitionState(state, "validating");
  state = transitionState(state, "completed");
  assert.equal(state.status, "completed");

  assert.throws(() => transitionState(state, "planning_started"));
});
