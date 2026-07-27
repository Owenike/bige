import assert from "node:assert/strict";
import test from "node:test";
import { mergeMembershipPeriodDrafts } from "../lib/student-membership-period";

test("uses saved database dates instead of a stale blank draft", () => {
  const result = mergeMembershipPeriodDrafts(
    { studentA: { startsOn: "", expiresOn: "" } },
    [{
      id: "studentA",
      membership_starts_on: "2026-07-01",
      membership_expires_on: "2026-12-31",
    }],
  );

  assert.deepEqual(result.studentA, {
    startsOn: "2026-07-01",
    expiresOn: "2026-12-31",
  });
});

test("keeps an unsaved draft while the database period is still empty", () => {
  const result = mergeMembershipPeriodDrafts(
    { studentA: { startsOn: "2026-08-01", expiresOn: "2026-12-31" } },
    [{
      id: "studentA",
      membership_starts_on: null,
      membership_expires_on: null,
    }],
  );

  assert.deepEqual(result.studentA, {
    startsOn: "2026-08-01",
    expiresOn: "2026-12-31",
  });
});

test("removes drafts for students no longer returned by the server", () => {
  const result = mergeMembershipPeriodDrafts(
    { removedStudent: { startsOn: "2026-08-01", expiresOn: "2026-12-31" } },
    [{
      id: "activeStudent",
      membership_starts_on: null,
      membership_expires_on: null,
    }],
  );

  assert.deepEqual(result, {
    activeStudent: { startsOn: "", expiresOn: "" },
  });
});
