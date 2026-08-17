import assert from "node:assert/strict";
import test from "node:test";
import { canPerform, canPerformInContext } from "../lib/permissions";
import { PERMISSION_ACTIONS } from "../lib/role-permissions";
import {
  canDirectlyApproveBigeContractRisk,
  canRecordBigeContractPayment,
  isBigeContractRiskRequester,
  isTenantManager,
} from "../lib/staff-organization";
import { defaultStaffPermission } from "../lib/staff-operation-permissions";

test("tenant managers inherit the complete manager permission set without platform-only actions", () => {
  const manager = {
    role: "manager" as const,
    department: "coaching" as const,
    position: "coach_manager" as const,
  };
  assert.equal(isTenantManager(manager), true);
  for (const action of PERMISSION_ACTIONS) {
    assert.equal(
      canPerformInContext(manager, action),
      canPerform("manager", action),
      `manager permission mismatch for ${action}`,
    );
  }
  assert.equal(canPerformInContext(manager, "jobs.settings.write"), false);
  assert.equal(canPerformInContext(manager, "members.update"), true);
});

test("assistant manager can record payments and request risk actions but cannot approve them", () => {
  const deputy = {
    role: "supervisor" as const,
    department: "coaching" as const,
    position: "coach_assistant_manager" as const,
  };
  assert.equal(canRecordBigeContractPayment(deputy), true);
  assert.equal(isBigeContractRiskRequester(deputy), true);
  assert.equal(canDirectlyApproveBigeContractRisk(deputy), false);
  assert.equal(canPerformInContext(deputy, "audit.read"), true);
  assert.equal(canPerformInContext(deputy, "payments.write"), true);
});

test("manager directly approves risk actions and frontdesk only records payments", () => {
  const manager = {
    role: "manager" as const,
    department: "coaching" as const,
    position: "coach_manager" as const,
  };
  const frontdesk = {
    role: "frontdesk" as const,
    department: "general_affairs" as const,
    position: "frontdesk" as const,
  };
  assert.equal(canDirectlyApproveBigeContractRisk(manager), true);
  assert.equal(canRecordBigeContractPayment(manager), true);
  assert.equal(canRecordBigeContractPayment(frontdesk), true);
  assert.equal(isBigeContractRiskRequester(frontdesk), false);
});

test("assistant manager prepares payroll but cannot close or issue it", () => {
  const deputy = {
    role: "supervisor" as const,
    position: "coach_assistant_manager" as const,
  };
  assert.equal(defaultStaffPermission(deputy, "view_team_salary"), true);
  assert.equal(defaultStaffPermission(deputy, "calculate_payroll"), true);
  assert.equal(defaultStaffPermission(deputy, "close_payroll"), false);
  assert.equal(defaultStaffPermission(deputy, "manage_permissions"), false);
});
