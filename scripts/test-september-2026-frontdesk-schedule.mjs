import assert from "node:assert/strict";
import {
  FRONTDESK_WORK_DAYS,
  IMPORT_SOURCE,
  buildFrontdeskChanges,
  expectedFrontdeskPlan,
} from "./sync-september-2026-frontdesk-schedule.mjs";

assert.equal(IMPORT_SOURCE, "september_2026_frontdesk_schedule");
assert.deepEqual(FRONTDESK_WORK_DAYS, {
  Annie: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11],
  Miffy: [1, 6, 8, 12, 15, 26, 27, 29],
});

const plan = expectedFrontdeskPlan();
assert.equal(plan.length, 16);
assert.deepEqual(
  plan.filter((item) => item.frontdeskName === "Annie/Miffy"),
  [
    { businessDate: "2026-09-01", frontdeskName: "Annie/Miffy" },
    { businessDate: "2026-09-08", frontdeskName: "Annie/Miffy" },
  ],
);
assert.deepEqual(
  plan.filter((item) => item.frontdeskName === "Annie").map((item) => Number(item.businessDate.slice(-2))),
  [2, 3, 4, 5, 7, 9, 10, 11],
);
assert.deepEqual(
  plan.filter((item) => item.frontdeskName === "Miffy").map((item) => Number(item.businessDate.slice(-2))),
  [6, 12, 15, 26, 27, 29],
);

const changes = buildFrontdeskChanges([
  {
    id: "existing-closed-day",
    business_date: "2026-09-05",
    frontdesk_name: null,
    is_closed: true,
    closure_label: "館休",
    source: "temporary_coach_leave_import",
  },
  {
    id: "already-correct",
    business_date: "2026-09-06",
    frontdesk_name: " Miffy ",
    is_closed: false,
    closure_label: null,
    source: "manual",
  },
]);
assert.equal(changes.length, 15);
assert.deepEqual(changes.find((item) => item.businessDate === "2026-09-05"), {
  kind: "update",
  businessDate: "2026-09-05",
  frontdeskName: "Annie",
  previousFrontdeskName: null,
  existingId: "existing-closed-day",
  preservedBusinessDay: {
    isClosed: true,
    closureLabel: "館休",
    source: "temporary_coach_leave_import",
  },
});
assert.equal(changes.some((item) => item.businessDate === "2026-09-06"), false);

console.log(JSON.stringify({ ok: true, assignedDateCount: plan.length }, null, 2));
