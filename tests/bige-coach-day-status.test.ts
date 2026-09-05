import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectCoachDayStatuses,
  collectStaffScheduleCoachDayStatuses,
  mergeCoachDayStatuses,
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

test("the temporary September time-off import never assigns blanket shift markers", () => {
  const importer = readFileSync("scripts/sync-september-2026-coach-time-off.mjs", "utf8");

  assert.doesNotMatch(importer, /temporary_coach_shift_import/);
  assert.doesNotMatch(importer, /SHIFT_MARKER_BY_COACH/);
});

test("daily board only supplements explicit early shifts from the latest draft staff schedule", () => {
  const statuses = collectStaffScheduleCoachDayStatuses(
    [
      { employee_id: "una", entry_kind: "work", shift_code: "COACH_MIDDLE", version_id: "draft-1", version_status: "draft", version_number: 1 },
      { employee_id: "una", entry_kind: "work", shift_code: "COACH_EARLY_WED", version_id: "draft-2", version_status: "manager_review", version_number: 2 },
      { employee_id: "lily", entry_kind: "work", shift_code: "COACH_MIDDLE", version_id: "draft-2", version_status: "manager_review", version_number: 2 },
      { employee_id: "bae", entry_kind: "work", shift_code: "COACH_PARTTIME_WEEKEND", version_id: "draft-2", version_status: "manager_review", version_number: 2 },
      { employee_id: "lulu", entry_kind: "off", shift_code: null, version_id: "draft-2", version_status: "manager_review", version_number: 2 },
    ],
    new Set(["una", "lily", "bae", "lulu"]),
  );

  assert.deepEqual(statuses, [
    { coach_id: "una", status: "early", label: "早班" },
  ]);
});

test("staff schedule times never infer late status for non-early coach shifts", () => {
  const statuses = collectStaffScheduleCoachDayStatuses(
    [
      { employee_id: "wade", entry_kind: "work", shift_code: null, starts_at: "14:00", ends_at: "23:00", version_id: "draft-1", version_status: "draft", version_number: 1 },
    ],
    new Set(["wade"]),
  );

  assert.deepEqual(statuses, []);
});

test("published staff schedule remains authoritative over a newer draft", () => {
  const statuses = collectStaffScheduleCoachDayStatuses(
    [
      { employee_id: "una", entry_kind: "work", shift_code: "COACH_EARLY", version_id: "published-1", version_status: "published", version_number: 1 },
      { employee_id: "una", entry_kind: "off", shift_code: null, version_id: "draft-2", version_status: "draft", version_number: 2 },
    ],
    new Set(["una"]),
  );

  assert.deepEqual(statuses, [
    { coach_id: "una", status: "early", label: "早班" },
  ]);
});

test("daily-board notes override the staff schedule status for the same coach", () => {
  const scheduleStatuses = collectStaffScheduleCoachDayStatuses(
    [
      { employee_id: "una", entry_kind: "work", shift_code: "COACH_EARLY", version_id: "draft-1", version_status: "draft", version_number: 1 },
    ],
    new Set(["una"]),
  );
  const noteStatuses = collectCoachDayStatuses(
    [{ coach_id: "una", content: "休" }],
    new Set(["una"]),
  );

  assert.deepEqual(mergeCoachDayStatuses(scheduleStatuses, noteStatuses), [
    { coach_id: "una", status: "off", label: "休假" },
  ]);
});

test("daily-board API loads staff schedule entries without serializing the board reads", () => {
  const route = readFileSync("app/api/bige-fitness/route.ts", "utf8");

  assert.match(route, /\.from\("staff_schedule_entries"\)/);
  assert.match(route, /staff_schedule_versions!inner\(status, version_number\)/);
  assert.match(route, /Promise\.all\(\[\s*bookingsQuery,\s*notesQuery,\s*staffScheduleEntriesQuery,/);
  assert.match(route, /mergeCoachDayStatuses\([\s\S]*collectStaffScheduleCoachDayStatuses\([\s\S]*collectCoachDayStatuses\(/);
});
