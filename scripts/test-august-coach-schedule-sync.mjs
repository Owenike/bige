import assert from "node:assert/strict";
import test from "node:test";
import {
  countBusinessDayChanges,
  filterAugustPlanFromDate,
  hasMaterialSyncChanges,
  hasSpreadsheetImportKey,
} from "./sync-august-coach-schedule.mjs";

test("filters August sync data and member candidates from the requested date", () => {
  const plan = {
    schedules: [
      { date: "2026-08-19", memberKey: "past" },
      { date: "2026-08-20", memberKey: "today" },
      { date: "2026-08-31", memberKey: "future" },
    ],
    notes: [
      { date: "2026-08-19" },
      { date: "2026-08-20" },
    ],
    businessDays: [
      { date: "2026-08-09" },
      { date: "2026-08-22" },
    ],
    members: [
      { memberKey: "past" },
      { memberKey: "today" },
      { memberKey: "future" },
      { memberKey: "unused" },
    ],
    closureConflicts: [
      { date: "2026-08-09" },
      { date: "2026-08-20" },
    ],
  };

  const filtered = filterAugustPlanFromDate(plan, "2026-08-20");

  assert.deepEqual(filtered.schedules.map((row) => row.memberKey), ["today", "future"]);
  assert.deepEqual(filtered.notes.map((row) => row.date), ["2026-08-20"]);
  assert.deepEqual(filtered.businessDays.map((row) => row.date), ["2026-08-22"]);
  assert.deepEqual(filtered.members.map((row) => row.memberKey), ["today", "future"]);
  assert.deepEqual(filtered.closureConflicts.map((row) => row.date), ["2026-08-20"]);
});

test("only spreadsheet-linked rows are eligible for automated removal", () => {
  assert.equal(hasSpreadsheetImportKey({ import_row_key: "booking:2026-08-20:20:00:Becky:PT:Test" }), true);
  assert.equal(hasSpreadsheetImportKey({ import_row_key: null }), false);
  assert.equal(hasSpreadsheetImportKey({}), false);
  assert.equal(hasSpreadsheetImportKey(null), false);
});

test("detects business-day changes and skips identical reconciliations", () => {
  const desired = [
    { date: "2026-08-20", isClosed: false, closureLabel: "", frontdeskName: "Amy" },
    { date: "2026-08-21", isClosed: true, closureLabel: "休館", frontdeskName: "" },
  ];
  const current = [
    { business_date: "2026-08-20", is_closed: false, closure_label: null, frontdesk_name: " Amy " },
    { business_date: "2026-08-21", is_closed: false, closure_label: null, frontdesk_name: null },
  ];
  assert.equal(countBusinessDayChanges(desired, current), 1);

  const noChanges = {
    insertBookings: 0,
    cancelBookings: 0,
    releaseHistoricalKeys: 0,
    updateBookings: 0,
    insertNotes: 0,
    deleteNotes: 0,
    updateNotes: 0,
    businessDayChanges: 0,
  };
  assert.equal(hasMaterialSyncChanges(noChanges, { create: 0, promote: 0 }), false);
  assert.equal(hasMaterialSyncChanges({ ...noChanges, businessDayChanges: 1 }, { create: 0, promote: 0 }), true);
  assert.equal(hasMaterialSyncChanges(noChanges, { create: 1, promote: 0 }), true);
});
