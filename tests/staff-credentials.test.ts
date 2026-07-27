import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_STAFF_PASSWORD,
  isEmployeeNumber,
  isStaffPlaceholderEmail,
  normalizeEmployeeNumber,
  staffPlaceholderEmail,
} from "../lib/staff-credentials";

test("employee numbers are normalized for login", () => {
  assert.equal(normalizeEmployeeNumber(" e000123 "), "E000123");
  assert.equal(normalizeEmployeeNumber(null), "");
});

test("employee number format is strict", () => {
  assert.equal(isEmployeeNumber("E000001"), true);
  assert.equal(isEmployeeNumber("e000001"), false);
  assert.equal(isEmployeeNumber("E123"), false);
  assert.equal(isEmployeeNumber("BE000001"), false);
});

test("initial staff password stays fixed", () => {
  assert.equal(INITIAL_STAFF_PASSWORD, "88888888");
});

test("placeholder emails are deterministic and identifiable", () => {
  assert.equal(staffPlaceholderEmail("E000123"), "e000123@staff.bigefitness.invalid");
  assert.equal(isStaffPlaceholderEmail("e000123@staff.bigefitness.invalid"), true);
  assert.equal(isStaffPlaceholderEmail("staff@example.com"), false);
});
