import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveDepartmentMoney,
  canCreateAdministrativeAssistance,
  canCreatePosition,
  canManagePosition,
  legacyRoleForPosition,
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

test("new positions retain compatible legacy route roles", () => {
  assert.equal(legacyRoleForPosition("frontdesk"), "frontdesk");
  assert.equal(legacyRoleForPosition("coach"), "coach");
  assert.equal(legacyRoleForPosition("coach_assistant_manager"), "supervisor");
  assert.equal(legacyRoleForPosition("coach_manager"), "manager");
  assert.equal(legacyRoleForPosition("coach_city_manager"), "branch_manager");
});
