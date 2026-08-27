import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertValidPreferenceDates,
  buildSelectionWindow,
  generateMonthlySchedule,
  listMonthDates,
  monthlyAccruedLeaveCreditDays,
  monthlyDaysOffEntitlement,
  paidMinutesForEntry,
  normalizeStaffScheduleView,
  resolveStaffScheduleDataScope,
  staffScheduleEntryOffLabel,
  staffScheduleGridWorkLabel,
  staffScheduleOffLabel,
  staffScheduleShiftLabel,
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
    selectedDates: ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-12", "2026-10-13", "2026-10-19", "2026-10-20"],
    facilityClosureDates: ["2026-10-03"],
  });
  assert.equal(dates.length, 8);
  assert.throws(
    () => assertValidPreferenceDates({ monthStart: "2026-10-01", selectedDates: dates.slice(0, 7) }),
    /必須選滿 8 天/,
  );
});

test("monthly Saturday and Sunday days beyond eight become accrued leave", () => {
  assert.equal(monthlyDaysOffEntitlement("2026-09-01"), 8);
  assert.equal(monthlyAccruedLeaveCreditDays("2026-09-01"), 0);
  assert.equal(monthlyDaysOffEntitlement("2026-10-01"), 9);
  assert.equal(monthlyAccruedLeaveCreditDays("2026-10-01"), 1);
  assert.equal(monthlyDaysOffEntitlement("2026-08-01"), 10);
  assert.equal(monthlyAccruedLeaveCreditDays("2026-08-01"), 2);
});

test("eight selected days must cover every complete Monday-Sunday week", () => {
  assert.throws(
    () => assertValidPreferenceDates({
      monthStart: "2026-10-01",
      selectedDates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
    }),
    /這一週至少要選 2 天/,
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
  assert.equal(entries.filter((entry) => entry.entryKind === "off").length, 8);
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

test("manager self-service receives only the manager's published schedule", () => {
  const scope = resolveStaffScheduleDataScope({
    view: normalizeStaffScheduleView("self"),
    canViewTeam: true,
    actorId: "manager-1",
    allEmployeeIds: ["manager-1", "coach-1", "coach-2"],
  });

  assert.deepEqual(scope, {
    teamView: false,
    employeeIds: ["manager-1"],
    publishedOnly: true,
  });
});

test("team schedule remains available only to authorized managers", () => {
  assert.deepEqual(
    resolveStaffScheduleDataScope({
      view: normalizeStaffScheduleView("team"),
      canViewTeam: true,
      actorId: "manager-1",
      allEmployeeIds: ["manager-1", "coach-1"],
    }),
    {
      teamView: true,
      employeeIds: ["manager-1", "coach-1"],
      publishedOnly: false,
    },
  );
  assert.throws(
    () => resolveStaffScheduleDataScope({
      view: normalizeStaffScheduleView("team"),
      canViewTeam: false,
      actorId: "coach-1",
      allEmployeeIds: ["coach-1", "coach-2"],
    }),
    /沒有查看全員班表的權限/,
  );
});

test("unspecified or invalid schedule views default to least-privilege self view", () => {
  assert.equal(normalizeStaffScheduleView(undefined), "self");
  assert.equal(normalizeStaffScheduleView("unexpected"), "self");
});

test("schedule display uses only the agreed plain-language shift and off labels", () => {
  assert.equal(staffScheduleShiftLabel({ shiftCode: "FRONTDESK_DAY", shiftLabel: "櫃台班", startsAt: "09:30" }), "早班");
  assert.equal(staffScheduleShiftLabel({ shiftCode: "COACH_EARLY_WED", shiftLabel: "週三早班", startsAt: "12:00" }), "早班");
  assert.equal(staffScheduleShiftLabel({ shiftCode: "COACH_PARTTIME_WEEKEND", shiftLabel: "兼職假日班", startsAt: "13:00" }), "中班");
  assert.equal(staffScheduleShiftLabel({ shiftCode: "COACH_PARTTIME_WEEKDAY", shiftLabel: "兼職晚班", startsAt: "18:00" }), "晚班");
  assert.equal(staffScheduleOffLabel("regular_day_off"), "例假");
  assert.equal(staffScheduleOffLabel("rest_day"), "休假");
  assert.equal(staffScheduleOffLabel("preferred_off"), "休假");
  assert.equal(staffScheduleOffLabel("facility_closure"), "館休");
  assert.equal(staffScheduleOffLabel("holiday_adjustment"), "國休");
  assert.equal(staffScheduleOffLabel("national_holiday"), "國休");
  assert.equal(staffScheduleEntryOffLabel({ offKind: "regular_day_off", source: "facility_closure" }), "館休");
  assert.equal(
    staffScheduleGridWorkLabel({ shiftCode: "COACH_EARLY_WED", startsAt: "12:00", endsAt: "21:00" }, "E000012", "2026-09-02"),
    "12:00–21:00",
  );
  assert.equal(
    staffScheduleGridWorkLabel({ shiftCode: "COACH_EARLY", startsAt: "10:00", endsAt: "19:00" }, "E000012", "2026-09-03"),
    "早班",
  );
});

test("manager cleanup preserves drag-and-drop and both holiday decisions", () => {
  const source = readFileSync(resolve(process.cwd(), "components/staff-schedule-manager.tsx"), "utf8");
  const selfSource = readFileSync(resolve(process.cwd(), "components/staff-schedule-self-service.tsx"), "utf8");
  const printSource = readFileSync(resolve(process.cwd(), "components/staff-schedule-print.tsx"), "utf8");
  const apiSource = readFileSync(resolve(process.cwd(), "app/api/staff-scheduling/route.ts"), "utf8");
  const exportSource = readFileSync(resolve(process.cwd(), "app/api/staff-scheduling/export/route.ts"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "app/manager/staff-scheduling/page.module.css"), "utf8");
  const printStyles = readFileSync(resolve(process.cwd(), "app/manager/staff-scheduling/print/page.module.css"), "utf8");
  const selfStyles = readFileSync(resolve(process.cwd(), "app/staff/schedule/page.module.css"), "utf8");
  const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826223530_add_staff_leave_balances_and_una_shift.sql"), "utf8");
  const unaDraftMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826224221_align_una_existing_draft_shift.sql"), "utf8");
  const creditMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260827000727_add_monthly_accrued_leave_credits.sql"), "utf8");
  assert.match(source, /holidayRuleGroups\.map/);
  assert.match(source, /window\.setTimeout\(\(\) => setNotice\(""\), 4500\)/);
  assert.match(source, /const SCHEDULE_LOAD_TIMEOUT_MS = 20_000/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), SCHEDULE_LOAD_TIMEOUT_MS\)/);
  assert.match(source, /重新讀取班表/);
  assert.match(source, /if \(!data\) \{/);
  assert.match(styles, /\.loadFailure\{/);
  assert.match(source, /onDrop=\{\(event\) => void dropOn/);
  assert.match(source, /"make_holiday_day_off"/);
  assert.match(source, /"arrange_holiday_adjustment"/);
  assert.doesNotMatch(source, /employee\.employment\?\.default_shift_code \|\| "未設定"/);
  assert.doesNotMatch(source, /`固定：\$\{staffScheduleShiftLabel/);
  assert.match(source, /employee\.englishName \|\| "未設定英文名"/);
  assert.match(apiSource, /englishName: employee\.english_name/);
  assert.match(styles, /\.scheduleTable\{font-size:14px\}/);
  assert.match(styles, /\.workCell small\{color:#66778e;font-size:12px\}/);
  assert.match(styles, /\.nameCell small\{margin-top:4px;color:#65758a;font-size:13px\}/);
  assert.match(source, /員工自選休假日期/);
  assert.match(source, /此草稿仍含舊規則補排的例假或休假/);
  assert.doesNotMatch(source, />恢復固定班<\/b>/);
  assert.match(source, /shiftDragStart\(event, "COACH_EARLY"\)[\s\S]*shiftDragStart\(event, "COACH_MIDDLE"\)[\s\S]*shiftDragStart\(event, "COACH_PARTTIME_WEEKDAY"\)/);
  assert.match(source, /setData\(\(current\) => applyShiftPreview\(current, employeeId, workDate, shiftCode\)\)/);
  assert.match(source, /班別已套用，正在儲存並檢查規則/);
  assert.match(apiSource, /compactMutation = \{/);
  assert.match(apiSource, /if \(compactMutation\) \{[\s\S]*return apiSuccess\(compactMutation\)/);
  assert.match(source, /staffScheduleGridWorkLabel\(entry, employee\.employeeNumber, date\)/);
  assert.doesNotMatch(source, /<small>\{entry\.startsAt\}–\{entry\.endsAt\}<\/small>/);
  assert.match(source, /特休\{formatDays\(employee\.employment\?\.annual_leave_balance_days\)\}/);
  assert.match(source, /積假\{formatDays\(employee\.employment\?\.accrued_leave_balance_days\)\}/);
  assert.doesNotMatch(source, /需具早班資格|主管指定可支援早班|尚未設定「可支援早班」/);
  assert.doesNotMatch(apiSource, /不能排入支援早班/);
  assert.match(apiSource, /staff_accrued_leave_monthly_credits/);
  assert.match(apiSource, /ignoreDuplicates: true/);
  assert.match(styles, /\.scheduleTable \.offCell\{background:#fee2e2\}/);
  assert.match(styles, /\.scheduleTable \.earlyShiftCell\{background:#ffedd5\}/);
  assert.match(styles, /\.scheduleTable \.lateShiftCell\{background:#dbeafe\}/);
  assert.match(source, /if \(\["FRONTDESK_DAY", "COACH_EARLY"\]\.includes/);
  assert.match(selfSource, /\["FRONTDESK_DAY", "COACH_EARLY"\]\.includes/);
  assert.match(printSource, /\["FRONTDESK_DAY", "COACH_EARLY"\]\.includes/);
  assert.doesNotMatch(source, /\["FRONTDESK_DAY", "COACH_EARLY", "COACH_EARLY_WED"\]\.includes/);
  assert.doesNotMatch(selfSource, /\["FRONTDESK_DAY", "COACH_EARLY", "COACH_EARLY_WED"\]\.includes/);
  assert.doesNotMatch(printSource, /\["FRONTDESK_DAY", "COACH_EARLY", "COACH_EARLY_WED"\]\.includes/);
  assert.match(styles, /\.nameSummary\{display:flex;align-items:center;gap:5px;width:100%;min-width:0;white-space:nowrap\}/);
  assert.match(styles, /\.leaveBalances\{display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;margin-left:auto;text-align:right\}/);
  assert.match(styles, /\.leaveBalances i\{display:inline-flex;align-items:center;justify-content:center;min-height:22px;padding:2px 7px;border:1px solid #c7d9ee;border-radius:999px;background:#edf5ff/);
  assert.match(printStyles, /\.off \{\s*background: #fee2e2;/);
  assert.match(printStyles, /\.early \{\s*background: #ffedd5;/);
  assert.match(printStyles, /\.late \{\s*background: #dbeafe;/);
  assert.match(exportSource, /fgColor: \{ argb: "FFFEE2E2" \}/);
  assert.match(selfSource, /styles\.earlyEntry/);
  assert.match(selfSource, /styles\.lateEntry/);
  assert.match(selfStyles, /\.scheduleList \.offEntry\{background:#fee2e2/);
  assert.match(migration, /annual_leave_balance_days numeric\(5,1\)/);
  assert.match(migration, /accrued_leave_balance_days numeric\(5,1\)/);
  assert.match(migration, /profile\.employee_number = 'E000012'/);
  assert.match(unaDraftMigration, /profile\.employee_number = 'E000012'/);
  assert.match(unaDraftMigration, /version\.status in \('draft', 'assistant_review', 'manager_review'\)/);
  assert.match(unaDraftMigration, /extract\(isodow from entry\.work_date\) = 3/);
  assert.match(creditMigration, /create table if not exists public\.staff_accrued_leave_monthly_credits/);
  assert.match(creditMigration, /unique\(period_id, employee_id\)/);
  assert.match(creditMigration, /after insert on public\.staff_accrued_leave_monthly_credits/);
});
