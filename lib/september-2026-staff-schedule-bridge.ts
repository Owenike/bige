import { collectBigePersonalMonthDayStatuses } from "./bige-personal-month-schedule";
import {
  DEFAULT_SHIFT_DEFINITIONS,
  generateMonthlySchedule,
  isAutomaticScheduleSource,
  type EmployeeScheduleConfig,
  type ScheduleEntryDraft,
} from "./staff-scheduling";

export const SEPTEMBER_2026_STAFF_SCHEDULE_MONTH_START = "2026-09-01";
export const SEPTEMBER_2026_STAFF_SCHEDULE_MONTH = "2026-09";

type TemporaryCoachStatusNote = {
  id?: string;
  coach_id: string;
  starts_at: string;
  content?: unknown;
  source?: string | null;
};

export type SeptemberTemporaryScheduleEntry = ScheduleEntryDraft & {
  id: string;
};

export function shouldUseSeptemberTemporarySchedule(params: {
  monthStart: string;
  view: "self" | "team";
  hasPublishedVersion: boolean;
}) {
  return (
    params.monthStart === SEPTEMBER_2026_STAFF_SCHEDULE_MONTH_START &&
    !params.hasPublishedVersion
  );
}

export function buildSeptemberTemporaryScheduleEntries(params: {
  coaches: readonly EmployeeScheduleConfig[];
  notes: readonly TemporaryCoachStatusNote[];
  facilityClosureDates?: readonly string[];
}) {
  const statuses = params.coaches.flatMap((coach) =>
    collectBigePersonalMonthDayStatuses(params.notes, coach.employeeId)
      .filter((status) => status.businessDate.startsWith(`${SEPTEMBER_2026_STAFF_SCHEDULE_MONTH}-`)),
  );

  // A closure by itself must not opt an unrelated employee into the temporary
  // September bridge. Only employees with daily-board statuses use it.
  if (statuses.length === 0) return [];

  const optedCoachIds = new Set(statuses.map((status) => status.coach_id));
  const optedCoaches = params.coaches.filter((coach) => optedCoachIds.has(coach.employeeId));
  const preferencesByEmployee = Object.fromEntries(optedCoaches.map((coach) => [
    coach.employeeId,
    statuses
      .filter((status) => status.coach_id === coach.employeeId && status.status === "off")
      .map((status) => status.businessDate),
  ]));
  const statusByCell = new Map(statuses.map((status) => [
    `${status.coach_id}:${status.businessDate}`,
    status,
  ]));
  const shiftByStatus = new Map([
    ["early", DEFAULT_SHIFT_DEFINITIONS.find((shift) => shift.code === "COACH_EARLY")!],
    ["late", DEFAULT_SHIFT_DEFINITIONS.find((shift) => shift.code === "COACH_PARTTIME_WEEKDAY")!],
  ] as const);
  const generated = generateMonthlySchedule({
    monthStart: SEPTEMBER_2026_STAFF_SCHEDULE_MONTH_START,
    employees: optedCoaches,
    preferencesByEmployee,
    facilityClosureDates: [...(params.facilityClosureDates || [])],
  });

  return generated.map<SeptemberTemporaryScheduleEntry>((entry) => {
    const status = statusByCell.get(`${entry.employeeId}:${entry.workDate}`);
    const id = `september-daily-schedule:${entry.employeeId}:${entry.workDate}`;
    if (entry.offKind === "facility_closure") {
      return { ...entry, id, employeeVisibleNote: "館休" };
    }
    if (status?.status === "off") {
      return {
        ...entry,
        id,
        offKind: "preferred_off",
        source: "supervisor",
        employeeVisibleNote: "9 月日排課表排休",
      };
    }
    const explicitShift = status ? shiftByStatus.get(status.status as "early" | "late") : null;
    if (explicitShift) {
      return {
        ...entry,
        id,
        entryKind: "work",
        shiftCode: explicitShift.code,
        shiftLabel: status?.label || explicitShift.label,
        startsAt: explicitShift.startsAt,
        endsAt: explicitShift.endsAt,
        breakMinutes: explicitShift.breakMinutes,
        paidBreak: explicitShift.paidBreak,
        breakHiddenFromEmployee: explicitShift.breakHiddenFromEmployee,
        countsTowardMiddleLimit: explicitShift.countsTowardMiddleLimit,
        offKind: null,
        source: "supervisor",
        employeeVisibleNote: "9 月日排課表班別",
      };
    }
    return { ...entry, id };
  });
}

export function mergeSeptemberTemporaryScheduleEntries(params: {
  persisted: readonly ScheduleEntryDraft[];
  temporary: readonly SeptemberTemporaryScheduleEntry[];
}) {
  const temporaryByCell = new Map(params.temporary.map((entry) => [
    `${entry.employeeId}:${entry.workDate}`,
    entry,
  ]));
  const merged = params.persisted.map((entry) => {
    const entryKey = `${entry.employeeId}:${entry.workDate}`;
    const temporaryEntry = temporaryByCell.get(entryKey);
    if (!temporaryEntry) return entry;
    temporaryByCell.delete(entryKey);
    return isAutomaticScheduleSource(entry.source) ? temporaryEntry : entry;
  });

  return [...merged, ...temporaryByCell.values()];
}
