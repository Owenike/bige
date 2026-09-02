import { collectBigePersonalMonthDayStatuses } from "./bige-personal-month-schedule";

export const SEPTEMBER_2026_STAFF_SCHEDULE_MONTH_START = "2026-09-01";
export const SEPTEMBER_2026_STAFF_SCHEDULE_MONTH = "2026-09";

const SEPTEMBER_2026_TEMPORARY_LEAVE_SOURCE = "temporary_coach_leave_import";

type TemporaryCoachStatusNote = {
  id?: string;
  coach_id: string;
  starts_at: string;
  content?: unknown;
  source?: string | null;
};

export type SeptemberTemporaryScheduleEntry = {
  id: string;
  employeeId: string;
  workDate: string;
  entryKind: "work" | "off";
  shiftCode: string | null;
  shiftLabel: string | null;
  startsAt: null;
  endsAt: null;
  breakMinutes: number;
  paidBreak: boolean;
  breakHiddenFromEmployee: boolean;
  countsTowardMiddleLimit: boolean;
  offKind: "preferred_off" | "facility_closure" | null;
  source: "supervisor" | "facility_closure";
  employeeVisibleNote: string;
};

export function shouldUseSeptemberTemporarySchedule(params: {
  monthStart: string;
  view: "self" | "team";
  hasPublishedVersion: boolean;
}) {
  return (
    params.monthStart === SEPTEMBER_2026_STAFF_SCHEDULE_MONTH_START &&
    params.view === "self" &&
    !params.hasPublishedVersion
  );
}

export function buildSeptemberTemporaryScheduleEntries(params: {
  coachId: string;
  notes: readonly TemporaryCoachStatusNote[];
  facilityClosureDates?: readonly string[];
}) {
  const temporaryNotes = params.notes.filter(
    (note) => note.source === SEPTEMBER_2026_TEMPORARY_LEAVE_SOURCE,
  );
  const statuses = collectBigePersonalMonthDayStatuses(temporaryNotes, params.coachId)
    .filter((status) =>
      status.status === "off" &&
      status.businessDate.startsWith(`${SEPTEMBER_2026_STAFF_SCHEDULE_MONTH}-`),
    );

  // A closure by itself must not opt an unrelated employee into the temporary
  // September bridge. Only employees with imported daily-board statuses use it.
  if (statuses.length === 0) return [];

  const entries = new Map<string, SeptemberTemporaryScheduleEntry>();
  for (const status of statuses) {
    entries.set(status.businessDate, {
      id: `september-daily-status:${params.coachId}:${status.businessDate}`,
      employeeId: params.coachId,
      workDate: status.businessDate,
      entryKind: "off",
      shiftCode: null,
      shiftLabel: null,
      startsAt: null,
      endsAt: null,
      breakMinutes: 0,
      paidBreak: false,
      breakHiddenFromEmployee: false,
      countsTowardMiddleLimit: false,
      offKind: "preferred_off",
      source: "supervisor",
      employeeVisibleNote: "9 月日排課表排休",
    });
  }

  for (const closureDate of params.facilityClosureDates || []) {
    if (!closureDate.startsWith(`${SEPTEMBER_2026_STAFF_SCHEDULE_MONTH}-`)) continue;
    entries.set(closureDate, {
      id: `september-facility-closure:${params.coachId}:${closureDate}`,
      employeeId: params.coachId,
      workDate: closureDate,
      entryKind: "off",
      shiftCode: null,
      shiftLabel: null,
      startsAt: null,
      endsAt: null,
      breakMinutes: 0,
      paidBreak: false,
      breakHiddenFromEmployee: false,
      countsTowardMiddleLimit: false,
      offKind: "facility_closure",
      source: "facility_closure",
      employeeVisibleNote: "館休",
    });
  }

  return [...entries.values()].sort((left, right) => left.workDate.localeCompare(right.workDate));
}
