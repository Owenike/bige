import type { AppRole } from "./auth-context";

export const STAFF_DEPARTMENTS = ["general_affairs", "coaching"] as const;
export type StaffDepartment = (typeof STAFF_DEPARTMENTS)[number];

export const STAFF_POSITIONS = [
  "frontdesk",
  "administrative_director",
  "general_affairs_assistant_manager",
  "general_affairs_manager",
  "coach",
  "coach_team_lead",
  "coach_director",
  "coach_assistant_manager",
  "coach_manager",
  "coach_city_manager",
] as const;
export type StaffPosition = (typeof STAFF_POSITIONS)[number];

export const DEPARTMENT_POSITIONS: Record<StaffDepartment, readonly StaffPosition[]> = {
  general_affairs: [
    "frontdesk",
    "administrative_director",
    "general_affairs_assistant_manager",
    "general_affairs_manager",
  ],
  coaching: [
    "coach",
    "coach_team_lead",
    "coach_director",
    "coach_assistant_manager",
    "coach_manager",
    "coach_city_manager",
  ],
};

const POSITION_RANK: Record<StaffPosition, number> = {
  frontdesk: 10,
  administrative_director: 20,
  general_affairs_assistant_manager: 30,
  general_affairs_manager: 40,
  coach: 10,
  coach_team_lead: 20,
  coach_director: 30,
  coach_assistant_manager: 40,
  coach_manager: 50,
  coach_city_manager: 60,
};

export function normalizeStaffDepartment(value: unknown): StaffDepartment | null {
  return typeof value === "string" && STAFF_DEPARTMENTS.includes(value as StaffDepartment)
    ? (value as StaffDepartment)
    : null;
}

export function normalizeStaffPosition(value: unknown): StaffPosition | null {
  return typeof value === "string" && STAFF_POSITIONS.includes(value as StaffPosition)
    ? (value as StaffPosition)
    : null;
}

export function positionBelongsToDepartment(
  department: StaffDepartment | null,
  position: StaffPosition | null,
) {
  return !!department && !!position && DEPARTMENT_POSITIONS[department].includes(position);
}

export function departmentLabel(department: StaffDepartment | null | undefined) {
  if (department === "general_affairs") return "庶務部";
  if (department === "coaching") return "教練部";
  return "尚未設定";
}

export function positionLabel(position: StaffPosition | null | undefined) {
  const labels: Record<StaffPosition, string> = {
    frontdesk: "櫃台",
    administrative_director: "行政主任",
    general_affairs_assistant_manager: "庶務副理",
    general_affairs_manager: "庶務經理",
    coach: "教練",
    coach_team_lead: "組長",
    coach_director: "主任",
    coach_assistant_manager: "副理",
    coach_manager: "經理",
    coach_city_manager: "城市經理",
  };
  return position ? labels[position] : "尚未設定";
}

export function legacyRoleForPosition(position: StaffPosition): AppRole {
  if (position === "frontdesk" || position === "administrative_director") return "frontdesk";
  if (position === "coach" || position === "coach_team_lead" || position === "coach_director") {
    return "coach";
  }
  if (
    position === "general_affairs_assistant_manager" ||
    position === "coach_assistant_manager"
  ) {
    return "supervisor";
  }
  if (position === "coach_city_manager") return "branch_manager";
  return "manager";
}

export type OrganizationActor = {
  role: AppRole;
  department: StaffDepartment | null;
  position: StaffPosition | null;
  branchId?: string | null;
};

export function canCreatePosition(actor: OrganizationActor, target: StaffPosition) {
  if (actor.role === "platform_admin") return true;
  if (!actor.department || !actor.position) return false;

  const targetDepartment = STAFF_DEPARTMENTS.find((department) =>
    DEPARTMENT_POSITIONS[department].includes(target),
  );
  if (!targetDepartment || targetDepartment !== actor.department) return false;

  if (actor.position === "general_affairs_manager") {
    return target !== "general_affairs_manager";
  }
  if (actor.position === "coach_city_manager") {
    return target !== "coach_city_manager";
  }
  if (actor.position === "coach_manager") {
    return POSITION_RANK[target] < POSITION_RANK.coach_manager;
  }
  return false;
}

export function canManagePosition(
  actor: OrganizationActor,
  targetDepartment: StaffDepartment | null,
  targetPosition: StaffPosition | null,
) {
  if (actor.role === "platform_admin") return true;
  if (
    !actor.department ||
    !actor.position ||
    !targetDepartment ||
    !targetPosition ||
    actor.department !== targetDepartment
  ) {
    return false;
  }

  if (
    actor.position === "general_affairs_manager" ||
    actor.position === "coach_city_manager" ||
    actor.position === "coach_manager"
  ) {
    return POSITION_RANK[targetPosition] < POSITION_RANK[actor.position];
  }
  return false;
}

export function canCreateAdministrativeAssistance(actor: OrganizationActor) {
  return (
    actor.role === "platform_admin" ||
    (actor.department === "coaching" &&
      (actor.position === "coach_assistant_manager" || actor.position === "coach_manager"))
  );
}

export function canProcessAdministrativeAssistance(actor: OrganizationActor) {
  return actor.role === "platform_admin" || actor.department === "general_affairs";
}

export function canApproveDepartmentMoney(
  actor: OrganizationActor,
  owningDepartment: StaffDepartment,
) {
  if (actor.role === "platform_admin") return true;
  if (actor.department !== owningDepartment) return false;
  if (owningDepartment === "general_affairs") {
    return actor.position === "general_affairs_manager";
  }
  return actor.position === "coach_manager" || actor.position === "coach_city_manager";
}

export function canAccessManagerWorkspace(actor: OrganizationActor) {
  return (
    actor.role === "platform_admin" ||
    actor.position === "general_affairs_assistant_manager" ||
    actor.position === "general_affairs_manager" ||
    actor.position === "coach_assistant_manager" ||
    actor.position === "coach_manager" ||
    actor.position === "coach_city_manager"
  );
}
