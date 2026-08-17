import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageBigeCourseAllocations,
  canManageBigePlansAndDailyReports,
  canManageMemberPersonalData,
  canApproveDepartmentMoney,
  canCreateAdministrativeAssistance,
  canCreatePosition,
  canManageBigeContractRefundOrExtension,
  canManagePosition,
  canViewAllCoachSchedules,
  legacyRoleForPosition,
  roleForOrganizationAssignment,
  positionLabel,
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

test("coaching position labels include the coaching profession", () => {
  assert.equal(positionLabel("coach"), "教練");
  assert.equal(positionLabel("coach_team_lead"), "教練組長");
  assert.equal(positionLabel("coach_director"), "教練主任");
  assert.equal(positionLabel("coach_assistant_manager"), "教練副理");
  assert.equal(positionLabel("coach_manager"), "教練經理");
  assert.equal(positionLabel("coach_city_manager"), "教練城市經理");
});

test("platform and legacy management accounts keep all-coach schedule access", () => {
  assert.equal(canViewAllCoachSchedules(platformAdmin), true);
  assert.equal(canViewAllCoachSchedules(generalAffairsManager), true);
  assert.equal(
    canViewAllCoachSchedules({ role: "supervisor", department: null, position: null }),
    true,
  );
});
