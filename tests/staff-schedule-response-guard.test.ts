import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  shouldApplyStaffScheduleResponse,
  staffScheduleMonthStart,
} from "../lib/staff-schedule-response-guard";

test("staff schedule accepts only the latest response for the active month", () => {
  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-09",
    activeMonth: "2026-09",
    requestRevision: 4,
    latestRequestRevision: 4,
    responseMonthStart: "2026-09-01",
  }), true);

  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-10",
    activeMonth: "2026-09",
    requestRevision: 3,
    latestRequestRevision: 4,
    responseMonthStart: "2026-10-01",
  }), false);

  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-09",
    activeMonth: "2026-09",
    requestRevision: 3,
    latestRequestRevision: 4,
    responseMonthStart: "2026-09-01",
  }), false);

  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-09",
    activeMonth: "2026-09",
    requestRevision: 4,
    latestRequestRevision: 4,
    responseMonthStart: "2026-10-01",
  }), false);
});

test("staff schedule compact patches remain valid only while their requested month is active", () => {
  assert.equal(staffScheduleMonthStart("2026-09"), "2026-09-01");
  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-09",
    activeMonth: "2026-09",
    requestRevision: 8,
    latestRequestRevision: 8,
  }), true);
  assert.equal(shouldApplyStaffScheduleResponse({
    requestedMonth: "2026-09",
    activeMonth: "2026-10",
    requestRevision: 8,
    latestRequestRevision: 8,
  }), false);
});

test("manager guards load, automatic sync, and manual schedule responses against stale months", () => {
  const source = readFileSync(resolve(process.cwd(), "components/staff-schedule-manager.tsx"), "utf8");
  const guardCalls = source.match(/canApplyScheduleResponse\(/g) || [];

  assert.match(source, /activeMonthRef\.current = nextMonth/);
  assert.match(source, /scheduleStateRequestRevisionRef\.current \+= 1/);
  assert.match(source, /loadAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /onChange=\{\(event\) => changeMonth\(event\.target\.value\)\}/);
  assert.ok(guardCalls.length >= 10, "all full-state and compact schedule responses should use the shared stale-response guard");
});
