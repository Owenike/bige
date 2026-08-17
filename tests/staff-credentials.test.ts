import assert from "node:assert/strict";
import test from "node:test";
import {
  canChooseStaffEmployeeNumber,
  canUseStaffAccountSettings,
  canUseStaffNotificationCenter,
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

test("placeholder emails are deterministic and identifiable", () => {
  assert.equal(staffPlaceholderEmail("E000123"), "e000123@staff.bigefitness.invalid");
  assert.equal(isStaffPlaceholderEmail("e000123@staff.bigefitness.invalid"), true);
  assert.equal(isStaffPlaceholderEmail("staff@example.com"), false);
});
