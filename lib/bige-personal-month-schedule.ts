import {
  collectCoachDayStatuses,
  type BigeCoachDayStatus,
} from "./bige-coach-day-status";

const BIGE_TIME_ZONE = "Asia/Taipei";

type CoachMonthStatusNote = {
  coach_id: string;
  starts_at: string;
  content?: unknown;
};

export type BigePersonalMonthDayStatus = BigeCoachDayStatus & {
  businessDate: string;
};

export function isBigePersonalMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function bigePersonalMonthRange(month: string) {
  if (!isBigePersonalMonth(month)) {
    throw new Error("invalid_personal_schedule_month");
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextMonth}-01T00:00:00+08:00`,
  };
}

export function listBigePersonalMonthDates(month: string) {
  if (!isBigePersonalMonth(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}

export function shiftBigePersonalMonth(month: string, offset: -1 | 1) {
  if (!isBigePersonalMonth(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function bigePersonalScheduleDateKey(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BIGE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

export function collectBigePersonalMonthDayStatuses(
  notes: readonly CoachMonthStatusNote[],
  coachId: string,
): BigePersonalMonthDayStatus[] {
  const notesByDate = new Map<string, CoachMonthStatusNote[]>();

  for (const note of notes) {
    if (note.coach_id !== coachId) continue;
    const businessDate = bigePersonalScheduleDateKey(note.starts_at);
    if (!businessDate) continue;
    const current = notesByDate.get(businessDate) || [];
    current.push(note);
    notesByDate.set(businessDate, current);
  }

  return [...notesByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([businessDate, dateNotes]) =>
      collectCoachDayStatuses(dateNotes, new Set([coachId])).map((status) => ({
        ...status,
        businessDate,
      })),
    );
}
