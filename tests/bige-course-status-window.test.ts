import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelBigeCourseAnytime,
  getBigeCourseStatusWindow,
  isBigeCourseStatusWindowExempt,
} from "../lib/bige-course-status-window";

test("course completion window remains limited to 30 minutes before and after", () => {
  const startsAt = "2026-08-06T08:00:00.000Z";
  const endsAt = "2026-08-06T09:00:00.000Z";

  assert.equal(
    getBigeCourseStatusWindow({
      startsAt,
      endsAt,
      now: new Date("2026-08-06T07:29:59.000Z").getTime(),
    }).allowed,
    false,
  );
  assert.equal(
    getBigeCourseStatusWindow({
      startsAt,
      endsAt,
      now: new Date("2026-08-06T09:30:00.000Z").getTime(),
    }).allowed,
    true,
  );
});

test("frontdesk 06 may cancel at any time without gaining completion exemption", () => {
  const identity = {
    role: "frontdesk",
    employeeNumber: "06",
  };

  assert.equal(canCancelBigeCourseAnytime(identity), true);
  assert.equal(isBigeCourseStatusWindowExempt(identity), false);
});

test("manager and assistant-manager completion is not time limited", () => {
  assert.equal(isBigeCourseStatusWindowExempt({ role: "manager" }), true);
  assert.equal(
    isBigeCourseStatusWindowExempt({
      role: "supervisor",
      position: "coach_assistant_manager",
    }),
    true,
  );
  assert.equal(
    isBigeCourseStatusWindowExempt({
      role: "manager",
      position: "coach_manager",
    }),
    true,
  );
});

test("manager and supervisor cancellation is not time limited", () => {
  assert.equal(canCancelBigeCourseAnytime({ role: "manager" }), true);
  assert.equal(canCancelBigeCourseAnytime({ role: "supervisor" }), true);
  assert.equal(
    canCancelBigeCourseAnytime({ position: "coach_assistant_manager" }),
    true,
  );
});

test("ordinary staff remain subject to the cancellation window", () => {
  assert.equal(
    canCancelBigeCourseAnytime({ role: "frontdesk", employeeNumber: "E000007" }),
    false,
  );
  assert.equal(canCancelBigeCourseAnytime({ role: "coach" }), false);
  assert.equal(isBigeCourseStatusWindowExempt({ role: "supervisor" }), false);
  assert.equal(
    isBigeCourseStatusWindowExempt({
      role: "coach",
      position: "coach_team_lead",
    }),
    false,
  );
});
