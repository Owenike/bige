import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canChooseStaffEmployeeNumber,
  canUseStaffAccountSettings,
  canUseStaffNotificationCenter,
  canUseStaffScheduleNavigation,
  isEmployeeNumber,
  isStaffPlaceholderEmail,
  normalizeEmployeeNumber,
  staffPlaceholderEmail,
} from "../lib/staff-credentials";

test("employee numbers are normalized for login", () => {
  assert.equal(normalizeEmployeeNumber(" e000123 "), "E000123");
  assert.equal(normalizeEmployeeNumber("1"), "E000001");
  assert.equal(normalizeEmployeeNumber("01"), "E000001");
  assert.equal(normalizeEmployeeNumber("000001"), "E000001");
  assert.equal(normalizeEmployeeNumber(null), "");
});

test("employee number format is strict", () => {
  assert.equal(isEmployeeNumber("E000001"), true);
  assert.equal(isEmployeeNumber("e000001"), false);
  assert.equal(isEmployeeNumber("E123"), false);
  assert.equal(isEmployeeNumber("BE000001"), false);
});

test("only employee 01 can choose staff employee numbers", () => {
  assert.equal(canChooseStaffEmployeeNumber("01"), true);
  assert.equal(canChooseStaffEmployeeNumber("E000001"), true);
  assert.equal(canChooseStaffEmployeeNumber("02"), false);
  assert.equal(canChooseStaffEmployeeNumber("E000006"), false);
  assert.equal(canChooseStaffEmployeeNumber(null), false);
});

test("staff account settings are available to every numbered employee except 06", () => {
  assert.equal(canUseStaffAccountSettings("01"), true);
  assert.equal(canUseStaffAccountSettings("E000005"), true);
  assert.equal(canUseStaffAccountSettings("06"), false);
  assert.equal(canUseStaffAccountSettings("E000006"), false);
  assert.equal(canUseStaffAccountSettings(null), false);
});

test("notification center is available to every numbered employee except 06", () => {
  assert.equal(canUseStaffNotificationCenter("01"), true);
  assert.equal(canUseStaffNotificationCenter("E000005"), true);
  assert.equal(canUseStaffNotificationCenter("06"), false);
  assert.equal(canUseStaffNotificationCenter("E000006"), false);
  assert.equal(canUseStaffNotificationCenter(null), true);
});

test("staff schedule navigation is available to everyone except 06", () => {
  assert.equal(canUseStaffScheduleNavigation("01"), true);
  assert.equal(canUseStaffScheduleNavigation("E000005"), true);
  assert.equal(canUseStaffScheduleNavigation("06"), false);
  assert.equal(canUseStaffScheduleNavigation("E000006"), false);
  assert.equal(canUseStaffScheduleNavigation(null), true);
});

test("placeholder emails are deterministic and identifiable", () => {
  assert.equal(staffPlaceholderEmail("E000123"), "e000123@staff.bigefitness.invalid");
  assert.equal(isStaffPlaceholderEmail("e000123@staff.bigefitness.invalid"), true);
  assert.equal(isStaffPlaceholderEmail("staff@example.com"), false);
});

test("staff number migration repairs 13 and 14 and allocates from 15 while ignoring test 99", () => {
  const migration = readFileSync(
    "supabase/migrations/20260830161333_reconcile_staff_employee_numbers.sql",
    "utf8",
  );

  assert.match(
    migration,
    /30d43cb4-0ffc-488c-9d32-23f570af634f[\s\S]*employee_number = 'E000013'/,
  );
  assert.match(
    migration,
    /90d57ff1-e0af-4b84-ac83-77c770271ed1[\s\S]*employee_number = 'E000014'/,
  );
  assert.match(migration, /employee_number <> 'E000099'/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /pg_catalog\.setval/);
  assert.match(migration, /pg_catalog\.nextval/);
  assert.match(migration, /set search_path = ''/);
  assert.match(
    migration,
    /revoke all on function public\.next_staff_employee_number\(\) from authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.next_staff_employee_number\(\) to service_role/,
  );
  assert.match(
    migration,
    /grant update on sequence public\.staff_employee_number_seq to service_role/,
  );
});
