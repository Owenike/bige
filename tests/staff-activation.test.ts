import assert from "node:assert/strict";
import test from "node:test";
import {
  STAFF_ACTIVATION_CODE_DIGITS,
  generateInternalStaffPassword,
  generateStaffActivationCode,
  isStaffActivationCode,
  isStaffActivationComplete,
  matchesStaffActivationCode,
  normalizeStaffActivationCode,
  staffActivationCodeHash,
  staffActivationExpiresAt,
} from "../lib/staff-activation";

test("activation codes are eight numeric digits", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateStaffActivationCode();
    assert.equal(code.length, STAFF_ACTIVATION_CODE_DIGITS);
    assert.equal(isStaffActivationCode(code), true);
  }
  assert.equal(isStaffActivationCode("1234567"), false);
  assert.equal(isStaffActivationCode("123456789"), false);
  assert.equal(normalizeStaffActivationCode(" 12-34 5678 "), "12345678");
});

test("activation hashes use the configured secret and compare safely", () => {
  const secret = "test-secret";
  const hash = staffActivationCodeHash("12345678", secret);
  assert.equal(matchesStaffActivationCode({ code: "12345678", expectedHash: hash, secret }), true);
  assert.equal(matchesStaffActivationCode({ code: "87654321", expectedHash: hash, secret }), false);
});

test("activation expiry is 24 hours and completion is explicit", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  assert.equal(staffActivationExpiresAt(now), "2026-07-29T00:00:00.000Z");
  assert.equal(isStaffActivationComplete("completed"), true);
  assert.equal(isStaffActivationComplete("identity_confirmed"), false);
});

test("internal auth passwords are random and not the legacy default", () => {
  const first = generateInternalStaffPassword();
  const second = generateInternalStaffPassword();
  assert.notEqual(first, second);
  assert.notEqual(first, "88888888");
  assert.ok(first.length >= 32);
});
