import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidPreferenceDates,
  buildSelectionWindow,
  generateMonthlySchedule,
  listMonthDates,
  paidMinutesForEntry,
  validateSchedule,
  type EmployeeScheduleConfig,
} from "../lib/staff-scheduling";

const middleCoach: EmployeeScheduleConfig = {
  employeeId: "coach-1",
  displayName: "測試教練",
  employmentType: "full_time",
  workGroup: "coach",
  defaultShiftCode: "COACH_MIDDLE",
  isOriginalEarlyShift: false,
  canCoverEarlyShift: false,
  countsTowardMiddleLimit: true,
};

test("next-month preference window is open from the 1st through the 20th 23:59 Taiwan time", () => {
  assert.deepEqual(buildSelectionWindow("2026-10-01"), {
    opensAt: "2026-09-01T00:00:00+08:00",
    closesAt: "2026-09-20T23:59:59+08:00",
  });
});

test("facility closure counts toward the required eight preferred days", () => {
  const dates = assertValidPreferenceDates({
    monthStart: "2026-10-01",
    selectedDates: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
    facilityClosureDates: ["2026-10-01"],
  });
  assert.equal(dates.length, 8);
  assert.throws(
    () => assertValidPreferenceDates({ monthStart: "2026-10-01", selectedDates: dates.slice(0, 7) }),
    /必須選滿 8 天/,
  );
});

test("monthly generator gives complete weeks one regular day off and one rest day", () => {
  const entries = generateMonthlySchedule({
    monthStart: "2026-10-01",
    employees: [middleCoach],
    preferencesByEmployee: {
      "coach-1": ["2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"],
    },
  });
  assert.equal(entries.length, listMonthDates("2026-10-01").length);
  const validation = validateSchedule({ monthStart: "2026-10-01", employees: [middleCoach], entries });
  const fullWeekResults = validation.filter((item) => item.ruleCode === "WEEKLY_REGULAR_AND_REST_DAY");
  assert.ok(fullWeekResults.length > 0);
  assert.ok(fullWeekResults.every((item) => item.passed));
});

test("front desk paid break keeps all seven scheduled hours payable", () => {
  assert.equal(
    paidMinutesForEntry({
      entryKind: "work",
      startsAt: "09:30",
      endsAt: "16:30",
      breakMinutes: 30,
      paidBreak: true,
    }),
    420,
  );
});

test("weekend part-time coach uses 13:00-22:00 and counts as middle staffing", () => {
  const employee: EmployeeScheduleConfig = {
    ...middleCoach,
    employeeId: "part-time",
    employmentType: "part_time",
  };
  const entries = generateMonthlySchedule({
    monthStart: "2026-08-01",
    employees: [employee],
    preferencesByEmployee: { "part-time": [] },
  });
  const saturday = entries.find((entry) => entry.workDate === "2026-08-01");
  assert.equal(saturday?.shiftCode, "COACH_PARTTIME_WEEKEND");
  assert.equal(saturday?.startsAt, "13:00");
  assert.equal(saturday?.endsAt, "22:00");
  assert.equal(saturday?.paidBreak, true);
  assert.equal(saturday?.countsTowardMiddleLimit, true);
});

test("cross-month context blocks a seventh consecutive work day", () => {
  const target = generateMonthlySchedule({ monthStart: "2026-11-01", employees: [middleCoach], preferencesByEmployee: { "coach-1": [] } });
  const contextEntries = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].map((workDate) => ({ ...target[0], workDate, entryKind: "work" as const, offKind: null, startsAt: "13:00", endsAt: "22:00", breakMinutes: 60 }));
  const validation = validateSchedule({ monthStart: "2026-11-01", employees: [middleCoach], entries: target, contextEntries });
  assert.ok(validation.some((item) => item.ruleCode === "MAX_SIX_CONSECUTIVE_WORK_DAYS" && !item.passed && item.workDate === "2026-11-01"));
});

test("daily and weekly legal work-hour checks are blocking", () => {
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
  const entries = dates.map((workDate, index) => ({
    employeeId: middleCoach.employeeId,
    workDate,
    entryKind: index === 6 ? "off" as const : "work" as const,
    shiftCode: index === 6 ? null : "CUSTOM",
    shiftLabel: index === 6 ? null : "測試班",
    startsAt: index === 6 ? null : "10:00",
    endsAt: index === 6 ? null : "19:00",
    breakMinutes: index === 0 ? 0 : index === 6 ? 0 : 60,
    paidBreak: false,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: false,
    offKind: index === 6 ? "rest_day" as const : null,
    source: "supervisor" as const,
  }));
  const validation = validateSchedule({ monthStart: "2026-08-01", employees: [middleCoach], entries });
  assert.ok(validation.some((item) => item.ruleCode === "CONTINUOUS_WORK_BREAK_REQUIRED" && !item.passed));
  assert.ok(validation.some((item) => item.ruleCode === "DAILY_NORMAL_HOURS_EXCEEDED" && !item.passed));
  assert.ok(validation.some((item) => item.ruleCode === "WEEKLY_NORMAL_HOURS" && !item.passed));
});
