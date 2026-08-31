import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canManageBigeSchedule } from "../lib/bige-schedule-permissions";
import { canPerformInContext } from "../lib/permissions";
import {
  canManageBigeCourseAllocations,
  canManageBigePlansAndDailyReports,
  canManageMemberPersonalData,
  canApproveDepartmentMoney,
  canCreateAdministrativeAssistance,
  canCreatePosition,
  canManageBigeContractRefundOrExtension,
  canManageBigePaidScheduleCells,
  canUseBigeWalkInPayments,
  canManagePosition,
  canViewAllCoachSchedules,
  legacyRoleForPosition,
  roleForOrganizationAssignment,
  positionLabel,
  positionLabelForEmployee,
  staffPositionForDisplay,
  type OrganizationActor,
} from "../lib/staff-organization";

const platformAdmin: OrganizationActor = {
  role: "platform_admin",
  department: null,
  position: null,
};

const generalAffairsManager: OrganizationActor = {
  role: "manager",
  department: "general_affairs",
  position: "general_affairs_manager",
};

const coachManager: OrganizationActor = {
  role: "manager",
  department: "coaching",
  position: "coach_manager",
};

const coachCityManager: OrganizationActor = {
  role: "branch_manager",
  department: "coaching",
  position: "coach_city_manager",
};

test("platform admin can create every department position", () => {
  assert.equal(canCreatePosition(platformAdmin, "general_affairs_manager"), true);
  assert.equal(canCreatePosition(platformAdmin, "coach_city_manager"), true);
});

test("department managers can only create lower positions in their own department", () => {
  assert.equal(canCreatePosition(generalAffairsManager, "administrative_director"), true);
  assert.equal(canCreatePosition(generalAffairsManager, "general_affairs_manager"), false);
  assert.equal(canCreatePosition(generalAffairsManager, "coach"), false);

  assert.equal(canCreatePosition(coachManager, "coach_assistant_manager"), true);
  assert.equal(canCreatePosition(coachManager, "coach_manager"), false);
  assert.equal(canCreatePosition(coachCityManager, "coach_manager"), true);
  assert.equal(canCreatePosition(coachCityManager, "coach_city_manager"), false);
});

test("cross-department staff management is blocked outside platform admin", () => {
  assert.equal(
    canManagePosition(generalAffairsManager, "general_affairs", "frontdesk"),
    true,
  );
  assert.equal(canManagePosition(generalAffairsManager, "coaching", "coach"), false);
  assert.equal(canManagePosition(platformAdmin, "coaching", "coach_city_manager"), true);
});

test("only coaching assistant manager and manager create assistance items", () => {
  assert.equal(
    canCreateAdministrativeAssistance({
      role: "supervisor",
      department: "coaching",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(canCreateAdministrativeAssistance(coachManager), true);
  assert.equal(canCreateAdministrativeAssistance(coachCityManager), false);
  assert.equal(canCreateAdministrativeAssistance(generalAffairsManager), false);
});

test("department money approval stays inside its owning department", () => {
  assert.equal(canApproveDepartmentMoney(generalAffairsManager, "general_affairs"), true);
  assert.equal(canApproveDepartmentMoney(generalAffairsManager, "coaching"), false);
  assert.equal(canApproveDepartmentMoney(coachManager, "coaching"), true);
  assert.equal(canApproveDepartmentMoney(coachManager, "general_affairs"), false);
  assert.equal(canApproveDepartmentMoney(platformAdmin, "general_affairs"), true);
  assert.equal(canApproveDepartmentMoney(platformAdmin, "coaching"), true);
});

test("only coaching managers and assistant managers handle contract refunds or extensions", () => {
  assert.equal(canManageBigeContractRefundOrExtension(platformAdmin), true);
  assert.equal(canManageBigeContractRefundOrExtension(coachManager), true);
  assert.equal(canManageBigeContractRefundOrExtension(coachCityManager), true);
  assert.equal(
    canManageBigeContractRefundOrExtension({
      role: "supervisor",
      department: "coaching",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(canManageBigeContractRefundOrExtension(generalAffairsManager), false);
  assert.equal(
    canManageBigeContractRefundOrExtension({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    false,
  );
});

test("paid schedule cells are restricted to coaching management while platform admins stay unrestricted", () => {
  const assistantManager: OrganizationActor = {
    role: "supervisor",
    department: "coaching",
    position: "coach_assistant_manager",
  };
  assert.equal(canManageBigePaidScheduleCells(platformAdmin), true);
  assert.equal(canManageBigePaidScheduleCells(coachManager), true);
  assert.equal(canManageBigePaidScheduleCells(coachCityManager), true);
  assert.equal(canManageBigePaidScheduleCells(assistantManager), true);
  assert.equal(canManageBigePaidScheduleCells(generalAffairsManager), false);
  assert.equal(
    canManageBigePaidScheduleCells({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    false,
  );
  assert.equal(
    canManageBigePaidScheduleCells({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
    }),
    false,
  );
});

test("walk-in payment button is limited to employee 06 and coaching team lead or above", () => {
  assert.equal(canUseBigeWalkInPayments({ ...platformAdmin, employeeNumber: "E000001" }), true);
  assert.equal(
    canUseBigeWalkInPayments({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
      employeeNumber: "E000006",
    }),
    true,
  );
  for (const position of [
    "coach_team_lead",
    "coach_director",
    "coach_assistant_manager",
    "coach_manager",
    "coach_city_manager",
  ] as const) {
    assert.equal(
      canUseBigeWalkInPayments({
        role: legacyRoleForPosition(position),
        department: "coaching",
        position,
        employeeNumber: "E000099",
      }),
      true,
    );
  }
  assert.equal(
    canUseBigeWalkInPayments({
      role: "coach",
      department: "coaching",
      position: "coach",
      employeeNumber: "E000007",
    }),
    false,
  );
});

test("only coaching managers and assistant managers configure specialty sessions", () => {
  const assistantManager: OrganizationActor = {
    role: "supervisor",
    department: "coaching",
    position: "coach_assistant_manager",
  };
  assert.equal(canManageBigeCourseAllocations(platformAdmin), true);
  assert.equal(canManageBigeCourseAllocations(coachManager), true);
  assert.equal(canManageBigeCourseAllocations(coachCityManager), true);
  assert.equal(canManageBigeCourseAllocations(assistantManager), true);
  assert.equal(canManageBigeCourseAllocations(generalAffairsManager), false);
  assert.equal(
    canManageBigeCourseAllocations({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    false,
  );
  assert.equal(
    canManageBigeCourseAllocations({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
    }),
    false,
  );
});

test("coaching assistant managers can maintain plans, daily reports, and member personal data", () => {
  const assistantManager: OrganizationActor = {
    role: "supervisor",
    department: "coaching",
    position: "coach_assistant_manager",
  };
  for (const actor of [platformAdmin, coachManager, coachCityManager, assistantManager]) {
    assert.equal(canManageBigePlansAndDailyReports(actor), true);
    assert.equal(canManageMemberPersonalData(actor), true);
  }
  assert.equal(canManageBigePlansAndDailyReports(generalAffairsManager), false);
  assert.equal(canManageMemberPersonalData(generalAffairsManager), false);
  assert.equal(
    canManageMemberPersonalData({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
    }),
    false,
  );
});

test("new positions retain compatible legacy route roles", () => {
  assert.equal(legacyRoleForPosition("frontdesk"), "frontdesk");
  assert.equal(legacyRoleForPosition("coach"), "coach");
  assert.equal(legacyRoleForPosition("coach_assistant_manager"), "supervisor");
  assert.equal(legacyRoleForPosition("coach_manager"), "manager");
  assert.equal(legacyRoleForPosition("coach_city_manager"), "branch_manager");
});

test("organization assignment preserves the 01 platform admin role", () => {
  assert.equal(roleForOrganizationAssignment("platform_admin", "coach"), "platform_admin");
  assert.equal(
    roleForOrganizationAssignment("platform_admin", "coach_manager"),
    "platform_admin",
  );
  assert.equal(roleForOrganizationAssignment("coach", "coach_team_lead"), "coach");
});

test("coach team leads and higher positions can view every coach schedule", () => {
  for (const position of [
    "coach_team_lead",
    "coach_director",
    "coach_assistant_manager",
    "coach_manager",
    "coach_city_manager",
  ] as const) {
    assert.equal(
      canViewAllCoachSchedules({
        role: legacyRoleForPosition(position),
        department: "coaching",
        position,
      }),
      true,
    );
  }
});

test("ordinary coaches stay limited to their own schedule", () => {
  assert.equal(
    canViewAllCoachSchedules({
      role: "coach",
      department: "coaching",
      position: "coach",
    }),
    false,
  );
  assert.equal(
    canViewAllCoachSchedules({
      role: "frontdesk",
      department: "general_affairs",
      position: "frontdesk",
    }),
    false,
  );
});

test("employee 05 can view every coach schedule without receiving team-lead management permissions", () => {
  const scheduleRoute = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const employee05 = {
    role: "coach",
    department: "coaching",
    position: "coach",
    employeeNumber: "05",
  } as const;

  assert.equal(canViewAllCoachSchedules(employee05), true);
  assert.equal(canManageBigeSchedule(employee05), false);
  assert.match(
    scheduleRoute,
    /canViewAllCoachSchedules\(\{[\s\S]{0,300}employeeNumber: auth\.context\.employeeNumber/,
  );
});

test("coaching position labels include the coaching profession", () => {
  assert.equal(positionLabel("coach"), "教練");
  assert.equal(positionLabel("coach_team_lead"), "教練組長");
  assert.equal(positionLabel("coach_director"), "教練主任");
  assert.equal(positionLabel("coach_assistant_manager"), "教練副理");
  assert.equal(positionLabel("coach_manager"), "教練經理");
  assert.equal(positionLabel("coach_city_manager"), "教練城市經理");
});

test("Becky keeps team-lead permissions while her visible title stays coach", () => {
  const rawPosition = "coach_team_lead" as const;
  assert.equal(staffPositionForDisplay(rawPosition, "E000002"), "coach");
  assert.equal(positionLabelForEmployee(rawPosition, "02"), "教練");
  assert.equal(
    canManageBigeSchedule({
      role: "coach",
      department: "coaching",
      position: rawPosition,
      employeeNumber: "E000002",
    }),
    true,
  );
  assert.equal(
    canPerformInContext(
      { role: "coach", department: "coaching", position: rawPosition },
      "reports.read",
    ),
    true,
  );
});

test("employee 05 never displays a team-lead title", () => {
  assert.equal(staffPositionForDisplay("coach_team_lead", "E000005"), "coach");
  assert.equal(positionLabelForEmployee("coach_team_lead", "05"), "教練");
});

test("the team-lead title remains visible for every other account", () => {
  assert.equal(staffPositionForDisplay("coach_team_lead", "E000003"), "coach_team_lead");
  assert.equal(positionLabelForEmployee("coach_team_lead", "E000003"), "教練組長");
  assert.equal(positionLabelForEmployee("coach_assistant_manager", "E000002"), "教練副理");
});

test("all Becky position surfaces use the display-only position helper", () => {
  const schedule = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const performance = readFileSync("components/staff-performance-dashboard.tsx", "utf8");
  const staff = readFileSync("app/manager/staff/page.tsx", "utf8");
  const activation = readFileSync("app/staff/activate/page.tsx", "utf8");

  assert.match(schedule, /staffPositionForDisplay\(coach\.position, coach\.employee_number\)/);
  assert.match(schedule, /positionLabelForEmployee\([\s\S]{0,120}sessionIdentity\.employeeNumber/);
  assert.match(performance, /staffPositionForDisplay\(coach\.position, coach\.employee_number\)/);
  assert.match(staff, /positionLabelForEmployee\(item\.position, item\.employee_number\)/);
  assert.match(staff, /positionLabelForEmployee\(position, editing\.employee_number\)/);
  assert.match(activation, /positionLabelForEmployee\(profile\.position, profile\.employeeNumber\)/);
});

test("staff account management keeps the manager fitness visual system", () => {
  const staffStyles = readFileSync("app/manager/staff/page.module.css", "utf8");

  assert.match(
    staffStyles,
    /\.page \{[\s\S]*linear-gradient\(112deg, #183149 0%, #172b3c 45%, #202832 72%, #454542 100%\)/,
  );
  assert.match(
    staffStyles,
    /\.glassCard \{[\s\S]*border-color: var\(--staff-ice-line\)[\s\S]*var\(--staff-glass\)/,
  );
  assert.match(
    staffStyles,
    /\.primary,[\s\S]*linear-gradient\(135deg, var\(--staff-gold-bright\) 0%, var\(--staff-gold\) 57%, #b98434 100%\)/,
  );
  assert.match(
    staffStyles,
    /\.input,[\s\S]*background: rgba\(5, 11, 18, 0\.66\)/,
  );
  assert.match(staffStyles, /@media \(max-width: 900px\)[\s\S]*\.stats \{/);
  assert.match(staffStyles, /@media \(max-width: 560px\)[\s\S]*\.page \{/);
});

test("platform and legacy management accounts keep all-coach schedule access", () => {
  assert.equal(canViewAllCoachSchedules(platformAdmin), true);
  assert.equal(canViewAllCoachSchedules(generalAffairsManager), true);
  assert.equal(
    canViewAllCoachSchedules({ role: "supervisor", department: null, position: null }),
    true,
  );
});
