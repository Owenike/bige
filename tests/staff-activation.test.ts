import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

test("sending a password reset email does not immediately force a password change", () => {
  const routeSource = readFileSync(
    resolve(process.cwd(), "app/api/manager/staff/reset-password/route.ts"),
    "utf8",
  );

  assert.match(routeSource, /resetPasswordForEmail/);
  assert.doesNotMatch(routeSource, /must_change_password\s*:\s*true/);
  assert.doesNotMatch(routeSource, /password_reset_required_at\s*:/);
});

test("completed staff cannot remain on the password setup page without a recovery flow", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "app/staff/change-password/page.tsx"),
    "utf8",
  );

  assert.match(pageSource, /mePayload\.staffActivationStatus === "completed"/);
  assert.match(pageSource, /!mePayload\.mustChangePassword/);
  assert.match(pageSource, /!isRecoveryFlow/);
  assert.match(pageSource, /window\.location\.replace\(roleHome\(mePayload\.role\)\)/);
});

test("staff password setup consistently accepts passwords of at least six characters", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "app/staff/change-password/page.tsx"),
    "utf8",
  );

  assert.match(pageSource, /const STAFF_PASSWORD_MIN_LENGTH = 6/);
  assert.match(pageSource, /password\.length >= STAFF_PASSWORD_MIN_LENGTH/);
  assert.equal((pageSource.match(/minLength=\{STAFF_PASSWORD_MIN_LENGTH\}/g) || []).length, 2);
  assert.doesNotMatch(pageSource, /password\.length >= 10/);
  assert.doesNotMatch(pageSource, /minLength=\{10\}/);
});

test("staff recovery binds password updates to the captured bearer identity", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "app/staff/change-password/page.tsx"),
    "utf8",
  );
  const routeSource = readFileSync(
    resolve(process.cwd(), "app/api/auth/staff-password/route.ts"),
    "utf8",
  );

  assert.match(pageSource, /resolvedAccessToken = result\.data\.session\?\.access_token/);
  assert.match(pageSource, /Authorization: `Bearer \$\{authAccessToken\}`/);
  assert.doesNotMatch(pageSource, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(routeSource, /updateUserById\(auth\.context\.userId/);
  assert.match(routeSource, /password,/);
});

test("student check-in admin authorization is capability-only", () => {
  const authSource = readFileSync(
    resolve(process.cwd(), "lib/student-checkin-admin-auth.ts"),
    "utf8",
  );
  const proxySource = readFileSync(resolve(process.cwd(), "proxy.ts"), "utf8");

  assert.match(authSource, /hasAuthCapability\(user\.app_metadata, "student_checkin_admin"\)/);
  assert.match(authSource, /supabase\.auth\.getUser\(bearerToken\)/);
  assert.doesNotMatch(authSource, /STUDENT_CHECKIN_ADMIN_EMAILS/);
  assert.doesNotMatch(authSource, /STUDENT_CHECKIN_ADMIN_ROLES/);
  assert.doesNotMatch(proxySource, /configuredStudentCheckinAdminEmails/);
  assert.match(
    proxySource,
    /if \(scope === "student_checkin_admin"\) \{\s*return isStudentCheckinAdmin \|\| roleSet\.has\("student_checkin_admin"\);\s*\}/,
  );
});

test("generic recovery uses the captured bearer token instead of shared browser session state", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "app/reset-password/page.tsx"), "utf8");
  const routeSource = readFileSync(
    resolve(process.cwd(), "app/api/auth/recovery-password/route.ts"),
    "utf8",
  );

  assert.match(pageSource, /Authorization": `Bearer \$\{recoveryAccessToken\}`/);
  assert.doesNotMatch(pageSource, /client\.auth\.updateUser\(\{ password \}\)/);
  assert.match(routeSource, /getUser\(token\)/);
  assert.match(routeSource, /updateUserById\(user\.id/);
});
