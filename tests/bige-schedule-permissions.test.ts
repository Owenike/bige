import assert from "node:assert/strict";
import test from "node:test";
import {
  canCompleteBigeTrialOutcome,
  canManageBigeSchedule,
  canReorderBigeScheduleCoaches,
  canViewBigeScheduleActivity,
  normalizeEmployeeNumber,
} from "../lib/bige-schedule-permissions";

test("only coaching managers and assistant managers can reorder coach columns", () => {
  assert.equal(
    canReorderBigeScheduleCoaches({
      role: "manager",
      department: "coaching",
      position: "coach_manager",
    }),
    true,
  );
  assert.equal(
    canReorderBigeScheduleCoaches({
      role: "supervisor",
      department: "coaching",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(
    canReorderBigeScheduleCoaches({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    false,
  );
  assert.equal(
    canReorderBigeScheduleCoaches({
      role: "manager",
      department: "general_affairs",
      position: "general_affairs_manager",
    }),
    false,
  );
});

test("employee 01 and 06 can manage the schedule regardless of legacy role", () => {
  assert.equal(
    canManageBigeSchedule({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
      employeeNumber: "06",
    }),
    true,
  );
  assert.equal(
    canManageBigeSchedule({
      role: "coach",
      department: "coaching",
      position: "coach",
      employeeNumber: "1",
    }),
    true,
  );
});

test("coaching team lead and above can manage while ordinary coaches remain read-only", () => {
  assert.equal(
    canManageBigeSchedule({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    true,
  );
  assert.equal(
    canManageBigeSchedule({
      role: "coach",
      department: "coaching",
      position: "coach",
    }),
    false,
  );
});

test("ordinary coaches can complete only their own FA outcome", () => {
  const coach = {
    userId: "coach-1",
    role: "coach" as const,
    department: "coaching" as const,
    position: "coach" as const,
  };
  assert.equal(canCompleteBigeTrialOutcome(coach, "coach-1"), true);
  assert.equal(canCompleteBigeTrialOutcome(coach, "coach-2"), false);
  assert.equal(canCompleteBigeTrialOutcome(coach, null), false);
});

test("managers and assistant managers see the read-only activity audit", () => {
  assert.equal(
    canViewBigeScheduleActivity({
      role: "coach",
      department: "coaching",
      position: "coach_manager",
    }),
    true,
  );
  assert.equal(
    canViewBigeScheduleActivity({
      role: "supervisor",
      department: "coaching",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(
    canViewBigeScheduleActivity({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
      employeeNumber: "E000006",
    }),
    false,
  );
});

test("employee numbers are normalized before permission checks", () => {
  assert.equal(normalizeEmployeeNumber("01"), "E000001");
  assert.equal(normalizeEmployeeNumber("e6"), "E000006");
});
