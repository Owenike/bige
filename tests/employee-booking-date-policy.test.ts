import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAST_EMPLOYEE_BOOKING_ERROR,
  canManagePastEmployeeBookings,
  isPastEmployeeBookingBlocked,
  isPastTaipeiBookingDate,
  taipeiDateString,
} from "../lib/employee-booking-date-policy";

const taipeiNow = new Date("2026-08-26T00:15:00+08:00");

test("past date uses the Taipei calendar day and permits earlier times today", () => {
  assert.equal(taipeiDateString(taipeiNow), "2026-08-26");
  assert.equal(isPastTaipeiBookingDate("2026-08-25T23:59:00+08:00", taipeiNow), true);
  assert.equal(isPastTaipeiBookingDate("2026-08-26T00:00:00+08:00", taipeiNow), false);
  assert.equal(isPastTaipeiBookingDate("2026-08-27T00:00:00+08:00", taipeiNow), false);
});
test("only coaching manager and assistant manager may manage past employee bookings", () => {
  assert.equal(
    canManagePastEmployeeBookings({
      role: "manager",
      department: "coaching",
      position: "coach_manager",
    }),
    true,
  );
  assert.equal(
    canManagePastEmployeeBookings({
      role: "supervisor",
      department: "coaching",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(
    canManagePastEmployeeBookings({
      role: "coach",
      department: "coaching",
      position: "coach_team_lead",
    }),
    false,
  );
  assert.equal(
    canManagePastEmployeeBookings({
      role: "platform_admin",
      department: null,
      position: null,
    }),
    false,
  );
  assert.equal(
    canManagePastEmployeeBookings({
      role: "manager",
      department: "general_affairs",
      position: "general_affairs_manager",
    }),
    false,
  );
});

test("legacy manager and supervisor accounts remain compatible only without organization metadata", () => {
  assert.equal(canManagePastEmployeeBookings({ role: "manager" }), true);
  assert.equal(canManagePastEmployeeBookings({ role: "supervisor" }), true);
  assert.equal(canManagePastEmployeeBookings({ role: "frontdesk" }), false);
});

test("regular authorized employees are blocked only for dates before today", () => {
  const teamLead = {
    role: "coach" as const,
    department: "coaching" as const,
    position: "coach_team_lead" as const,
  };
  assert.equal(
    isPastEmployeeBookingBlocked(teamLead, "2026-08-25T19:00:00+08:00", taipeiNow),
    true,
  );
  assert.equal(
    isPastEmployeeBookingBlocked(teamLead, "2026-08-26T09:00:00+08:00", taipeiNow),
    false,
  );
  assert.equal(
    isPastEmployeeBookingBlocked(teamLead, "2026-08-27T09:00:00+08:00", taipeiNow),
    false,
  );
  assert.match(PAST_EMPLOYEE_BOOKING_ERROR, /教練經理或教練副理/);
});

test("every employee booking entry point and the database guard enforce the policy", () => {
  const bigeRoute = readFileSync("app/api/bige-fitness/route.ts", "utf8");
  const bookingRoute = readFileSync("app/api/bookings/route.ts", "utf8");
  const bookingUpdateRoute = readFileSync("app/api/bookings/[id]/route.ts", "utf8");
  const trialRoute = readFileSync("app/api/admin/trial-bookings/route.ts", "utf8");
  const trialScheduleRoute = readFileSync(
    "app/api/admin/trial-bookings/[id]/schedule/route.ts",
    "utf8",
  );
  const component = readFileSync("components/bige-fitness-operations.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260825161932_restrict_employee_past_booking_dates.sql",
    "utf8",
  );

  for (const action of [
    "create_schedule",
    "get_schedule_coach_options",
    "check_schedule_batch_assignments",
    "check_schedule_batch",
    "create_schedule_batch",
    "create_schedule_batch_assignments",
    "move_schedule_booking",
  ]) {
    const actionStart = bigeRoute.indexOf(`input.action === "${action}"`);
    assert.notEqual(actionStart, -1, `missing ${action} action`);
    assert.match(bigeRoute.slice(actionStart, actionStart + 1200), /pastEmployeeBookingError/);
  }
  assert.match(bookingRoute, /isPastEmployeeBookingBlocked\(auth\.context, startsAt\)/);
  assert.match(bookingUpdateRoute, /startsAt &&[\s\S]*isPastEmployeeBookingBlocked/);
  assert.match(trialRoute, /canManagePastBookings:[\s\S]*isPastEmployeeBookingBlocked/);
  assert.match(trialScheduleRoute, /existingSchedule\.data\.starts_at[\s\S]*isPastEmployeeBookingBlocked/);
  assert.match(component, /canManagePastBookings[\s\S]*day < toTaipeiDateString\(\)/);
  assert.match(migration, /before insert or update of starts_at, status[\s\S]*on public\.bookings/);
  assert.match(migration, /auth\.uid\(\)[\s\S]*coach_assistant_manager[\s\S]*coach_manager/);
  assert.match(migration, /new\.starts_at is not distinct from old\.starts_at and not activates_booking/);
});
