import type { AppRole, ProfileContext } from "./auth-context";
import type { StaffDepartment, StaffPosition } from "./staff-organization";

type SchedulePermissionActor = Pick<ProfileContext, "role" | "department" | "position"> & {
  employeeNumber?: string | null;
};

const SCHEDULE_MANAGER_EMPLOYEE_NUMBERS = new Set(["E000001", "E000006"]);
const COACHING_SCHEDULE_MANAGER_POSITIONS = new Set<StaffPosition>([
  "coach_team_lead",
  "coach_director",
  "coach_assistant_manager",
  "coach_manager",
  "coach_city_manager",
]);
const LEGACY_SCHEDULE_MANAGER_ROLES = new Set<AppRole>([
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
]);
const ACTIVITY_VIEWER_POSITIONS = new Set<StaffPosition>([
  "coach_assistant_manager",
  "coach_manager",
  "coach_city_manager",
]);
const LEGACY_ACTIVITY_VIEWER_ROLES = new Set<AppRole>([
  "manager",
  "supervisor",
  "branch_manager",
  "store_owner",
  "store_manager",
]);

export function normalizeEmployeeNumber(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const digits = raw.replace(/^E/, "");
  return /^\d+$/.test(digits) ? `E${digits.padStart(6, "0")}` : raw;
}

export function canManageBigeSchedule(actor: SchedulePermissionActor) {
  if (actor.role === "platform_admin") return true;
  if (SCHEDULE_MANAGER_EMPLOYEE_NUMBERS.has(normalizeEmployeeNumber(actor.employeeNumber))) {
    return true;
  }
  if (
    actor.department === "coaching" &&
    actor.position &&
    COACHING_SCHEDULE_MANAGER_POSITIONS.has(actor.position)
  ) {
    return true;
  }
  return !actor.department && !actor.position && LEGACY_SCHEDULE_MANAGER_ROLES.has(actor.role);
}

export function canCompleteBigeTrialOutcome(
  actor: SchedulePermissionActor & { userId?: string | null },
  assignedCoachId: string | null | undefined,
) {
  if (canManageBigeSchedule(actor)) return true;
  return (
    actor.role === "coach" &&
    !!actor.userId &&
    !!assignedCoachId &&
    actor.userId === assignedCoachId
  );
}

export function canReorderBigeScheduleCoaches(actor: SchedulePermissionActor) {
  return (
    actor.department === "coaching" &&
    (actor.position === "coach_manager" || actor.position === "coach_assistant_manager")
  );
}

export function canViewBigeScheduleActivity(actor: SchedulePermissionActor) {
  if (actor.role === "platform_admin") return true;
  if (normalizeEmployeeNumber(actor.employeeNumber) === "E000001") return true;
  if (
    actor.department === "coaching" &&
    actor.position &&
    ACTIVITY_VIEWER_POSITIONS.has(actor.position)
  ) {
    return true;
  }
  return !actor.department && !actor.position && LEGACY_ACTIVITY_VIEWER_ROLES.has(actor.role);
}

export function isExplicitFrontdeskScheduleManager(actor: SchedulePermissionActor) {
  return normalizeEmployeeNumber(actor.employeeNumber) === "E000006";
}

export type { SchedulePermissionActor, StaffDepartment, StaffPosition };
