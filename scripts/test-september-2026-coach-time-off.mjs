import assert from "node:assert/strict";
import {
  BUSINESS_CLOSURE_DATE,
  IMPORT_PREFIX,
  IMPORT_SOURCE,
  TIME_OFF_DAYS_BY_COACH,
  buildTimeOffRows,
  expectedTimeOffPlan,
} from "./sync-september-2026-coach-time-off.mjs";

const expectedDays = {
  Wade: [1, 4, 6, 7, 14, 15, 21, 22, 27, 28],
  Wiwi: [6, 10, 15, 20, 23, 24, 29],
  Una: [2, 11, 12, 18, 19, 25, 26],
  Hailey: [6, 13, 14, 19, 20, 24, 29],
  Lily: [1, 2, 4, 9, 14, 16, 26, 27, 28],
  Bae: [1, 4, 8, 11, 15, 18, 22, 25, 26, 27, 28],
};

assert.deepEqual(TIME_OFF_DAYS_BY_COACH, expectedDays);
assert.equal(BUSINESS_CLOSURE_DATE, "2026-09-05");

const plan = expectedTimeOffPlan();
assert.equal(plan.length, 51);
assert.equal(new Set(plan.map((item) => item.importRowKey)).size, 51);
assert.equal(plan.every((item) => item.importRowKey.startsWith(`${IMPORT_PREFIX}:`)), true);
assert.equal(plan.some((item) => item.date === BUSINESS_CLOSURE_DATE), false);

const coaches = new Map(
  Object.keys(expectedDays).map((coach, index) => [
    coach.toLowerCase(),
    { id: `coach-${index + 1}`, branch_id: "branch-1" },
  ]),
);
const rows = buildTimeOffRows({ tenantId: "tenant-1", branchId: "branch-1", coaches });
assert.equal(rows.length, 51);
assert.equal(rows.every((row) => row.content === "休"), true);
assert.equal(rows.every((row) => row.source === IMPORT_SOURCE), true);
assert.equal(rows.every((row) => row.starts_at.endsWith("T00:00:00+08:00")), true);
assert.equal(rows.every((row) => row.ends_at.endsWith("T00:01:00+08:00")), true);
assert.equal(rows.every((row) => row.metadata.temporary === true), true);
assert.equal(rows.every((row) => row.metadata.removalKey === IMPORT_PREFIX), true);

console.log("September 2026 coach time-off plan tests passed");
