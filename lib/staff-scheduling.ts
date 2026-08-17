export const STAFF_TIME_ZONE = "Asia/Taipei";
export const PREFERRED_DAYS_REQUIRED = 8;
export const DEFAULT_MIDDLE_PREFERENCE_LIMIT = 2;

export type EmploymentType = "full_time" | "part_time";
export type WorkGroup = "frontdesk" | "coach" | "other";
export type ScheduleEntryKind = "work" | "off";
export type OffKind =
  | "regular_day_off"
  | "rest_day"
  | "facility_closure"
  | "preferred_off"
  | "national_holiday"
  | "holiday_adjustment"
  | "annual_leave"
  | "sick_leave"
  | "personal_leave"
  | "family_care_leave"
  | "marriage_leave"
  | "bereavement_leave"
  | "official_leave"
  | "other_leave";

export type ShiftDefinition = {
  code: string;
  label: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  paidBreak: boolean;
  breakHiddenFromEmployee: boolean;
  countsTowardMiddleLimit: boolean;
};

export const DEFAULT_SHIFT_DEFINITIONS: readonly ShiftDefinition[] = [
  {
    code: "FRONTDESK_DAY",
    label: "櫃台班",
    startsAt: "09:30",
    endsAt: "16:30",
    breakMinutes: 30,
    paidBreak: true,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: false,
  },
  {
    code: "COACH_EARLY",
    label: "早班",
    startsAt: "10:00",
    endsAt: "19:00",
    breakMinutes: 60,
    paidBreak: false,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: false,
  },
  {
    code: "COACH_EARLY_WED",
    label: "週三早班",
    startsAt: "12:00",
    endsAt: "21:00",
    breakMinutes: 60,
    paidBreak: false,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: false,
  },
  {
    code: "COACH_MIDDLE",
    label: "中班",
    startsAt: "13:00",
    endsAt: "22:00",
    breakMinutes: 60,
    paidBreak: false,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: true,
  },
  {
    code: "COACH_PARTTIME_WEEKDAY",
    label: "兼職晚班",
    startsAt: "18:00",
    endsAt: "22:00",
    breakMinutes: 0,
    paidBreak: true,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: false,
  },
  {
    code: "COACH_PARTTIME_WEEKEND",
    label: "兼職假日班",
    startsAt: "13:00",
    endsAt: "22:00",
    breakMinutes: 60,
    paidBreak: true,
    breakHiddenFromEmployee: true,
    countsTowardMiddleLimit: true,
  },
] as const;

export type EmployeeScheduleConfig = {
  employeeId: string;
  displayName: string;
  employmentType: EmploymentType;
  workGroup: WorkGroup;
  defaultShiftCode: string;
  isOriginalEarlyShift: boolean;
  canCoverEarlyShift: boolean;
  countsTowardMiddleLimit: boolean;
};

export type ScheduleEntryDraft = {
  employeeId: string;
  workDate: string;
  entryKind: ScheduleEntryKind;
  shiftCode: string | null;
  shiftLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
  breakMinutes: number;
  paidBreak: boolean;
  breakHiddenFromEmployee: boolean;
  countsTowardMiddleLimit: boolean;
  offKind: OffKind | null;
  source: "generated" | "preference" | "facility_closure" | "supervisor" | "leave" | "holiday_adjustment";
  employeeVisibleNote?: string | null;
};

export type ScheduleRuleResult = {
  employeeId: string | null;
  workDate: string | null;
  ruleCode: string;
  severity: "info" | "warning" | "blocking";
  passed: boolean;
  message: string;
  details: Record<string, unknown>;
};

export type HolidayDefinition = { date: string; name: string };

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return toIsoDate(date);
}

export function normalizeMonthStart(value: string) {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  return toIsoDate(date);
}

export function listMonthDates(monthStartInput: string) {
  const monthStart = normalizeMonthStart(monthStartInput);
  const start = parseIsoDate(monthStart);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const result: string[] = [];
  const cursor = new Date(Date.UTC(year, month, 1));
  while (cursor.getUTCMonth() === month) {
    result.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function mondayOfWeek(value: string) {
  const date = parseIsoDate(value);
  const day = date.getUTCDay();
  const distance = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - distance);
  return toIsoDate(date);
}

export function buildSelectionWindow(monthStartInput: string) {
  const monthStart = parseIsoDate(normalizeMonthStart(monthStartInput));
  monthStart.setUTCMonth(monthStart.getUTCMonth() - 1);
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth() + 1;
  const yearText = String(year).padStart(4, "0");
  const monthText = String(month).padStart(2, "0");
  return {
    opensAt: `${yearText}-${monthText}-01T00:00:00+08:00`,
    closesAt: `${yearText}-${monthText}-20T23:59:59+08:00`,
  };
}

export function isPreferenceWindowOpen(monthStart: string, now = new Date()) {
  const window = buildSelectionWindow(monthStart);
  const time = now.getTime();
  return time >= new Date(window.opensAt).getTime() && time <= new Date(window.closesAt).getTime();
}

export function assertValidPreferenceDates(params: {
  monthStart: string;
  selectedDates: string[];
  facilityClosureDates?: string[];
  requiredCount?: number;
}) {
  const requiredCount = params.requiredCount ?? PREFERRED_DAYS_REQUIRED;
  const monthDates = new Set(listMonthDates(params.monthStart));
  const unique = Array.from(new Set(params.selectedDates));
  const closureDates = new Set(params.facilityClosureDates || []);
  const combined = new Set([...unique, ...closureDates]);
  if (combined.size !== requiredCount) {
    throw new Error(`必須選滿 ${requiredCount} 天（館休日已自動計入）`);
  }
  for (const date of combined) {
    if (!monthDates.has(date)) throw new Error("排休日期必須位於指定月份");
  }
  return Array.from(combined).sort();
}

export function shiftForEmployeeDate(
  employee: EmployeeScheduleConfig,
  workDate: string,
  shifts: Map<string, ShiftDefinition>,
) {
  const day = parseIsoDate(workDate).getUTCDay();
  let code = employee.defaultShiftCode;
  if (employee.workGroup === "frontdesk") {
    code = "FRONTDESK_DAY";
  } else if (employee.workGroup === "coach" && employee.employmentType === "part_time") {
    code = day === 0 || day === 6 ? "COACH_PARTTIME_WEEKEND" : "COACH_PARTTIME_WEEKDAY";
  } else if (employee.isOriginalEarlyShift) {
    code = day === 3 ? "COACH_EARLY_WED" : "COACH_EARLY";
  }
  return shifts.get(code) || shifts.get("COACH_MIDDLE") || DEFAULT_SHIFT_DEFINITIONS[0];
}

function chooseExtraOffDate(weekDates: string[], entries: Map<string, ScheduleEntryDraft>) {
  const priority = [...weekDates].sort((a, b) => {
    const aDay = parseIsoDate(a).getUTCDay();
    const bDay = parseIsoDate(b).getUTCDay();
    const aScore = aDay === 0 ? 0 : aDay === 6 ? 1 : 2;
    const bScore = bDay === 0 ? 0 : bDay === 6 ? 1 : 2;
    return aScore - bScore || a.localeCompare(b);
  });
  return priority.find((date) => entries.get(date)?.entryKind === "work") || null;
}

function labelWeeklyDaysOff(entries: Map<string, ScheduleEntryDraft>, weekDates: string[]) {
  const offDates = weekDates.filter((date) => entries.get(date)?.entryKind === "off").sort();
  if (offDates[0]) {
    const entry = entries.get(offDates[0]);
    if (entry && (entry.offKind === "preferred_off" || entry.offKind === "facility_closure")) {
      entry.offKind = "regular_day_off";
    }
  }
  if (offDates[1]) {
    const entry = entries.get(offDates[1]);
    if (entry && (entry.offKind === "preferred_off" || entry.offKind === "facility_closure")) {
      entry.offKind = "rest_day";
    }
  }
}

export function generateMonthlySchedule(params: {
  monthStart: string;
  employees: EmployeeScheduleConfig[];
  preferencesByEmployee: Record<string, string[]>;
  facilityClosureDates?: string[];
  shifts?: ShiftDefinition[];
}) {
  const monthDates = listMonthDates(params.monthStart);
  const facilityClosures = new Set(params.facilityClosureDates || []);
  const shiftMap = new Map((params.shifts || [...DEFAULT_SHIFT_DEFINITIONS]).map((shift) => [shift.code, shift]));
  const entries: ScheduleEntryDraft[] = [];

  for (const employee of params.employees) {
    const preferred = new Set(params.preferencesByEmployee[employee.employeeId] || []);
    const byDate = new Map<string, ScheduleEntryDraft>();
    for (const workDate of monthDates) {
      const isClosure = facilityClosures.has(workDate);
      const isPreferred = preferred.has(workDate);
      if (isClosure || isPreferred) {
        byDate.set(workDate, {
          employeeId: employee.employeeId,
          workDate,
          entryKind: "off",
          shiftCode: null,
          shiftLabel: null,
          startsAt: null,
          endsAt: null,
          breakMinutes: 0,
          paidBreak: false,
          breakHiddenFromEmployee: true,
          countsTowardMiddleLimit: false,
          offKind: isClosure ? "facility_closure" : "preferred_off",
          source: isClosure ? "facility_closure" : "preference",
        });
        continue;
      }
      const shift = shiftForEmployeeDate(employee, workDate, shiftMap);
      byDate.set(workDate, {
        employeeId: employee.employeeId,
        workDate,
        entryKind: "work",
        shiftCode: shift.code,
        shiftLabel: shift.label,
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        breakMinutes: shift.breakMinutes,
        paidBreak: shift.paidBreak,
        breakHiddenFromEmployee: shift.breakHiddenFromEmployee,
        countsTowardMiddleLimit: shift.countsTowardMiddleLimit,
        offKind: null,
        source: "generated",
      });
    }

    const weeks = new Map<string, string[]>();
    for (const date of monthDates) {
      const key = mondayOfWeek(date);
      const dates = weeks.get(key) || [];
      dates.push(date);
      weeks.set(key, dates);
    }
    for (const weekDates of weeks.values()) {
      // A complete Monday-Sunday cycle must contain one regular day off and one rest day.
      if (weekDates.length === 7) {
        while (weekDates.filter((date) => byDate.get(date)?.entryKind === "off").length < 2) {
          const extraDate = chooseExtraOffDate(weekDates, byDate);
          if (!extraDate) break;
          byDate.set(extraDate, {
            employeeId: employee.employeeId,
            workDate: extraDate,
            entryKind: "off",
            shiftCode: null,
            shiftLabel: null,
            startsAt: null,
            endsAt: null,
            breakMinutes: 0,
            paidBreak: false,
            breakHiddenFromEmployee: true,
            countsTowardMiddleLimit: false,
            offKind: "rest_day",
            source: "supervisor",
          });
        }
      }
      labelWeeklyDaysOff(byDate, weekDates);
    }
    entries.push(...monthDates.map((date) => byDate.get(date)).filter((entry): entry is ScheduleEntryDraft => !!entry));
  }
  return entries;
}

export function validateSchedule(params: {
  monthStart: string;
  employees: EmployeeScheduleConfig[];
  entries: ScheduleEntryDraft[];
  contextEntries?: ScheduleEntryDraft[];
  preferenceDailyLimit?: number;
  holidays?: HolidayDefinition[];
}) {
  const results: ScheduleRuleResult[] = [];
  const targetDates = new Set(listMonthDates(params.monthStart));
  const employeeMap = new Map(params.employees.map((employee) => [employee.employeeId, employee]));
  const byEmployee = new Map<string, ScheduleEntryDraft[]>();
  const combinedEntries = new Map<string, ScheduleEntryDraft>();
  for (const entry of [...(params.contextEntries || []), ...params.entries]) {
    combinedEntries.set(`${entry.employeeId}:${entry.workDate}`, entry);
  }
  for (const entry of combinedEntries.values()) {
    const rows = byEmployee.get(entry.employeeId) || [];
    rows.push(entry);
    byEmployee.set(entry.employeeId, rows);
  }

  for (const [employeeId, rows] of byEmployee) {
    const sorted = [...rows].sort((a, b) => a.workDate.localeCompare(b.workDate));
    const completeWeeks = new Map<string, ScheduleEntryDraft[]>();
    let consecutive = 0;
    for (const row of sorted) {
      const week = completeWeeks.get(mondayOfWeek(row.workDate)) || [];
      week.push(row);
      completeWeeks.set(mondayOfWeek(row.workDate), week);
      consecutive = row.entryKind === "work" ? consecutive + 1 : 0;
      if (consecutive > 6 && targetDates.has(row.workDate)) {
        results.push({
          employeeId,
          workDate: row.workDate,
          ruleCode: "MAX_SIX_CONSECUTIVE_WORK_DAYS",
          severity: "blocking",
          passed: false,
          message: "同一員工不得連續工作超過 6 天，請調整班表。",
          details: { consecutiveDays: consecutive },
        });
      }
      if (row.entryKind === "work" && targetDates.has(row.workDate)) {
        if (!row.startsAt || !row.endsAt) {
          results.push({
            employeeId,
            workDate: row.workDate,
            ruleCode: "SHIFT_TIME_REQUIRED",
            severity: "blocking",
            passed: false,
            message: "上班日缺少完整的上下班時間，請先設定班別。",
            details: {},
          });
        } else {
          const spanMinutes = minutesBetween(row.startsAt, row.endsAt);
          const workMinutes = Math.max(0, spanMinutes - Math.max(0, row.breakMinutes));
          if (spanMinutes > 4 * 60 && row.breakMinutes < 30) {
            results.push({
              employeeId,
              workDate: row.workDate,
              ruleCode: "CONTINUOUS_WORK_BREAK_REQUIRED",
              severity: "blocking",
              passed: false,
              message: "工作超過 4 小時，必須安排至少 30 分鐘休息時間。",
              details: { spanMinutes, breakMinutes: row.breakMinutes },
            });
          }
          if (workMinutes > 8 * 60) {
            results.push({
              employeeId,
              workDate: row.workDate,
              ruleCode: "DAILY_NORMAL_HOURS_EXCEEDED",
              severity: "blocking",
              passed: false,
              message: `本日正常工作時間為 ${Math.round(workMinutes / 6) / 10} 小時，超過 8 小時，請改列加班或調整班次。`,
              details: { workMinutes },
            });
          }
        }
      }
    }
    for (const [weekStart, weekRows] of completeWeeks) {
      const intersectsTargetMonth = weekRows.some((row) => targetDates.has(row.workDate));
      if (!intersectsTargetMonth) continue;
      if (weekRows.length < 7) {
        results.push({
          employeeId,
          workDate: weekStart,
          ruleCode: "BOUNDARY_WEEK_REVIEW",
          severity: "warning",
          passed: true,
          message: "此週跨月份，發布前會連同相鄰月份班表檢查。",
          details: { visibleDays: weekRows.length },
        });
        continue;
      }
      const regularDays = weekRows.filter((row) => row.offKind === "regular_day_off").length;
      const restDays = weekRows.filter((row) => row.offKind === "rest_day").length;
      const weeklyWorkMinutes = weekRows.reduce((sum, row) => {
        if (row.entryKind !== "work" || !row.startsAt || !row.endsAt) return sum;
        return sum + Math.max(0, minutesBetween(row.startsAt, row.endsAt) - Math.max(0, row.breakMinutes));
      }, 0);
      results.push({
        employeeId,
        workDate: weekStart,
        ruleCode: "WEEKLY_REGULAR_AND_REST_DAY",
        severity: "blocking",
        passed: regularDays >= 1 && restDays >= 1,
        message:
          regularDays >= 1 && restDays >= 1
            ? "本週已安排例假及休息日。"
            : "本週必須至少安排 1 天例假及 1 天休息日。",
        details: { regularDays, restDays },
      });
      results.push({
        employeeId,
        workDate: weekStart,
        ruleCode: "WEEKLY_NORMAL_HOURS",
        severity: "blocking",
        passed: weeklyWorkMinutes <= 40 * 60,
        message: weeklyWorkMinutes <= 40 * 60
          ? "本週正常工作時間未超過 40 小時。"
          : `本週正常工作時間為 ${Math.round(weeklyWorkMinutes / 6) / 10} 小時，超過 40 小時，請調整或明確列為加班。`,
        details: { weeklyWorkMinutes },
      });
    }
    if (!employeeMap.has(employeeId)) {
      results.push({
        employeeId,
        workDate: null,
        ruleCode: "EMPLOYEE_CONFIGURATION_MISSING",
        severity: "blocking",
        passed: false,
        message: "找不到員工班別設定。",
        details: {},
      });
    }
  }

  const preferenceDailyLimit = params.preferenceDailyLimit ?? DEFAULT_MIDDLE_PREFERENCE_LIMIT;
  const middlePreferenceCounts = new Map<string, string[]>();
  for (const entry of params.entries) {
    const employee = employeeMap.get(entry.employeeId);
    if (
      entry.entryKind === "off" &&
      entry.source === "preference" &&
      employee?.countsTowardMiddleLimit
    ) {
      const ids = middlePreferenceCounts.get(entry.workDate) || [];
      ids.push(entry.employeeId);
      middlePreferenceCounts.set(entry.workDate, ids);
    }
  }
  for (const [workDate, employeeIds] of middlePreferenceCounts) {
    results.push({
      employeeId: null,
      workDate,
      ruleCode: "MIDDLE_PREFERENCE_DAILY_LIMIT",
      severity: "warning",
      passed: employeeIds.length <= preferenceDailyLimit,
      message:
        employeeIds.length <= preferenceDailyLimit
          ? "中班自選排休人數在限制內。"
          : `中班自選排休共 ${employeeIds.length} 人，超過 ${preferenceDailyLimit} 人，需經理逐筆覆核。`,
      details: { employeeIds, limit: preferenceDailyLimit },
    });
  }

  const holidayMap = new Map((params.holidays || []).map((holiday) => [holiday.date, holiday.name]));
  for (const entry of params.entries) {
    const holidayName = holidayMap.get(entry.workDate);
    if (!holidayName || entry.entryKind !== "work") continue;
    const employee = employeeMap.get(entry.employeeId);
    results.push({
      employeeId: entry.employeeId,
      workDate: entry.workDate,
      ruleCode: "HOLIDAY_ADJUSTMENT_REQUIRED",
      severity: "blocking",
      passed: false,
      message: `⚠️ ${employee?.displayName || "此員工"}在國定假日被排到上班，請立即改成當日休假，或選擇另一個原工作日作為國定假日調休日。`,
      details: { holidayName, shift: `${entry.startsAt}–${entry.endsAt}` },
    });
  }
  return results;
}

export function moveDayOff(params: {
  entries: ScheduleEntryDraft[];
  employeeId: string;
  fromDate: string;
  toDate: string;
  employee: EmployeeScheduleConfig;
  shifts?: ShiftDefinition[];
}): ScheduleEntryDraft[] {
  if (params.fromDate === params.toDate) return params.entries;
  const source = params.entries.find(
    (entry) => entry.employeeId === params.employeeId && entry.workDate === params.fromDate,
  );
  const target = params.entries.find(
    (entry) => entry.employeeId === params.employeeId && entry.workDate === params.toDate,
  );
  if (!source || !target) throw new Error("找不到要移動的班表日期");
  if (source.entryKind !== "off") throw new Error("只能拖移休假格");
  if (target.entryKind === "off") throw new Error("目標日期已有休假，請選擇交換或取消");
  const shiftMap = new Map((params.shifts || [...DEFAULT_SHIFT_DEFINITIONS]).map((shift) => [shift.code, shift]));
  const restored = shiftForEmployeeDate(params.employee, params.fromDate, shiftMap);
  return params.entries.map<ScheduleEntryDraft>((entry) => {
    if (entry.employeeId !== params.employeeId) return entry;
    if (entry.workDate === params.fromDate) {
      return {
        ...entry,
        entryKind: "work",
        shiftCode: restored.code,
        shiftLabel: restored.label,
        startsAt: restored.startsAt,
        endsAt: restored.endsAt,
        breakMinutes: restored.breakMinutes,
        paidBreak: restored.paidBreak,
        breakHiddenFromEmployee: restored.breakHiddenFromEmployee,
        countsTowardMiddleLimit: restored.countsTowardMiddleLimit,
        offKind: null,
        source: "generated",
      };
    }
    if (entry.workDate === params.toDate) {
      return {
        ...entry,
        entryKind: "off",
        shiftCode: null,
        shiftLabel: null,
        startsAt: null,
        endsAt: null,
        breakMinutes: 0,
        paidBreak: false,
        breakHiddenFromEmployee: true,
        countsTowardMiddleLimit: false,
        offKind: source.offKind,
        source: "supervisor",
      };
    }
    return entry;
  });
}

export function minutesBetween(start: string, end: string, crossesMidnight = false) {
  const parse = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) throw new Error("Invalid time");
    return hours * 60 + minutes;
  };
  const startMinutes = parse(start);
  let endMinutes = parse(end);
  if (crossesMidnight || endMinutes < startMinutes) endMinutes += 24 * 60;
  return endMinutes - startMinutes;
}

export function paidMinutesForEntry(entry: Pick<ScheduleEntryDraft, "entryKind" | "startsAt" | "endsAt" | "breakMinutes" | "paidBreak">) {
  if (entry.entryKind !== "work" || !entry.startsAt || !entry.endsAt) return 0;
  const scheduled = minutesBetween(entry.startsAt, entry.endsAt);
  return Math.max(0, scheduled - (entry.paidBreak ? 0 : entry.breakMinutes));
}

export function dateAfter(value: string, days: number) {
  return addDays(value, days);
}
