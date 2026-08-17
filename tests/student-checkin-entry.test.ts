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
});
