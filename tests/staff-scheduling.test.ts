import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertValidPreferenceDates,
  buildSelectionWindow,
  generateMonthlySchedule,
  isConfiguredPreferenceWindowOpen,
  isSharedFrontdeskScheduleAccount,
  listMonthDates,
  missingScheduleCellKeys,
  monthlyAccruedLeaveCreditDays,
  monthlyDaysOffEntitlement,
  paidMinutesForEntry,
  normalizeStaffScheduleView,
  normalizeUnselectedPreferenceEntry,
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

test("configured preference windows support scheduled, forced-open, and forced-closed modes", () => {
  const period = {
    status: "selection_open",
    selectionOpensAt: "2026-09-01T00:00:00+08:00",
    selectionClosesAt: "2026-09-20T23:59:59+08:00",
  };
  assert.equal(isConfiguredPreferenceWindowOpen({ ...period, selectionControlMode: "scheduled", now: new Date("2026-09-10T12:00:00+08:00") }), true);
  assert.equal(isConfiguredPreferenceWindowOpen({ ...period, selectionControlMode: "scheduled", now: new Date("2026-09-21T00:00:00+08:00") }), false);
  assert.equal(isConfiguredPreferenceWindowOpen({ ...period, selectionControlMode: "open", now: new Date("2026-09-30T12:00:00+08:00") }), true);
  assert.equal(isConfiguredPreferenceWindowOpen({ ...period, selectionControlMode: "closed", now: new Date("2026-09-10T12:00:00+08:00") }), false);
  assert.equal(isConfiguredPreferenceWindowOpen({ ...period, status: "drafting", selectionControlMode: "open", now: new Date("2026-09-10T12:00:00+08:00") }), false);
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

test("middle shift uses the requested 14:00-23:00 hours", () => {
  const entry = generateMonthlySchedule({
    monthStart: "2026-09-01",
    employees: [middleCoach],
    preferencesByEmployee: { "coach-1": [] },
  })[0];
  assert.equal(entry.shiftCode, "COACH_MIDDLE");
  assert.equal(entry.startsAt, "14:00");
  assert.equal(entry.endsAt, "23:00");
});

test("draft synchronization finds every missing date for staff added after the version", () => {
  const existingEntries = generateMonthlySchedule({
    monthStart: "2026-09-01",
    employees: [middleCoach],
    preferencesByEmployee: { "coach-1": [] },
  });
  const missing = missingScheduleCellKeys({
    monthStart: "2026-09-01",
    employeeIds: ["coach-1", "hailey"],
    entries: existingEntries,
  });
  assert.equal(missing.length, 30);
  assert.equal(missing[0], "hailey:2026-09-01");
  assert.equal(missing[missing.length - 1], "hailey:2026-09-30");
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

test("manager schedule hides unselected legacy days off but preserves real selections and closures", () => {
  const generated = generateMonthlySchedule({
    monthStart: "2026-09-01",
    employees: [middleCoach],
    preferencesByEmployee: { "coach-1": [] },
  });
  const legacyOff = {
    ...generated[0],
    entryKind: "off" as const,
    shiftCode: null,
    shiftLabel: null,
    startsAt: null,
    endsAt: null,
    offKind: "rest_day" as const,
    source: "supervisor" as const,
  };

  const hiddenLegacyOff = normalizeUnselectedPreferenceEntry({
    entry: legacyOff,
    employee: middleCoach,
    preferenceDateSelected: false,
  });
  assert.equal(hiddenLegacyOff.entryKind, "work");
  assert.equal(hiddenLegacyOff.shiftCode, "COACH_MIDDLE");

  const selectedOff = normalizeUnselectedPreferenceEntry({
    entry: { ...legacyOff, source: "preference" },
    employee: middleCoach,
    preferenceDateSelected: true,
  });
  assert.equal(selectedOff.entryKind, "off");

  const facilityClosure = normalizeUnselectedPreferenceEntry({
    entry: { ...legacyOff, source: "facility_closure" },
    employee: middleCoach,
    preferenceDateSelected: false,
  });
  assert.equal(facilityClosure.entryKind, "off");

  const managerOverride = normalizeUnselectedPreferenceEntry({
    entry: legacyOff,
    employee: middleCoach,
    preferenceDateSelected: false,
    manualOverride: true,
  });
  assert.equal(managerOverride.entryKind, "off");
});

test("shared BIGE front-desk account is excluded without hiding individual staff accounts", () => {
  assert.equal(isSharedFrontdeskScheduleAccount("E000006"), true);
  assert.equal(isSharedFrontdeskScheduleAccount("E000001"), false);
  assert.equal(isSharedFrontdeskScheduleAccount(null), false);
});

test("staff self-service leave picker keeps its mobile layout and selection display accurate", () => {
  const source = readFileSync(resolve(process.cwd(), "components/staff-schedule-self-service.tsx"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "app/staff/schedule/page.module.css"), "utf8");
  const layout = readFileSync(resolve(process.cwd(), "app/layout-chrome.tsx"), "utf8");
  const globalStyles = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  assert.match(source, /const trailingCellCount = \(7 - \(cells\.length % 7\)\) % 7/);
  assert.match(source, /const selectedDaysLabel = selected\.slice\(\)\.sort\(\)/);
  assert.match(source, /<span>\{selectedDaysLabel\}<\/span>/);
  assert.doesNotMatch(source, /只選日期，例假／休假由合法班表安排/);
  assert.doesNotMatch(source, /還差 \$\{remaining\} 天/);
  assert.match(source, />儲存<\/button>/);
  assert.doesNotMatch(source, /儲存我的 \{requiredCount\} 天排休/);
  assert.match(source, /className=\{styles\.monthField\}>月份<span className=\{styles\.monthControl\}><input type="month"/);
  assert.match(source, /aria-label="日排課表"><span>日排<\/span><span>課表<\/span>/);
  assert.match(source, /aria-label="打卡確認"><span>打卡<\/span><span>確認<\/span>/);
  assert.match(source, /styles\.selectionNoticeClosed/);
  assert.match(styles, /\.monthControl\{[^}]*height:52px;min-height:52px;max-height:52px;[^}]*overflow:hidden/);
  assert.match(styles, /\.monthControl,\.headerActions a\{width:100%;height:64px;min-height:64px;max-height:64px\}/);
  assert.match(styles, /\.headerActions \.stackedHeaderAction\{flex-direction:column;/);
  assert.match(styles, /\.selectionNoticeClosed\{color:#79530a!important;border-color:#dfbf6a!important;background:#fff7dd\}/);
  assert.match(styles, /grid-template-columns:minmax\(0,1\.6fr\) repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /grid-template-columns:128px repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.selectionHeader\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles, /\.counter\{width:90px;height:90px;position:static/);
  assert.match(styles, /--schedule-gold:#d8b669/);
  assert.match(styles, /\.page::before\{[\s\S]*?linear-gradient\(145deg,#04070c 0%,#0a101a 48%,#05080f 100%\)/);
  assert.match(styles, /\.headerActions \.monthControl input\{[\s\S]*?font-size:16px;[\s\S]*?font-weight:800/);
  assert.match(styles, /grid-template-columns:145px repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(layout, /isStaffScheduleSurfaceRoute \? "shellStaffSchedule" : ""/);
  assert.match(globalStyles, /\.shellStaffSchedule:not\(\.shellEmbedded\)\{[\s\S]*?min-height: 100dvh;[\s\S]*?background-color: #05080f;/);
  assert.match(globalStyles, /body:has\(\.shellStaffSchedule:not\(\.shellEmbedded\)\)\{[\s\S]*?background-color: #05080f;/);
  assert.match(layout, /<span>巨挺健身館 BigE｜器械皮拉提斯・重量訓練・運動按摩｜<\/span>[\s\S]*?<span>高雄市仁武區八德北路728號｜0972-484686<\/span>/);
  assert.match(globalStyles, /\.footerTagline span\{\s*display: block;/);
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
  const middleShiftMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260828201642_update_coach_middle_shift_time.sql"), "utf8");
  const selectionControlMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260830225406_add_staff_selection_control_mode.sql"), "utf8");
  const notificationSource = readFileSync(resolve(process.cwd(), "lib/in-app-notifications.ts"), "utf8");
  assert.match(source, /className=\{styles\.titleRow\}[\s\S]*?全員班表控制台[\s\S]*?className=\{styles\.workflowBadge\}[\s\S]*?流程狀態[\s\S]*?stateLabel\(data\.period\.status\)/);
  assert.doesNotMatch(source, /className=\{styles\.stats\}/);
  assert.doesNotMatch(source, /<span>已選滿 8 天<\/span>|<span>尚未完成<\/span>|<span>法規阻擋<\/span>|<span>班表版本<\/span>/);
  assert.match(source, /className=\{styles\.setupActions\}[\s\S]*?setSetupDialog\("progress"\)[\s\S]*?館休與選休設定[\s\S]*?setSetupDialog\("shifts"\)[\s\S]*?固定班別設定/);
  assert.match(source, /setupDialogRef\.current[\s\S]*?dialog\.showModal\(\)/);
  assert.match(source, /<dialog[\s\S]*?aria-labelledby="setup-dialog-title"[\s\S]*?aria-label="關閉設定視窗"/);
  assert.match(styles, /\.workflowBadge\{[^}]*border-radius:999px/);
  assert.match(styles, /\.setupActions\{[^}]*grid-template-columns:repeat\(2,minmax\(240px,1fr\)\)/);
  assert.match(styles, /\.setupDialog::backdrop\{[^}]*backdrop-filter:blur\(8px\)/);
  assert.match(styles, /@media\(max-width:620px\)\{[\s\S]*?\.setupActions\{grid-template-columns:1fr/);
  assert.match(source, /選休截止日[\s\S]*?update_selection_deadline[\s\S]*?儲存截止日/);
  assert.match(source, /set_selection_window_state[\s\S]*?立即關閉選休[\s\S]*?立即開放選休/);
  assert.match(source, /selectionWindowSummary\(data\.period\)/);
  assert.match(styles, /\.selectionWindowControls\{[^}]*grid-template-columns:minmax\(170px,1fr\) auto auto/);
  assert.match(styles, /@media\(max-width:620px\)\{[\s\S]*?\.selectionWindowControls\{grid-template-columns:1fr/);
  assert.match(selfSource, /isConfiguredPreferenceWindowOpen/);
  assert.match(selfSource, /主管已手動開放選休/);
  assert.match(apiSource, /body\.action === "update_selection_deadline"/);
  assert.match(apiSource, /body\.action === "set_selection_window_state"/);
  assert.match(apiSource, /SELECTION_CONFIGURATION_STATUSES = new Set\(\["selection_open", "selection_closed", "drafting"\]\)/);
  assert.match(apiSource, /isConfiguredPreferenceWindowOpen\(\{/);
  assert.match(selectionControlMigration, /selection_control_mode text not null default 'scheduled'/);
  assert.match(selectionControlMigration, /'scheduled', 'open', 'closed'/);
  assert.match(notificationSource, /selection_control_mode[\s\S]*?isConfiguredPreferenceWindowOpen/);
  assert.match(source, /holidayRuleGroups\.map/);
  assert.match(source, /window\.setTimeout\(\(\) => setNotice\(""\), 4500\)/);
  assert.match(source, /const SCHEDULE_LOAD_TIMEOUT_MS = 20_000/);
  assert.match(source, /window\.setTimeout\(\(\) => controller\.abort\(\), SCHEDULE_LOAD_TIMEOUT_MS\)/);
  assert.match(source, /const SCHEDULE_CHANGE_HIGHLIGHT_MS = 60_000/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*?SCHEDULE_CHANGE_HIGHLIGHT_MS\)/);
  assert.match(source, /recentlyChangedEntryKeys\.has\(entryKey\) \? styles\.resignCell/);
  assert.doesNotMatch(source, /entry\?\.requiresResign \? styles\.resignCell/);
  assert.match(source, /requiresResign: true/);
  assert.match(source, /make_holiday_day_off[\s\S]*?highlightChangedEntries/);
  assert.match(source, /arrange_holiday_adjustment[\s\S]*?highlightChangedEntries/);
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
  assert.doesNotMatch(source, /className=\{styles\.filterBar\}|className=\{styles\.gridHelp\}|此草稿仍含舊規則補排/);
  assert.match(source, /preference\.status !== "submitted"/);
  assert.match(source, /const scheduleEmployees = useMemo/);
  assert.match(source, /isSharedFrontdeskScheduleAccount\(employee\.employeeNumber\)/);
  assert.doesNotMatch(source, /employee\.employment\?\.work_group !== "frontdesk"/);
  assert.match(source, /sync_missing_draft_cells/);
  assert.match(apiSource, /body\.action === "sync_missing_draft_cells"/);
  assert.match(apiSource, /version\.status !== "draft"/);
  assert.match(apiSource, /missingScheduleCellKeys/);
  assert.match(source, /shiftDragStart\(event, "DEFAULT"\)[\s\S]*>復原<\/b>[\s\S]*shiftDragStart\(event, "COACH_EARLY"\)[\s\S]*shiftDragStart\(event, "COACH_MIDDLE"\)[\s\S]*shiftDragStart\(event, "COACH_PARTTIME_WEEKDAY"\)[\s\S]*dayOffDragStart\(event, "rest_day"\)[\s\S]*dayOffDragStart\(event, "regular_day_off"\)/);
  assert.match(source, /payload\.shiftCode !== "DEFAULT"/);
  assert.match(source, /action: "assign_day_off"/);
  assert.match(apiSource, /body\.action === "assign_day_off"/);
  assert.match(apiSource, /尚有 \$\{incompleteEmployees\.length\} 位員工未完成 8 天排休/);
  assert.match(apiSource, /normalizeUnselectedPreferenceEntry/);
  assert.match(apiSource, /preferenceDateSelected: selectedPreferenceKeys\.has/);
  assert.match(exportSource, /normalizeUnselectedPreferenceEntry/);
  assert.match(exportSource, /isSharedFrontdeskScheduleAccount/);
  assert.match(apiSource, /z\.enum\(\["rest_day", "regular_day_off"\]\)/);
  assert.match(apiSource, /shiftChoice === "DEFAULT"[\s\S]*\["rest_day", "regular_day_off"\]/);
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
  assert.match(styles, /\.shiftBadge,\.offBadge\{display:inline;font-size:13px;font-weight:900;line-height:1\.2;white-space:nowrap\}/);
  assert.doesNotMatch(styles, /\.shiftBadge,\.offBadge\{[^}]*border|\.shiftBadge,\.offBadge\{[^}]*background|\.shiftBadge,\.offBadge\{[^}]*border-radius/);
  assert.match(styles, /\.middleShiftBadge\{/);
  assert.doesNotMatch(styles, /\.scheduleTable \.earlyShiftCell\{background:#ffedd5\}/);
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
  assert.match(styles, /--schedule-manager-gold:#d8b669/);
  assert.match(styles, /\.page\{width:100%;min-width:0\}/);
  assert.match(styles, /\.monthField input\{font-size:16px;font-weight:800/);
  assert.match(styles, /\.scheduleTable \.workCell,\.scheduleTable \.offCell\{background:rgba\(12,21,32,\.94\)\}/);
  assert.match(source, /function dateColumnClass\(date: string\)/);
  assert.equal(source.match(/dateColumnClass\(date\)/g)?.length, 4);
  assert.equal(source.match(/styles\.dateGridCell/g)?.length, 4);
  assert.match(styles, /\.scheduleTable thead \.dateGridCell,\.scheduleTable tbody \.dateGridCell,\.scheduleTable tfoot \.dateGridCell\{background:#fff;color:#111827\}/);
  assert.match(styles, /\.scheduleTable thead \.dateGridCell\.weekend\{background:#fff!important;color:#a54539\}/);
  assert.match(styles, /\.scheduleTable tbody tr:hover \.dateGridCell\{background:#fff!important\}/);
  assert.match(styles, /\.scheduleTable \.dateGridCell \.middleShiftBadge,\.scheduleTable \.dateGridCell \.emptyCell\{color:#111827\}/);
  assert.match(styles, /\.scheduleTable \.nameCell\{background:#101d2a;color:#fff8e9\}/);
  assert.match(styles, /\.scheduleTable \.offBadge\{color:#d8a8ac\}/);
  assert.doesNotMatch(styles, /\.scheduleTable \.(?:earlyShiftBadge|middleShiftBadge|lateShiftBadge|offBadge)\{[^}]*background/);
  assert.doesNotMatch(styles, /\.scheduleTable \.(?:earlyShiftBadge|middleShiftBadge|lateShiftBadge|offBadge)\{[^}]*border/);
  assert.match(printStyles, /@media print \{[\s\S]*?color-scheme: light;/);
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
  assert.match(middleShiftMigration, /code = 'COACH_MIDDLE'/);
  assert.match(middleShiftMigration, /starts_at = time '14:00'/);
  assert.match(middleShiftMigration, /ends_at = time '23:00'/);
  assert.match(middleShiftMigration, /version\.status = 'draft'/);
});
