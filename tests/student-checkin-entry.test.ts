import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  isStudentCheckInEntryMode,
  sortStudentCheckInPendingQueue,
  studentCheckInAdminAlertScope,
  studentCheckInAdminDecisionRequest,
  studentCheckInEntryLabel,
  studentCheckInPath,
} from "../lib/student-checkin-entry";

test("the admin popup has a single owner while still covering both entry types", () => {
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins/login", 0, 1), "none");
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins", 1, 1), "none");
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins", 0, 1), "drop_in");
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins/drop-in", 1, 1), "none");
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins/drop-in", 1, 0), "autonomous");
  assert.equal(studentCheckInAdminAlertScope("/admin/student-check-ins/students", 1, 1), "all");
});

test("the main check-in pages never hide their approval dialog in CSS", () => {
  const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  assert.doesNotMatch(
    globalStyles,
    /\.studentCheckInsAdminScope\s*>\s*main\.studentCheckInsAdminPage\s*>\s*\.studentCheckInsApprovalBackdrop\s*\{[^}]*display:\s*none/i,
  );
});

test("every student check-in card uses the shared centered page layout", () => {
  const checkInPage = readFileSync(resolve(process.cwd(), "app/check-in/page.tsx"), "utf8");
  const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const auxiliaryPages = [
    "app/check-in/forgot-password/page.tsx",
    "app/check-in/verify/page.tsx",
    "app/check-in/security-setup/verify/page.tsx",
  ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

  assert.match(checkInPage, /<main className="studentCheckInPage">/);
  for (const page of auxiliaryPages) {
    assert.match(page, /<main className="studentCheckInPage">/);
  }
  assert.match(
    globalStyles,
    /\.studentCheckInPage\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center/i,
  );
  assert.doesNotMatch(globalStyles, /\.studentCheckInPage\s*\{[^}]*align-items:\s*start/i);
  assert.match(
    globalStyles,
    /\.studentCheckInPendingBackdrop\s*\{[^}]*place-items:\s*center/i,
  );
});

test("a rejected student entry returns to login without resubmitting", () => {
  const checkInPage = readFileSync(resolve(process.cwd(), "app/check-in/page.tsx"), "utf8");
  const rejectedView = checkInPage.slice(
    checkInPage.indexOf('{view === "rejected" ? ('),
    checkInPage.indexOf('{view === "expired" ? ('),
  );

  assert.match(rejectedView, /returnToLogin\(\)\}>返回登入/);
  assert.doesNotMatch(rejectedView, /returnToChoices|重新送出|activeMode === "drop_in"/);
});

test("student and NT$50 entries use separate URLs while retaining stable labels", () => {
  assert.equal(studentCheckInPath("autonomous"), "/check-in");
  assert.equal(studentCheckInPath("drop_in"), "/check-in/drop-in");
  assert.equal(studentCheckInEntryLabel("autonomous"), "學生自主訓練");
  assert.equal(studentCheckInEntryLabel("drop_in"), "50 元入場");
});

test("entry mode validation rejects arbitrary URL input", () => {
  assert.equal(isStudentCheckInEntryMode("autonomous"), true);
  assert.equal(isStudentCheckInEntryMode("drop_in"), true);
  assert.equal(isStudentCheckInEntryMode("student"), false);
  assert.equal(isStudentCheckInEntryMode(null), false);
});

test("the shared admin queue is chronological across both check-in types", () => {
  const queue = sortStudentCheckInPendingQueue([
    { id: "drop-later", mode: "drop_in" as const, requested_at: "2026-08-11T01:02:00.000Z" },
    { id: "student-first", mode: "autonomous" as const, requested_at: "2026-08-11T01:00:00.000Z" },
    { id: "drop-middle", mode: "drop_in" as const, requested_at: "2026-08-11T01:01:00.000Z" },
  ]);

  assert.deepEqual(queue.map((item) => item.id), ["student-first", "drop-middle", "drop-later"]);
});

test("shared admin alert sends each check-in type to the correct decision API", () => {
  assert.deepEqual(
    studentCheckInAdminDecisionRequest(
      "autonomous",
      "student-request",
      "approved",
      undefined,
      { lockerKeyTaken: false, lockerKeyNumber: null },
    ),
    {
      endpoint: "/api/admin/student-check-ins/student-request/decision",
      body: { decision: "approved", lockerKeyTaken: false, lockerKeyNumber: null },
    },
  );
  assert.deepEqual(
    studentCheckInAdminDecisionRequest(
      "drop_in",
      "drop-in-request",
      "approved",
      undefined,
      { lockerKeyTaken: true, lockerKeyNumber: 27 },
    ),
    {
      endpoint: "/api/admin/student-check-ins/drop-in/drop-in-request/decision",
      body: { decision: "approved", lockerKeyTaken: true, lockerKeyNumber: 27 },
    },
  );
  assert.deepEqual(
    studentCheckInAdminDecisionRequest("autonomous", "student-request", "rejected"),
    {
      endpoint: "/api/admin/student-check-ins/student-request/decision",
      body: { decision: "rejected" },
    },
  );
  assert.deepEqual(
    studentCheckInAdminDecisionRequest("drop_in", "drop-in-request", "rejected", "general"),
    {
      endpoint: "/api/admin/student-check-ins/drop-in/drop-in-request/decision",
      body: { decision: "rejected", rejectionAction: "general" },
    },
  );
  assert.deepEqual(
    studentCheckInAdminDecisionRequest("drop_in", "drop-in-request", "rejected", "data_correction"),
    {
      endpoint: "/api/admin/student-check-ins/drop-in/drop-in-request/decision",
      body: { decision: "rejected", rejectionAction: "data_correction" },
    },
  );
  assert.throws(
    () => studentCheckInAdminDecisionRequest("drop_in", "drop-in-request", "rejected"),
    /DROP_IN_REJECTION_ACTION_REQUIRED/,
  );
  assert.throws(
    () => studentCheckInAdminDecisionRequest("autonomous", "student-request", "approved"),
    /LOCKER_KEY_SELECTION_REQUIRED/,
  );
});

test("all three approval surfaces use one shared locker-key confirmation dialog", () => {
  const dialog = readFileSync(resolve(process.cwd(), "components/student-checkin-locker-key-dialog.tsx"), "utf8");
  const autonomousPage = readFileSync(resolve(process.cwd(), "app/admin/student-check-ins/page.tsx"), "utf8");
  const dropInPage = readFileSync(resolve(process.cwd(), "app/admin/student-check-ins/drop-in/page.tsx"), "utf8");
  const globalAlert = readFileSync(resolve(process.cwd(), "components/student-checkin-admin-pending-alert.tsx"), "utf8");

  assert.match(dialog, /是否有拿置物櫃鑰匙？/);
  assert.match(dialog, /拿幾號鑰匙？/);
  assert.match(dialog, /lockerKeyTaken === true[\s\S]*type="number"/);
  assert.match(dialog, /onConfirm\(\{ lockerKeyTaken: false, lockerKeyNumber: null \}\)/);
  assert.match(dialog, /type="submit"[\s\S]*是/);
  assert.doesNotMatch(dialog, />返回</);
  assert.doesNotMatch(dialog, /確認放行/);
  assert.equal((autonomousPage.match(/<StudentCheckInLockerKeyDialog/g) || []).length, 1);
  assert.equal((dropInPage.match(/<StudentCheckInLockerKeyDialog/g) || []).length, 1);
  assert.equal((globalAlert.match(/<StudentCheckInLockerKeyDialog/g) || []).length, 1);
  assert.match(autonomousPage, /activeRequest && lockerPromptRequestId !== activeRequest\.id/);
  assert.match(dropInPage, /activeRequest && lockerPromptRequestId !== activeRequest\.id/);
  assert.match(globalAlert, /if \(lockerPromptRequestId === activeRequest\.id\)/);
});

test("approval APIs and atomic database functions require and store the locker-key answer", () => {
  const autonomousRoute = readFileSync(resolve(process.cwd(), "app/api/admin/student-check-ins/[id]/decision/route.ts"), "utf8");
  const dropInRoute = readFileSync(resolve(process.cwd(), "app/api/admin/student-check-ins/drop-in/[id]/decision/route.ts"), "utf8");
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260818112816_add_locker_key_to_student_entries.sql"),
    "utf8",
  );

  for (const route of [autonomousRoute, dropInRoute]) {
    assert.match(route, /lockerKeyTaken: z\.literal\(false\)/);
    assert.match(route, /lockerKeyTaken: z\.literal\(true\)/);
    assert.match(route, /lockerKeyNumber: z\.number\(\)\.int\(\)\.min\(1\)\.max\(9999\)/);
  }
  assert.match(autonomousRoute, /decide_student_checkin_request_v2/);
  assert.match(dropInRoute, /decide_student_drop_in_request_v3/);
  assert.match(migration, /student_check_ins_locker_key_check/);
  assert.match(migration, /student_drop_ins_locker_key_check/);
  assert.equal((migration.match(/p_locker_key_taken/g) || []).length > 8, true);
  assert.equal((migration.match(/p_locker_key_number/g) || []).length > 8, true);
});
