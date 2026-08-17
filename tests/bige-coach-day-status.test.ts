import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCoachDayStatuses,
  readCoachShiftRangeStatus,
} from "../lib/bige-coach-day-status";

test("a working shift range wins over trailing off-cell markers", () => {
  const statuses = collectCoachDayStatuses(
    [
      { coach_id: "una", content: "休" },
      { coach_id: "una", content: "10:00-19:00" },
    ],
    new Set(["una"]),
  );

  assert.deepEqual(statuses, [
    { coach_id: "una", status: "early", label: "早班" },
  ]);
});

test("BIG E Wednesday 12:00-21:00 remains an early shift", () => {
  assert.equal(readCoachShiftRangeStatus("12:00-21:00"), "early");
});

test("real late and off markers keep their explicit statuses", () => {
  const statuses = collectCoachDayStatuses(
    [
      { coach_id: "lily", content: "晚" },
      { coach_id: "bae", content: "休" },
    ],
    new Set(["lily", "bae"]),
  );

  assert.deepEqual(statuses, [
    { coach_id: "lily", status: "late", label: "晚班" },
    { coach_id: "bae", status: "off", label: "休假" },
  ]);
});
