import type { AppRole } from "./auth-context";
import type { StaffDepartment, StaffPosition } from "./staff-organization";

export const PAST_EMPLOYEE_BOOKING_ERROR =
  "只有教練經理或教練副理能新增、移動或恢復已過日期的預約";

type EmployeeBookingActor = {
  role: AppRole | string;
  department?: StaffDepartment | string | null;
  position?: StaffPosition | string | null;
};

const PAST_BOOKING_MANAGER_POSITIONS = new Set<StaffPosition>([
  "coach_assistant_manager",
  "coach_manager",
]);

const LEGACY_PAST_BOOKING_MANAGER_ROLES = new Set<AppRole>([
  "manager",
  "supervisor",
]);

export function taipeiDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isPastTaipeiBookingDate(startsAt: string | Date, now = new Date()) {
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(date.getTime())) return false;
  return taipeiDateString(date) < taipeiDateString(now);
}

export function canManagePastEmployeeBookings(actor: EmployeeBookingActor) {
  if (actor.department || actor.position) {
    return (
      actor.department === "coaching" &&
      !!actor.position &&
      PAST_BOOKING_MANAGER_POSITIONS.has(actor.position as StaffPosition)
    );
  }
  return LEGACY_PAST_BOOKING_MANAGER_ROLES.has(actor.role as AppRole);
}

export function isPastEmployeeBookingBlocked(
  actor: EmployeeBookingActor,
  startsAt: string | Date,
  now = new Date(),
) {
  return (
    isPastTaipeiBookingDate(startsAt, now) &&
    !canManagePastEmployeeBookings(actor)
  );
}

export type { EmployeeBookingActor };
