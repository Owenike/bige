import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_DROP_IN_RECENT_DECISION_WINDOW_MS,
  shouldReuseStudentDropInRequest,
} from "../lib/student-drop-in-request-recency";

const nowMs = Date.parse("2026-08-21T07:30:00.000Z");

test("pending drop-in requests stay visible while staff review is delayed", () => {
  assert.equal(shouldReuseStudentDropInRequest({
    status: "pending",
    requested_at: "2026-08-21T05:30:00.000Z",
    reviewed_at: null,
  }, nowMs), true);
});

test("approved drop-in recency starts at the decision instead of the request", () => {
  assert.equal(shouldReuseStudentDropInRequest({
    status: "approved",
    requested_at: "2026-08-21T06:32:04.000Z",
    reviewed_at: "2026-08-21T07:17:19.000Z",
  }, nowMs), true);
});

test("processed drop-in requests expire thirty minutes after the decision", () => {
  const expiredDecisionAt = new Date(nowMs - STUDENT_DROP_IN_RECENT_DECISION_WINDOW_MS - 1).toISOString();
  assert.equal(shouldReuseStudentDropInRequest({
    status: "rejected",
    requested_at: "2026-08-21T05:30:00.000Z",
    reviewed_at: expiredDecisionAt,
  }, nowMs), false);
});
