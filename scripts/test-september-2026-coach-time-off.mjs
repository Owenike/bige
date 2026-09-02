import assert from "node:assert/strict";
import {
  BUSINESS_CLOSURE_DATE,
  IMPORT_PREFIX,
  IMPORT_SOURCE,
  SHIFT_IMPORT_PREFIX,
  SHIFT_IMPORT_SOURCE,
  SHIFT_MARKER_BY_COACH,
  TIME_OFF_DAYS_BY_COACH,
  buildShiftStatusRows,
  buildTimeOffRows,
  expectedShiftStatusPlan,
  expectedTimeOffPlan,
  selfSelectedPreferenceDates,
} from "./sync-september-2026-coach-time-off.mjs";

const expectedDays = {
  Becky: [7, 8, 9, 12, 13, 14, 20, 26, 27, 28, 29, 30],
  Wade: [1, 4, 6, 7, 14, 15, 21, 22, 27, 28],
  Wiwi: [6, 10, 15, 20, 23, 24, 29],
  Una: [2, 11, 12, 18, 19, 25, 26],
  Hailey: [6, 13, 14, 19, 20, 24, 29],
  Lily: [1, 2, 4, 9, 14, 16, 26, 27, 28],
  Bae: [1, 4, 8, 11, 15, 18, 22, 25, 26, 27, 28],
  Owen: [4, 6, 29, 30],
};

assert.deepEqual(TIME_OFF_DAYS_BY_COACH, expectedDays);
assert.deepEqual(SHIFT_MARKER_BY_COACH, {
  Becky: "晚",
  Wade: "晚",
  Wiwi: "晚",
  Una: "早",
  Hailey: "晚",
  Lily: "晚",
  Bae: "晚",
  Owen: "晚",
});
assert.equal(BUSINESS_CLOSURE_DATE, "2026-09-05");

const plan = expectedTimeOffPlan();
assert.equal(plan.length, 67);
assert.equal(new Set(plan.map((item) => item.importRowKey)).size, 67);
assert.equal(plan.every((item) => item.importRowKey.startsWith(`${IMPORT_PREFIX}:`)), true);
assert.equal(plan.some((item) => item.date === BUSINESS_CLOSURE_DATE), false);
assert.deepEqual(
  plan.filter((item) => item.coach === "Becky").map((item) => Number(item.date.slice(-2))),
  expectedDays.Becky,
);
assert.deepEqual(
  plan.filter((item) => item.coach === "Owen").map((item) => Number(item.date.slice(-2))),
  expectedDays.Owen,
);

const coaches = new Map(
  Object.keys(expectedDays).map((coach, index) => [
    coach.toLowerCase(),
    { id: `coach-${index + 1}`, branch_id: "branch-1" },
  ]),
);
const rows = buildTimeOffRows({ tenantId: "tenant-1", branchId: "branch-1", coaches });
assert.equal(rows.length, 67);
assert.equal(rows.every((row) => row.content === "休"), true);
assert.equal(rows.every((row) => row.source === IMPORT_SOURCE), true);
assert.equal(rows.every((row) => row.starts_at.endsWith("T00:00:00+08:00")), true);
assert.equal(rows.every((row) => row.ends_at.endsWith("T00:01:00+08:00")), true);
assert.equal(rows.every((row) => row.metadata.temporary === true), true);
assert.equal(rows.every((row) => row.metadata.removalKey === IMPORT_PREFIX), true);

const shiftPlan = expectedShiftStatusPlan();
assert.equal(shiftPlan.length, 165);
assert.equal(new Set(shiftPlan.map((item) => item.importRowKey)).size, 165);
assert.equal(shiftPlan.some((item) => item.date === BUSINESS_CLOSURE_DATE), false);
assert.equal(
  shiftPlan.some(
    (item) => TIME_OFF_DAYS_BY_COACH[item.coach].includes(Number(item.date.slice(-2))),
  ),
  false,
);
assert.equal(shiftPlan.filter((item) => item.marker === "早").length, 22);
assert.equal(shiftPlan.filter((item) => item.marker === "晚").length, 143);
assert.deepEqual(
  shiftPlan.filter((item) => item.coach === "Una").map((item) => item.marker),
  Array(22).fill("早"),
);

const shiftRows = buildShiftStatusRows({
  tenantId: "tenant-1",
  branchId: "branch-1",
  coaches,
});
assert.equal(shiftRows.length, 165);
assert.equal(shiftRows.every((row) => row.source === SHIFT_IMPORT_SOURCE), true);
assert.equal(
  shiftRows.every((row) => row.import_row_key.startsWith(`${SHIFT_IMPORT_PREFIX}:`)),
  true,
);
assert.equal(shiftRows.every((row) => row.content === "早" || row.content === "晚"), true);
assert.equal(shiftRows.every((row) => row.metadata.temporary === true), true);
assert.equal(
  shiftRows.every((row) => row.metadata.removalKey === SHIFT_IMPORT_PREFIX),
  true,
);

assert.deepEqual(
  selfSelectedPreferenceDates({
    staff_time_off_preference_dates: [
      { requested_date: "2026-09-30", source: "employee" },
      { requested_date: "2026-09-05", source: "facility_closure" },
      { requested_date: "2026-09-08", source: "employee" },
      { requested_date: "2026-09-13", source: "supervisor" },
    ],
  }),
  ["2026-09-08", "2026-09-30"],
);
assert.deepEqual(selfSelectedPreferenceDates(null), []);

console.log("September 2026 coach time-off plan tests passed");
